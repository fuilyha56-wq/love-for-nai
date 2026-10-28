"use client";

import Link from "next/link";
import { usePanelHistory } from "@/app/ui/use-panel-history";
import { ArrowLeft, Check, ChevronDown, Copy, Info, Minus, Plus, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { copyTextToClipboard } from "@/lib/client-clipboard";
import { useDialogFocus } from "./use-dialog-focus";
import "./image-detail-workspace.css";

const wideQuery = "(min-width: 1100px)";
function subscribeWidth(listener: () => void) {
  const query = window.matchMedia(wideQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Aaalice DetailImageViewer: content-sized image and adaptive metadata surface. */
export function ImageDetailWorkspace({ title, backHref, backLabel, image, metadata, notice, loading, error, presentation = "viewer", children }: {
  title: string; backHref: string; backLabel: string; image: ReactNode; metadata: ReactNode;
  notice?: ReactNode; loading?: boolean; error?: string; presentation?: "viewer" | "details"; children?: ReactNode;
}) {
  const wide = useSyncExternalStore(subscribeWidth, () => window.matchMedia(wideQuery).matches, () => false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  usePanelHistory("lfnImageViewer", imageOpen ? "image" : metadataOpen ? "metadata" : null, next => {
    setImageOpen(next === "image"); setMetadataOpen(next === "metadata");
  });
  const inlineDetails = presentation === "details" && !imageOpen;
  const dialog = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  useDialogFocus(metadataOpen && !wide, dialog);
  const [panelWidth, setPanelWidth] = useState(360);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointer: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const stage = useRef<HTMLElement>(null);
  const clampZoom = (value: number) => Math.max(.5, Math.min(4, value));
  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }); }
  function endPan(event: React.PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    setPan({ x: current.startX + event.clientX - current.x, y: current.startY + event.clientY - current.y });
    drag.current = null;
  }
  function clampWidth(value: number) { return Math.max(300, Math.min(520, innerWidth - 520, value)); }
  function resize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    let nextWidth = startWidth;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      nextWidth = clampWidth(startWidth + startX - pointer.clientX);
      workspace.current?.style.setProperty("--detail-panel-width", `${nextWidth}px`);
    };
    const end = () => { setPanelWidth(nextWidth); handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  return <main className={`launcher-image-detail-page${inlineDetails ? " is-details" : ""}`}>
    <header className="launcher-detail-topbar" inert={metadataOpen && !wide}>
      {presentation === "details" && imageOpen
        ? <button type="button" aria-label="返回作品详情" onClick={() => { setImageOpen(false); setMetadataOpen(false); resetView(); }}><ArrowLeft size={20} /><span>作品详情</span></button>
        : <Link replace href={backHref} scroll={!backHref.startsWith("/gallery")} aria-label={`返回${backLabel}`}><ArrowLeft size={20} /><span>{backLabel}</span></Link>}
      <h1>{title}</h1>
      {inlineDetails
        ? <button type="button" disabled={!image || loading} onClick={() => setImageOpen(true)}><Plus size={19} /><span>查看大图</span></button>
        : <button type="button" className="launcher-detail-info-button" disabled={!metadata || loading} aria-haspopup="dialog" aria-expanded={metadataOpen && !wide} onClick={() => setMetadataOpen(true)}><Info size={19} /><span>图片信息</span></button>}
    </header>
    {notice && <div className="launcher-detail-notice" role="status">{notice}</div>}
    <div className="launcher-detail-body" ref={workspace} style={{ "--detail-panel-width": `${panelWidth}px` } as React.CSSProperties} inert={metadataOpen && !wide}>
      <section ref={stage} className="launcher-detail-stage" aria-label="图片预览" tabIndex={0} data-zoomed={zoom > 1} style={{ "--detail-zoom": zoom, "--detail-pan-x": `${pan.x}px`, "--detail-pan-y": `${pan.y}px` } as React.CSSProperties}
        onDoubleClick={event => { if (event.target instanceof Element && event.target.closest("button,a,summary")) return; if (inlineDetails) { setImageOpen(true); return; } if (zoom === 1) setZoom(2); else resetView(); }}
        onWheel={event => { if (!inlineDetails && !event.ctrlKey && !loading && !error) setZoom(value => clampZoom(value * (event.deltaY > 0 ? .9 : 1.1))); }}
        onPointerDown={event => { if (inlineDetails || zoom <= 1 || (event.target instanceof Element && event.target.closest("button,a,summary"))) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y }; }}
        onPointerMove={event => { const current = drag.current; if (!current || current.pointer !== event.pointerId) return; event.currentTarget.style.setProperty("--detail-pan-x", `${current.startX + event.clientX - current.x}px`); event.currentTarget.style.setProperty("--detail-pan-y", `${current.startY + event.clientY - current.y}px`); }}
        onPointerUp={endPan} onPointerCancel={endPan}
        onKeyDown={event => { if (inlineDetails || event.target !== event.currentTarget) return; if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom(value => clampZoom(value * 1.25)); } else if (event.key === "-") { event.preventDefault(); setZoom(value => clampZoom(value / 1.25)); } else if (event.key === "0") { event.preventDefault(); resetView(); } }}>
        {error ? <p role="alert">{error}</p> : loading ? <p role="status">正在读取图片…</p> : <>{image}{!inlineDetails && <div className="launcher-detail-zoom" role="toolbar" aria-label="图片缩放"><button type="button" aria-label="缩小图片" disabled={zoom <= .5} onClick={() => setZoom(value => clampZoom(value / 1.25))}><Minus size={18} /></button><button type="button" aria-label="适应窗口" title="适应窗口（0）" onClick={resetView}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="放大图片" disabled={zoom >= 4} onClick={() => setZoom(value => clampZoom(value * 1.25))}><Plus size={18} /></button></div>}</>}
      </section>
      <div className="launcher-detail-resizer" role="separator" aria-label="调整图片信息宽度" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={520} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={resize} onKeyDown={event => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); setPanelWidth(value => clampWidth(value + (event.key === "ArrowLeft" ? 16 : -16))); }} />
      <aside className="launcher-detail-metadata" aria-label="图片信息" hidden={!inlineDetails && !wide}>{metadata}</aside>
    </div>
    {children && <div className="launcher-detail-comments" hidden={!inlineDetails}>{children}</div>}
    {metadataOpen && !wide && <div className="launcher-detail-backdrop" onClick={() => setMetadataOpen(false)} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); setMetadataOpen(false); } }}>
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="图片信息" className="launcher-detail-dialog" onClick={event => event.stopPropagation()}><header><h2>图片信息</h2><button type="button" aria-label="关闭图片信息" onClick={() => setMetadataOpen(false)}><X size={20} /></button></header><div className="launcher-detail-dialog-content">{metadata}</div></section>
    </div>}
  </main>;
}

