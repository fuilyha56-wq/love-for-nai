"use client";

import { parseTaggerLabels, selectTaggerPredictions, taggerBgrTensor, taggerInputSpec, type TaggerLabel, type TaggerPrediction, type TaggerInputSpec } from "./tagger-core";

export type TaggerModelInfo = { id: string; name: string; modelName: string; bytes: number; importedAt: number; tagCount: number };
type TaggerModelRecord = TaggerModelInfo & { model: Blob; labels: TaggerLabel[]; externalData: Array<{ path: string; data: Blob }> };
export type TaggerPreferences = { modelId: string; onnx: boolean; llm: boolean; generalThreshold: number; characterThreshold: number };
const DEFAULT_PREFERENCES: TaggerPreferences = { modelId: "", onnx: false, llm: true, generalThreshold: 0.35, characterThreshold: 0.85 };
const PREFERENCES_KEY = "lfn-browser-tagger-settings";
export const TAGGER_CHANGE_EVENT = "lfn-browser-tagger-change";
let databasePromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("浏览器未提供 IndexedDB，无法保存本地标签模型。"));
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("lfn-browser-tagger", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("models", { keyPath: "id" });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); databasePromise = null; }; resolve(request.result); };
    request.onerror = () => { databasePromise = null; reject(new Error("无法打开本地模型存储，请检查浏览器的站点存储权限。")); };
    request.onblocked = () => { databasePromise = null; reject(new Error("本地模型存储被其他标签页占用，请关闭旧标签页重试。")); };
  });
  return databasePromise;
}

function announceChange() { window.dispatchEvent(new Event(TAGGER_CHANGE_EVENT)); }
export function subscribeTaggerChanges(listener: () => void): () => void {
  const storageChanged = (event: StorageEvent) => { if (event.key === PREFERENCES_KEY) listener(); };
  window.addEventListener(TAGGER_CHANGE_EVENT, listener); window.addEventListener("storage", storageChanged);
  return () => { window.removeEventListener(TAGGER_CHANGE_EVENT, listener); window.removeEventListener("storage", storageChanged); };
}
export function readTaggerPreferences(): TaggerPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
    const threshold = (candidate: unknown, fallback: number) => typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(0, Math.min(1, candidate)) : fallback;
    return { modelId: typeof value.modelId === "string" ? value.modelId : "", onnx: value.onnx === true, llm: value.llm !== false, generalThreshold: threshold(value.generalThreshold, 0.35), characterThreshold: threshold(value.characterThreshold, 0.85) };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}
