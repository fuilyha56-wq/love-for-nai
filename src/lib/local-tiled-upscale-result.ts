import { safeSaveFilename } from "./client-file-save";
import { clientUuid } from "./client-uuid";

const DATABASE = "lfn-local-tiled-upscale-v1";
const RESULTS = "results";
const CHUNKS = "chunks";
const STAGES = "stages";
const CHUNK_BYTES = 4 * 1024 * 1024;
const ABANDONED_STAGE_MS = 24 * 60 * 60 * 1000;
const PNG_TYPE = "image/png";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_END = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

export type LocalTiledUpscaleResult = { id: string; bytes: number; savedAt: number; width: number; height: number };
type ResultManifest = LocalTiledUpscaleResult & { storageId: string; chunkCount: number };
type Stage = { storageId: string; resultId: string; updatedAt: number };
type Chunk = { storageId: string; index: number; blob: Blob };
type SaveOptions = { signal?: AbortSignal; onProgress?: (progress: { bytes: number; total?: number }) => void };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(RESULTS, { keyPath: "id" });
      db.createObjectStore(CHUNKS, { keyPath: ["storageId", "index"] });
      const stages = db.createObjectStore(STAGES, { keyPath: "storageId" });
      stages.createIndex("resultId", "resultId");
      stages.createIndex("updatedAt", "updatedAt");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("无法打开本地分块图像存储"));
  });
}

function readRecord<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error || new Error("无法读取本地分块图像"));
  });
}

function commit(db: IDBDatabase, stores: string[], change: (transaction: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new DOMException("本地分块保存已中止", "AbortError"));
    try { change(transaction); }
    catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function deleteChunks(transaction: IDBTransaction, storageId: string) {
  transaction.objectStore(CHUNKS).delete(IDBKeyRange.bound([storageId, 0], [storageId, Number.MAX_SAFE_INTEGER]));
}

function deleteStage(transaction: IDBTransaction, storageId: string) {
  deleteChunks(transaction, storageId);
  transaction.objectStore(STAGES).delete(storageId);
}

function deleteStagesByIndex(transaction: IDBTransaction, index: "resultId" | "updatedAt", range: IDBKeyRange) {
  const cursor = transaction.objectStore(STAGES).index(index).openKeyCursor(range);
  cursor.onsuccess = () => {
    if (!cursor.result) return;
    deleteStage(transaction, cursor.result.primaryKey as string);
    cursor.result.continue();
  };
}

async function persistChunk(db: IDBDatabase, stage: Stage, index: number, blob: Blob) {
  await commit(db, [STAGES, CHUNKS], (transaction) => {
    const stages = transaction.objectStore(STAGES);
    const current = stages.get(stage.storageId);
    current.onsuccess = () => {
      if (!current.result) { transaction.abort(); return; }
      transaction.objectStore(CHUNKS).put({ storageId: stage.storageId, index, blob } satisfies Chunk);
      stages.put({ ...stage, updatedAt: Date.now() } satisfies Stage);
    };
  });
}

async function publishResult(db: IDBDatabase, manifest: ResultManifest, signal?: AbortSignal): Promise<ResultManifest> {
  let result = manifest;
  await commit(db, [RESULTS, STAGES, CHUNKS], (transaction) => {
    signal?.throwIfAborted();
    const abort = () => {
      try { transaction.abort(); }
      catch { /* An already committed transaction cannot be canceled. */ }
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
    transaction.addEventListener("complete", cleanup, { once: true });
    transaction.addEventListener("abort", cleanup, { once: true });
    const stages = transaction.objectStore(STAGES);
    const stage = stages.get(manifest.storageId);
    stage.onsuccess = () => {
      if (!stage.result) { transaction.abort(); return; }
      const results = transaction.objectStore(RESULTS);
      const existing = results.get(manifest.id);
      existing.onsuccess = () => {
        if (existing.result) {
          result = existing.result as ResultManifest;
          deleteStage(transaction, manifest.storageId);
        } else {
          results.add(manifest);
          stages.delete(manifest.storageId);
        }
      };
    };
  });
  return result;
}

function resultMetadata({ id, bytes, savedAt, width, height }: ResultManifest): LocalTiledUpscaleResult {
  return { id, bytes, savedAt, width, height };
}

function pngDimensions(header: Uint8Array) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (!PNG_SIGNATURE.every((value, index) => header[index] === value) || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    throw new Error("服务器没有返回有效的 PNG 合成图。");
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) throw new Error("合成图尺寸无效。");
  return { width, height };
}

let requestedPersistence = false;
function requestPersistentStorage() {
  if (requestedPersistence || typeof navigator === "undefined" || !navigator.storage?.persist) return;
  requestedPersistence = true;
  void Promise.resolve().then(() => navigator.storage.persist()).catch(() => undefined);
}

/** Save one network chunk at a time and publish only after receiving a complete PNG. */
export async function saveLocalTiledUpscaleResult(id: string, url: string, { signal, onProgress }: SaveOptions = {}): Promise<LocalTiledUpscaleResult> {
  signal?.throwIfAborted();
  const db = await openDatabase();
  const stage: Stage = { storageId: clientUuid(), resultId: id, updatedAt: Date.now() };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancelReader = () => { void reader?.cancel(signal?.reason).catch(() => undefined); };
  let staged = false;
  try {
    const saved = await readRecord<ResultManifest>(db, RESULTS, id);
    if (saved) return resultMetadata(saved);
    await commit(db, [STAGES, CHUNKS], (transaction) => {
      deleteStagesByIndex(transaction, "updatedAt", IDBKeyRange.upperBound(Date.now() - ABANDONED_STAGE_MS));
      transaction.objectStore(STAGES).add(stage);
    });
    staged = true;
    const response = await fetch(url, { cache: "no-store", signal });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(error?.message || `无法读取原尺寸合成图（HTTP ${response.status}）。`);
    }
    if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== PNG_TYPE) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("服务器没有返回 PNG 合成图。");
    }
    reader = response.body.getReader();
    if (signal?.aborted) cancelReader();
    else signal?.addEventListener("abort", cancelReader, { once: true });

    const encoding = response.headers.get("Content-Encoding");
    const contentLength = Number(response.headers.get("Content-Length"));
    const total = (!encoding || encoding === "identity") && Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : undefined;
    const buffer = new Uint8Array(CHUNK_BYTES);
    const header = new Uint8Array(24);
    const tail = new Uint8Array(PNG_END.length);
    let buffered = 0;
    let bytes = 0;
    let index = 0;
    let dimensions: { width: number; height: number } | undefined;

    const flush = async () => {
      signal?.throwIfAborted();
      await persistChunk(db, stage, index++, new Blob([buffer.subarray(0, buffered)]));
      buffered = 0;
      onProgress?.({ bytes, total });
    };
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!value.byteLength) continue;
      if (!dimensions) {
        header.set(value.subarray(0, header.length - bytes), bytes);
        if (bytes + value.byteLength >= header.length) dimensions = pngDimensions(header);
      }
      if (value.byteLength >= tail.length) tail.set(value.subarray(value.byteLength - tail.length));
      else {
        tail.copyWithin(0, value.byteLength);
        tail.set(value, tail.length - value.byteLength);
      }
      for (let offset = 0; offset < value.byteLength;) {
        const size = Math.min(value.byteLength - offset, buffer.length - buffered);
        buffer.set(value.subarray(offset, offset + size), buffered);
        offset += size;
        buffered += size;
        bytes += size;
        if (buffered === buffer.length) await flush();
      }
    }
    if (!dimensions || !PNG_END.every((value, offset) => tail[offset] === value) || (total !== undefined && bytes !== total)) {
      throw new Error("合成图没有完整传回，请重新保存。");
    }
    if (buffered) await flush();
    signal?.throwIfAborted();
    const manifest = await publishResult(db, { id, ...dimensions, bytes, chunkCount: index, savedAt: Date.now(), storageId: stage.storageId }, signal);
    staged = false;
    requestPersistentStorage();
    return resultMetadata(manifest);
  } catch (error) {
    if (error instanceof Error && error.name === "QuotaExceededError") {
      throw new Error("浏览器本地存储空间不足，无法保存完整合成图。", { cause: error });
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    if (reader) {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (staged) await commit(db, [STAGES, CHUNKS], (transaction) => deleteStage(transaction, stage.storageId)).catch(() => undefined);
    db.close();
  }
}

export async function hasLocalTiledUpscaleResult(id: string): Promise<boolean> {
  const db = await openDatabase();
  try { return Boolean(await readRecord<ResultManifest>(db, RESULTS, id)); }
  finally { db.close(); }
}

export async function removeLocalTiledUpscaleResult(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await commit(db, [RESULTS, STAGES, CHUNKS], (transaction) => {
      const results = transaction.objectStore(RESULTS);
      const existing = results.get(id);
      existing.onsuccess = () => {
        const manifest = existing.result as ResultManifest | undefined;
        if (manifest) deleteChunks(transaction, manifest.storageId);
        results.delete(id);
      };
      deleteStagesByIndex(transaction, "resultId", IDBKeyRange.only(id));
    });
  } finally { db.close(); }
}

