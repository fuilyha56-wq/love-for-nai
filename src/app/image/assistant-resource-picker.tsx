"use client";
import { useAssistantResourceViewport } from "@/app/ui/use-assistant-resource-viewport";

import Image from "next/image";
import { Check, History, ImagePlus, Images, Search, X } from "lucide-react";
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
  const pickerWidth = Math.max(1, Math.min(720, viewport.width - 16));
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
    <section className="assistant-resource-masthead" aria-label="参考图选择工具栏">
      <div className="resource-masthead-row">
        <div className="resource-masthead-identity"><span className="resource-masthead-mark" aria-hidden="true"><ImagePlus size={19} /></span><div><h2 id={titleId}>添加参考图</h2><p>为助手补充视觉参考</p></div></div>
        <button className="resource-dismiss" type="button" aria-label="关闭助手资源选择" title="关闭参考图选择（Esc）" onClick={p.onClose}><X size={15} /><span>关闭</span><kbd aria-hidden="true">Esc</kbd></button>
      </div>
      <div className="resource-source-options" role="group" aria-label="参考图资源来源">{(["history", "library", "public"] as const).map((value) => <button className="resource-source-option" type="button" aria-pressed={tab === value} key={value} onClick={() => { setTab(value); setSearch(""); }}>
        <span className="resource-source-icon" aria-hidden="true">{value === "history" ? <History size={18} /> : value === "library" ? <Images size={18} /> : <ImagePlus size={18} />}</span>
        <span className="resource-source-copy"><b>{value === "history" ? "生成历史" : value === "library" ? "本机参考库" : "公开图库"}</b><small>{value === "public" ? "浏览共享作品" : `${p.resources.filter(item => item.kind === value).length} 张素材`}</small></span>
        <span className="resource-source-current" aria-hidden="true">{tab === value && <Check size={13} />}</span>
      </button>)}</div>
    </section>
    <div className="assistant-resource-body">{tab === "public" ? <GalleryPicker returnDataUrl onSelect={(source, item) => choose([{ source, name: item.title }])}/> : <><label className="assistant-resource-search"><Search size={17} /><span className="sr-only">搜索资源</span><input aria-label="搜索资源" value={search} placeholder="图片名称或提示词" onChange={(event) => setSearch(event.target.value)}/>{search && <button type="button" aria-label="清空资源搜索" onClick={() => setSearch("")}><X size={16} /></button>}</label><div className="assistant-resource-grid">{visible.map((item) => <button type="button" key={item.id} aria-pressed={activeSelected.includes(item.id)} disabled={!activeSelected.includes(item.id) && activeSelected.length >= p.available} onClick={() => setSelected((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])}><Image unoptimized src={item.source} alt={item.name} width={160} height={120}/><span className="resource-card-copy"><strong>{item.name}</strong><small>{item.description || (item.kind === "history" ? "生成历史" : "本机参考库")}</small></span><span className="resource-card-check" aria-hidden="true">{activeSelected.includes(item.id) ? <Check size={15} /> : <ImagePlus size={15} />}</span></button>)}</div>{!visible.length && <p className="resource-empty"><Images size={28} /><b>没有匹配的参考图</b><span>试试其他关键词，或切换资源来源。</span></p>}</>}</div>
    <footer><span>还可添加 {p.available} 张 · 选中 {activeSelected.length} 张</span><button type="button" disabled={!activeSelected.length || p.available < 1} onClick={() => choose(p.resources.filter((item) => activeSelected.includes(item.id)).map(({ source, name }) => ({ source, name })))}><Check size={15} />{activeSelected.length ? `添加 ${activeSelected.length} 张参考图` : "添加选中参考图"}</button></footer>
  </dialog>, document.body);
}