export function writeTaggerPreferences(update: Partial<TaggerPreferences>): TaggerPreferences {
  const next = { ...readTaggerPreferences(), ...update };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...next, revision: `${Date.now()}-${Math.random()}` }));
  announceChange();
  return next;
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function abortError(): Error { return new DOMException("标签反推已取消。", "AbortError"); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
export async function listTaggerModels(): Promise<TaggerModelInfo[]> {
  const db = await database();
  const records = await requestResult<TaggerModelRecord[]>(db.transaction("models").objectStore("models").getAll());
  return records.map(({ id, name, modelName, bytes, importedAt, tagCount }) => ({ id, name, modelName, bytes, importedAt, tagCount })).sort((a, b) => b.importedAt - a.importedAt);
}
async function getTaggerModel(id: string): Promise<TaggerModelRecord> {
  const db = await database();
  const record = await requestResult<TaggerModelRecord | undefined>(db.transaction("models").objectStore("models").get(id));
  if (!record) throw new Error("本地标签模型已被移除，请在设置中重新导入。");
  return record;
}

/** A browser file picker grants the files; a typed Windows path cannot grant that permission. */
export async function importTaggerModels(files: readonly File[], onProgress?: (status: string) => void, signal?: AbortSignal): Promise<TaggerModelInfo[]> {
  checkAbort(signal);
  const path = (file: File) => file.webkitRelativePath || file.name;
  const folder = (file: File) => path(file).replace(/[^/]*$/, "");
  const modelFiles = files.filter(file => file.name.toLowerCase().endsWith(".onnx"));
  if (!modelFiles.length) throw new Error("选择的文件夹中没有 .onnx 模型文件。");
  const prepared: TaggerModelRecord[] = [];
  for (const model of modelFiles) {
    checkAbort(signal);
    const csv = files.find(file => folder(file) === folder(model) && file.name.toLowerCase() === "selected_tags.csv");
    if (!csv) throw new Error(`${path(model)} 同级缺少 selected_tags.csv，请同时选择配套标签文件。`);
    if (csv.size > 16_000_000) throw new Error("selected_tags.csv 超过 16 MB。");
    if (!model.size) throw new Error(`${model.name} 是空文件。`);
    onProgress?.(`正在检查 ${path(model)} 的标签…`);
    const labels = parseTaggerLabels(await csv.text());
    checkAbort(signal);
    const externalData = files.filter(file => folder(file) === folder(model) && /\.(?:data|bin|onnx_data)$/i.test(file.name)).map(file => ({ path: file.name, data: file }));
    prepared.push({ id: crypto.randomUUID?.() || `tagger-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: folder(model).split("/").filter(Boolean).at(-1) || model.name.replace(/\.onnx$/i, ""), modelName: model.name, bytes: model.size + externalData.reduce((sum, file) => sum + file.data.size, 0), importedAt: Date.now(), tagCount: labels.length, model, labels, externalData });
  }
  const db = await database();
  checkAbort(signal);
  onProgress?.(`正在保存 ${prepared.length} 个模型到此浏览器…`);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("models", "readwrite");
    const cancel = () => { try { transaction.abort(); } catch { /* Already committed. */ } };
    signal?.addEventListener("abort", cancel, { once: true });
    const clean = () => signal?.removeEventListener("abort", cancel);
    transaction.oncomplete = () => { clean(); resolve(); };
    transaction.onerror = event => { clean(); const failure = (event.target as IDBRequest).error || transaction.error; reject(new Error(failure?.name === "QuotaExceededError" ? "浏览器存储空间不足，请移除旧模型或腾出磁盘空间。" : "保存本地模型失败，请检查站点存储权限。")); };
    transaction.onabort = () => { clean(); reject(signal?.aborted ? abortError() : new Error(transaction.error?.name === "QuotaExceededError" ? "浏览器存储空间不足，请移除旧模型或腾出磁盘空间。" : "本地模型保存被中断。")); };
    for (const record of prepared) transaction.objectStore("models").put(record);
  });
  checkAbort(signal);
  writeTaggerPreferences({ modelId: prepared[0].id, onnx: true });
  return prepared.map(({ id, name, modelName, bytes, importedAt, tagCount }) => ({ id, name, modelName, bytes, importedAt, tagCount }));
}

export async function deleteTaggerModel(id: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("models", "readwrite");
    transaction.objectStore("models").delete(id);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new Error("无法移除本地标签模型。"));
  });
  if (loadedModelId === id) disposeTaggerWorker();
  const preferences = readTaggerPreferences();
  if (preferences.modelId === id) { const models = await listTaggerModels(); writeTaggerPreferences({ modelId: models[0]?.id || "", onnx: models.length ? preferences.onnx : false }); }
  else writeTaggerPreferences({});
}

type WorkerResponse = { id: number; error?: string; dimensions?: Array<number | string>; type?: string; scores?: Float32Array };
let worker: Worker | null = null;
let loadedModelId = "";
let nextRequest = 0;
let running = false;
const requests = new Map<number, { resolve: (message: WorkerResponse) => void; reject: (error: Error) => void }>();
export function disposeTaggerWorker(): void {
  worker?.terminate(); worker = null; loadedModelId = "";
  for (const request of requests.values()) request.reject(abortError());
  requests.clear();
}
function taggerWorker(): Worker {
  if (!worker) {
    if (typeof Worker === "undefined") throw new Error("浏览器不支持 Web Worker，无法执行本地 ONNX 模型。");
    worker = new Worker("/onnx/tagger-worker.js", { type: "module", name: "lfn-onnx-tagger" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = requests.get(event.data.id); if (!pending) return;
      requests.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve(event.data);
    };
    worker.onerror = () => {
      for (const pending of requests.values()) pending.reject(new Error("本地 ONNX 运行时加载失败，请检查浏览器的 WebAssembly 支持和 /onnx/ 静态资源。"));
      requests.clear(); worker?.terminate(); worker = null; loadedModelId = "";
    };
  }
  return worker;
}
function sendWorker(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<WorkerResponse> {
  const target = taggerWorker(), id = ++nextRequest;
  return new Promise((resolve, reject) => { requests.set(id, { resolve, reject }); target.postMessage({ ...message, id }, transfer); });
}
async function imageTensor(imageData: string, spec: TaggerInputSpec, signal?: AbortSignal): Promise<Float32Array> {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(imageData) && !imageData.startsWith("blob:")) throw new Error("请先上传本地 PNG、JPG 或 WebP 图片。");
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const cancel = () => { image.src = ""; reject(abortError()); };
    const clean = () => signal?.removeEventListener("abort", cancel);
    image.onload = () => { clean(); resolve(); }; image.onerror = () => { clean(); reject(new Error("无法读取反推图片，请重新上传。")); };
    signal?.addEventListener("abort", cancel, { once: true }); image.src = imageData;
  });
  checkAbort(signal);
  const canvas = document.createElement("canvas"); canvas.width = spec.size; canvas.height = spec.size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error("浏览器无法处理反推图片。");
  context.fillStyle = "#fff"; context.fillRect(0, 0, spec.size, spec.size);
  const squareSize = Math.max(image.naturalWidth, image.naturalHeight), ratio = spec.size / squareSize;
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(image, Math.floor((squareSize - image.naturalWidth) / 2) * ratio, Math.floor((squareSize - image.naturalHeight) / 2) * ratio, image.naturalWidth * ratio, image.naturalHeight * ratio);
  return taggerBgrTensor(context.getImageData(0, 0, spec.size, spec.size).data, spec);
}
export async function runBrowserTagger(options: { modelId: string; image: string; generalThreshold: number; characterThreshold: number; signal?: AbortSignal; onProgress?: (status: string) => void }): Promise<TaggerPrediction[]> {
  if (running) throw new Error("本地标签反推正在运行，请等待完成或取消。");
  if (!options.modelId) throw new Error("请在设置中导入并选择本地 ONNX 标签模型。");
  running = true;
  const cancel = () => disposeTaggerWorker();
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    checkAbort(options.signal);
    const record = await getTaggerModel(options.modelId);
    checkAbort(options.signal);
    options.onProgress?.(loadedModelId === record.id ? "正在准备图片…" : "正在加载本地 ONNX 模型…");
    let response: WorkerResponse;
    if (loadedModelId !== record.id) {
      disposeTaggerWorker();
      const model = await record.model.arrayBuffer();
      const externalData = await Promise.all((record.externalData || []).map(async file => ({ path: file.path, data: await file.data.arrayBuffer() })));
      checkAbort(options.signal);
      response = await sendWorker({ type: "load", model, externalData }, [model, ...externalData.map(file => file.data)]);
      loadedModelId = record.id;
    } else response = await sendWorker({ type: "metadata" });
    checkAbort(options.signal);
    const spec = taggerInputSpec(response.dimensions || [], response.type);
    options.onProgress?.("正在准备图片…");
    const tensor = await imageTensor(options.image, spec, options.signal);
    checkAbort(options.signal);
    options.onProgress?.("正在本机识别标签…");
    const result = await sendWorker({ type: "infer", tensor, dimensions: spec.dimensions }, [tensor.buffer]);
    checkAbort(options.signal);
    if (!result.scores) throw new Error("标签模型未返回概率输出。");
    return selectTaggerPredictions(record.labels, result.scores, options.generalThreshold, options.characterThreshold);
  } finally { options.signal?.removeEventListener("abort", cancel); running = false; }
}
