"use client";
import { useAssistantResourceViewport } from "@/app/ui/use-assistant-resource-viewport";

import Image from "next/image";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GalleryPicker } from "./gallery-picker";
import { type AssistantImageResource, type AssistantImageSource } from "@/lib/assistant-image-resource";
import "./assistant-resource-picker.css";

export type AssistantResourcePickerProps = { open: boolean; scope: string; resources: AssistantImageResource[]; available: number; onClose: () => void; onSelect: (sources: AssistantImageSource[]) => void };
export function AssistantResourcePicker(p: AssistantResourcePickerProps) {
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null), alive = useRef(false);
  const [tab, setTab] = useState<"history" | "library" | "public">("history"), [search, setSearch] = useState(""), [selected, setSelected] = useState<string[]>([]);
  const titleId = useId(), viewport = useAssistantResourceViewport();
  const pickerWidth = Math.max(1, Math.min(880, viewport.width - 16));
  const [selectionScope, setSelectionScope] = useState(p.scope);
  const activeSelected = selectionScope === p.scope ? selected : [];
  useLayoutEffect(() => { alive.current = p.open; return () => { alive.current = false; }; }, [p.open, p.scope]);
  useEffect(() => {
    if (!p.open) return;
    const panel = dialog.current; opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.showModal();
    void Promise.resolve().then(() => { if (alive.current) { setSelected([]); setSelectionScope(p.scope); setSearch(""); setTab("history"); } });
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { panel?.close(); document.body.style.overflow = overflow; const previous = opener.current; requestAnimationFrame(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }); }); };
  }, [p.open, p.scope]);
  function choose(sources: AssistantImageSource[]) { if (!alive.current) return; p.onSelect(sources.slice(0, p.available)); p.onClose(); }
  if (!p.open || typeof document === "undefined") return null;
  const visible = p.resources.filter((item) => item.kind === tab && `${item.name} ${item.description || ""}`.toLowerCase().includes(search.toLowerCase()));
  return createPortal(<dialog role="dialog" aria-modal="true" data-assistant-resource-picker data-compact={viewport.height > 0 && viewport.height < 450 ? "true" : undefined} style={viewport.height > 0 ? { position: "fixed", left: viewport.left + Math.max(0, (viewport.width - pickerWidth) / 2), top: viewport.top + 8, margin: 0, width: pickerWidth, maxHeight: Math.max(1, viewport.height - 16) } : undefined} ref={dialog} className="assistant-resource-picker" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); p.onClose(); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); p.onClose(); return; }
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
      const panel = dialog.current; if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],summary,[tabindex]")).filter(item => item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest("[hidden],[inert],[aria-hidden=true]") && item.getClientRects().length > 0);
      const first = items[0], last = items.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (active === last || active === panel || !panel.contains(active))) { event.preventDefault(); first.focus(); }
      event.stopPropagation();
    }} onClick={(event) => { if (event.target === event.currentTarget) p.onClose(); }}>
    <header><h2 id={titleId}>选择助手参考图</h2><button type="button" aria-label="关闭助手资源选择" onClick={p.onClose}>关闭</button></header>
    <nav aria-label="参考图资源来源">{(["history", "library", "public"] as const).map((value) => <button type="button" aria-pressed={tab === value} key={value} onClick={() => { setTab(value); setSearch(""); }}>{value === "history" ? "生成历史" : value === "library" ? "本机参考库" : "公开图库"}</button>)}</nav>
    <div className="assistant-resource-body">{tab === "public" ? <GalleryPicker returnDataUrl onSelect={(source, item) => choose([{ source, name: item.title }])}/> : <><label className="assistant-resource-search">搜索资源<input value={search} placeholder="图片名称或提示词" onChange={(event) => setSearch(event.target.value)}/></label><div className="assistant-resource-grid">{visible.map((item) => <button type="button" key={item.id} aria-pressed={activeSelected.includes(item.id)} disabled={!activeSelected.includes(item.id) && activeSelected.length >= p.available} onClick={() => setSelected((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])}><Image unoptimized src={item.source} alt={item.name} width={160} height={120}/><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</button>)}</div>{!visible.length && <p>当前没有匹配的图片。可从公开图库或本地文件添加。</p>}</>}</div>
    <footer><span>还可添加 {p.available} 张 · 选中 {activeSelected.length} 张</span><button type="button" disabled={!activeSelected.length || p.available < 1} onClick={() => choose(p.resources.filter((item) => activeSelected.includes(item.id)).map(({ source, name }) => ({ source, name })))}>添加选中参考图</button></footer>
  </dialog>, document.body);
}
