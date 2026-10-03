"use client";

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import {
  deleteTaggerModel,
  importTaggerModels,
  listTaggerModels,
  readTaggerPreferences,
  subscribeTaggerChanges,
  writeTaggerPreferences,
  type TaggerModelInfo,
} from "@/lib/browser-tagger";
import "./tagger-settings.css";

const directoryAttributes = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;

export default function TaggerSettings() {
  const [models, setModels] = useState<TaggerModelInfo[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const items = await listTaggerModels();
      setModels(items);
      const savedId = readTaggerPreferences().modelId;
      const nextId = items.some((item) => item.id === savedId) ? savedId : items[0]?.id || "";
      setSelectedId(nextId);
      if (nextId !== savedId) {
        try {
          writeTaggerPreferences({ modelId: nextId, onnx: Boolean(nextId) });
        } catch {
          setError("无法保存默认模型，请检查浏览器存储权限。");
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取本地模型。");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void refreshModels().catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "无法读取本地模型。");
      });
    };
    refresh();
    const unsubscribe = subscribeTaggerChanges(refresh);
    return () => {
      active = false;
      controllerRef.current?.abort();
      unsubscribe();
    };
  }, [refreshModels]);

  const importFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setImporting(true);
    setError("");
    setStatus("正在读取本地文件…");
    try {
      const imported = await importTaggerModels(Array.from(files), setStatus, controller.signal);
      setStatus(`已导入 ${imported.length} 个模型。图片和模型只在此浏览器处理。`);
      await refreshModels();
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") setStatus("导入已取消。");
      else {
        setStatus("");
        setError(reason instanceof Error ? reason.message : "导入模型失败。");
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
      setImporting(false);
    }
  }, [refreshModels]);

  const selectModel = useCallback((model: TaggerModelInfo) => {
    try {
      writeTaggerPreferences({ modelId: model.id });
      setSelectedId(model.id);
      setError("");
    } catch {
      setError("无法保存默认模型，请检查浏览器存储权限。");
    }
  }, []);

  const removeModel = useCallback(async (model: TaggerModelInfo) => {
    setBusy(true);
    setError("");
    try {
      await deleteTaggerModel(model.id);
      setStatus(`已移除“${model.name}”。`);
      await refreshModels();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移除模型失败。");
    } finally {
      setBusy(false);
    }
  }, [refreshModels]);

  return (
    <section id="local-tagger" className="panel rounded-md p-5 sm:p-6 tagger-settings" aria-labelledby="tagger-settings-heading">
      <div className="tagger-settings-head">
        <div className="tagger-settings-copy">
          <p className="tagger-settings-eyebrow">LOCAL INFERENCE · 本机推理</p>
          <h2 id="tagger-settings-heading">本地 ONNX 标签反推</h2>
          <p>导入 WD tagger 的 <code>.onnx</code> 与配套 <code>selected_tags.csv</code>。模型保存在此浏览器，图片在本机处理，不会上传到服务器。</p>
        </div>
        <div className="tagger-settings-actions">
          <button type="button" className="settings-primary-button" disabled={busy} onClick={() => folderRef.current?.click()}><FolderOpen size={16} />选择模型文件夹</button>
          <button type="button" className="settings-secondary-button" disabled={busy} onClick={() => filesRef.current?.click()}>选择模型和标签文件</button>
          {importing && <button type="button" className="settings-secondary-button" onClick={() => controllerRef.current?.abort()}>取消导入</button>}
        </div>
      </div>
      <input ref={folderRef} type="file" multiple hidden {...directoryAttributes} onChange={(event) => { void importFiles(event.target.files); event.target.value = ""; }} />
      <input ref={filesRef} type="file" multiple hidden accept=".onnx,.csv,.data,.bin,.onnx_data" onChange={(event) => { void importFiles(event.target.files); event.target.value = ""; }} />
      <p className="tagger-settings-hint">每个模型与标签 CSV 放在同一文件夹，可一次选择多个模型；外部权重 <code>.data</code> / <code>.bin</code> 会一并导入。清除站点数据会移除模型。</p>
      {status && <p className="tagger-settings-status" role="status" aria-live="polite">{status}</p>}
      {error && <p className="tagger-settings-error" role="alert">{error}</p>}
      {models.length ? (
        <div className="tagger-model-list" aria-label="已导入本地标签模型">
          {models.map((model) => (
            <article className="tagger-model-item" key={model.id}>
              <label>
                <input type="radio" name="local-tagger-model" checked={selectedId === model.id} disabled={busy} onChange={() => selectModel(model)} />
                <span className="tagger-model-details"><b>{model.name}</b><small>{model.modelName} · {model.tagCount.toLocaleString()} 标签 · {(model.bytes / 1024 / 1024).toFixed(1)} MB</small></span>
              </label>
              <button type="button" className="tagger-remove-button" disabled={busy} onClick={() => void removeModel(model)} aria-label={`移除本地模型 ${model.name}`}><Trash2 size={17} /></button>
            </article>
          ))}
        </div>
      ) : !busy && (
        <div className="tagger-settings-empty">
          <p className="tagger-empty-title">尚未导入本地标签模型</p>
          <p>从上方选择文件夹导入，或前往 <a href="https://huggingface.co/SmilingWolf" target="_blank" rel="noreferrer">Hugging Face · SmilingWolf</a> 获取 WD tagger 模型。</p>
        </div>
      )}
    </section>
  );
}