export function ImagePromptSection({ title, value }: { title: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try { await copyTextToClipboard(value); setFeedback("已复制"); }
    catch { setFeedback("复制失败，请选择文字复制"); }
  }
  return <section className="launcher-detail-prompt"><header><button type="button" aria-label={`${expanded ? "收起" : "展开"}${title}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><strong>{title}</strong><ChevronDown size={16} className={expanded ? "is-expanded" : undefined} /></button><button type="button" aria-label={`复制${title}`} onClick={() => void copy()}>{feedback === "已复制" ? <Check size={16} /> : <Copy size={16} />}<span>复制</span></button></header><p className={expanded ? undefined : "is-collapsed"}>{value}</p>{feedback && <small role="status">{feedback}</small>}</section>;
}

const parameterLabels: Record<string, string> = { model: "模型", width: "宽度", height: "高度", steps: "步数", scale: "引导强度", seed: "种子", sampler: "采样器", noise_schedule: "噪声计划", cfg_rescale: "引导重缩放", operation: "操作", quality: "质量", strength: "变化强度", n_samples: "张数" };
export function ImageMetadataParameters({ entries }: { entries: Array<[string, unknown]> }) {
  return <section className="launcher-detail-parameters"><h2>生成设置</h2><dl>{entries.map(([key, value]) => <div key={key}><dt>{parameterLabels[key] || key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></section>;
}
