"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { deleteTaggerModel, importTaggerModels, listTaggerModels, readTaggerPreferences, subscribeTaggerChanges, writeTaggerPreferences, type TaggerModelInfo } from "@/lib/browser-tagger";
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
  useEffect(() => {
    let active = true;
    const refresh = () => { void listTaggerModels().then(items => { if (!active) return; setModels(items); const savedId = readTaggerPreferences().modelId; const nextId = items.some(item => item.id === savedId) ? savedId : items[0]?.id || ""; setSelectedId(nextId); if (nextId !== savedId) { try { writeTaggerPreferences({ modelId: nextId, onnx: Boolean(nextId) }); } catch { setError("无法保存默认模型，请检查浏览器存储权限。"); } } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取本地模型。"); }); };
    refresh(); const unsubscribe = subscribeTaggerChanges(refresh);
    return () => { active = false; controllerRef.current?.abort(); unsubscribe(); };
  }, []);
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setBusy(true); setImporting(true); setError(""); setStatus("正在读取本地文件…");
    try { const imported = await importTaggerModels(Array.from(files), setStatus, controller.signal); setStatus(`已导入 ${imported.length} 个模型。图片和模型只在此浏览器处理。`); }
    catch (reason) { if (reason instanceof Error && reason.name === "AbortError") setStatus("导入已取消。"); else { setStatus(""); setError(reason instanceof Error ? reason.message : "导入模型失败。"); } }
    finally { if (controllerRef.current === controller) controllerRef.current = null; setBusy(false); setImporting(false); }
  }
  async function remove(id: string) {
    setBusy(true); setError("");
    try { await deleteTaggerModel(id); setStatus("已移除此浏览器中的模型。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "移除模型失败。"); }
    finally { setBusy(false); }
  }
  return <section id="local-tagger" className="panel tagger-settings" aria-labelledby="tagger-settings-heading">
    <div className="tagger-settings-head">
      <div>
        <h2 id="tagger-settings-heading">本地 ONNX 标签反推</h2>
        <p>导入 WD tagger 的 <code>.onnx</code> 和配套 <code>selected_tags.csv</code>。模型只保存在此浏览器，反推图片在本机处理，不会上传到服务器。</p>
      </div>
      <div className="tagger-settings-actions">
        <button type="button" className="button-primary" disabled={busy} onClick={() => folderRef.current?.click()}><FolderOpen size={16} />选择模型文件夹</button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => filesRef.current?.click()}>选择模型和标签文件</button>
        {importing && <button type="button" className="button-secondary" onClick={() => controllerRef.current?.abort()}>取消导入</button>}
      </div>
    </div>
    <input ref={folderRef} type="file" multiple hidden {...directoryAttributes} onChange={event => { void importFiles(event.target.files); event.target.value = ""; }} />
    <input ref={filesRef} type="file" multiple hidden accept=".onnx,.csv,.data,.bin,.onnx_data" onChange={event => { void importFiles(event.target.files); event.target.value = ""; }} />
    <p className="tagger-settings-hint">每个模型与标签 CSV 放在同一文件夹，可一次选择含多个模型的目录；外部权重 <code>.data</code> / <code>.bin</code> 会一并导入。清除站点数据会移除模型。</p>
    {status && <p role="status" aria-live="polite">{status}</p>}
    {error && <p className="tagger-settings-error" role="alert">{error}</p>}
    {models.length ? (
      <div className="tagger-model-list">{models.map(model => <div className="tagger-model-item" key={model.id}><label><input type="radio" name="local-tagger-model" checked={selectedId === model.id} disabled={busy} onChange={() => { try { writeTaggerPreferences({ modelId: model.id }); setSelectedId(model.id); } catch { setError("无法保存默认模型，请检查浏览器存储权限。"); } }} /><span><b>{model.name}</b><small>{model.modelName} · {model.tagCount.toLocaleString()} 标签 · {(model.bytes / 1024 / 1024).toFixed(1)} MB</small></span></label><button type="button" disabled={busy} onClick={() => void remove(model.id)} aria-label={`移除本地模型 ${model.name}`}><Trash2 size={17} /></button></div>)}</div>
    ) : !busy && (
      <div className="tagger-settings-empty">
        <p>尚未导入本地标签模型。</p>
        <p>从上方选择文件夹导入，或到 <a href="https://huggingface.co/SmilingWolf" target="_blank" rel="noreferrer">Hugging Face · SmilingWolf</a> 获取 WD tagger 模型。</p>
      </div>
    )}
  </section>;
}
