"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { clientUuid } from "@/lib/client-uuid";
import { UserAvatar } from "./user-avatar";
import { useDialogFocus } from "@/mobile/ui/use-dialog-focus";
import "./avatar-editor.css";

export function AvatarEditor({ userId, name, balance, onSaved }: { userId: number; name: string; balance?: number; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0, zoom: 1 });
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(Boolean(file), dialog);
  useEffect(() => {
    if (!file) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [file]);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file), decoded = new Image();
    decoded.onload = () => setImage(decoded);
    decoded.onerror = () => setError("图片无法读取，请重新选择。");
    decoded.src = url;
    return () => { decoded.onload = null; decoded.onerror = null; URL.revokeObjectURL(url); };
  }, [file]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!image || !context) return;
    const side = Math.max(1, Math.floor(Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom));
    context.clearRect(0, 0, 256, 256);
    context.drawImage(image, Math.round((image.naturalWidth - side) * (crop.x + 1) / 2), Math.round((image.naturalHeight - side) * (crop.y + 1) / 2), side, side, 0, 0, 256, 256);
  }, [image, crop]);
  function updateCrop(next: typeof crop) { setCrop(next); setRequestId(clientUuid()); }
  function choose(selected?: File) {
    if (!selected) return;
    if (!/^image\/(png|jpeg|webp)$/.test(selected.type) || selected.size > 5 * 1024 * 1024) { setMessage("请选择 5 MB 以内的 PNG、JPEG 或 WebP 图片。"); return; }
    setError(""); setMessage(""); setImage(null); setCrop({ x: 0, y: 0, zoom: 1 }); setRequestId(clientUuid()); setFile(selected);
  }
  async function save() {
    if (!file || busy || !image) return;
    setBusy(true); setError("");
    try {
      const body = new FormData();
      body.set("file", file); body.set("requestId", requestId);
      body.set("x", String(crop.x)); body.set("y", String(crop.y)); body.set("zoom", String(crop.zoom));
      const response = await fetch("/api/me/avatar", { method: "PUT", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "头像保存失败");
      window.dispatchEvent(new CustomEvent("lfn-avatar-updated", { detail: { userId } }));
      setFile(null); setMessage("头像已更新。"); onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "头像保存失败，请重试"); }
    finally { setBusy(false); }
  }
  return <div className="avatar-settings">
    <UserAvatar userId={userId} name={name} size={64} />
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    <button type="button" className="avatar-change-button" onClick={() => input.current?.click()}><Camera size={15} />修改头像 · 5 AFF</button>
    {message && <p role="status">{message}</p>}
    {file && createPortal(<div className="avatar-editor-backdrop" onClick={event => { if (!busy && event.target === event.currentTarget) setFile(null); }} onKeyDown={event => { if (!busy && event.key === "Escape") setFile(null); }}>
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="修改头像" className="avatar-editor-dialog">
        <header><h2>修改头像</h2><button type="button" aria-label="关闭头像编辑" disabled={busy} onClick={() => setFile(null)}><X size={20} /></button></header>
        <div className="avatar-editor-body"><canvas ref={canvas} width={256} height={256} aria-label="头像裁剪预览" />
          <label>缩放<input aria-label="头像缩放" type="range" min={1} max={3} step={.01} value={crop.zoom} disabled={busy} onChange={event => updateCrop({ ...crop, zoom: Number(event.target.value) })} /></label>
          <label>水平位置<input aria-label="头像水平位置" type="range" min={-1} max={1} step={.01} value={crop.x} disabled={busy} onChange={event => updateCrop({ ...crop, x: Number(event.target.value) })} /></label>
          <label>垂直位置<input aria-label="头像垂直位置" type="range" min={-1} max={1} step={.01} value={crop.y} disabled={busy} onChange={event => updateCrop({ ...crop, y: Number(event.target.value) })} /></label>
          <p>保存后将压缩为 256 × 256 的静态头像，每次修改扣除 5 个人 AFF。{balance != null && `当前可用 ${balance} AFF。`}</p>
          {error && <p role="alert" className="avatar-editor-error">{error}</p>}
        </div>
        <footer><button type="button" disabled={busy} onClick={() => setFile(null)}>取消</button><button type="button" disabled={busy || !image || (balance != null && balance < 5)} onClick={() => void save()}>{busy ? "保存中…" : "支付 5 AFF 并保存头像"}</button></footer>
      </section>
    </div>, document.body)}
  </div>;
}