async function* readChunks(db: IDBDatabase, manifest: ResultManifest) {
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const chunk = await readRecord<Chunk>(db, CHUNKS, [manifest.storageId, index]);
    const expectedSize = Math.min(CHUNK_BYTES, manifest.bytes - index * CHUNK_BYTES);
    if (!chunk || chunk.blob.size !== expectedSize) throw new Error("本地合成图的文件分块不完整。");
    yield chunk.blob;
  }
}

type WritableFile = { write: (blob: Blob) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> };
type SaveFilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<WritableFile> }>;

/** Return false only if the result is missing locally, so cancel never falls back to a network download. */
export async function downloadLocalTiledUpscaleResult(id: string, filename: string): Promise<boolean> {
  const db = await openDatabase();
  try {
    const manifest = await readRecord<ResultManifest>(db, RESULTS, id);
    if (!manifest) return false;
    const name = safeSaveFilename(filename);
    const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (picker) {
      let file: Awaited<ReturnType<SaveFilePicker>> | undefined;
      try { file = await picker.call(window, { suggestedName: name, types: [{ description: "PNG 图像", accept: { [PNG_TYPE]: [".png"] } }] }); }
      catch (error) {
        if (error instanceof Error && error.name === "AbortError") return true;
        if (!(error instanceof Error && ["SecurityError", "NotAllowedError"].includes(error.name))) throw error;
      }
      if (file) {
        const writable = await file.createWritable();
        try {
          for await (const chunk of readChunks(db, manifest)) await writable.write(chunk);
          await writable.close();
          return true;
        } catch (error) {
          await writable.abort?.().catch(() => undefined);
          throw error;
        }
      }
    }

    // Plain HTTP has no file picker. Use the stored Blob parts directly so
    // JavaScript never allocates a full-size byte array for the download.
    const parts: Blob[] = [];
    for await (const chunk of readChunks(db, manifest)) parts.push(chunk);
    const file = new Blob(parts, { type: PNG_TYPE });
    if (file.size !== manifest.bytes) throw new Error("当前浏览器无法从本地导出完整的合成图。");
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    try {
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    return true;
  } finally { db.close(); }
}
