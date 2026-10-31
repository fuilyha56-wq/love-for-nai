"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./use-dialog-focus";

/** Collection controls stay outside the image grid, as in GalleryCollectionWorkspace. */
export function CollectionToolbar({ title, icon, count, query, onQueryChange, actions, children, searchPlaceholder = "搜索已载入的图片、提示词…" }: {
  title: string; icon: ReactNode; count: number; query: string; onQueryChange: (query: string) => void;
  actions?: ReactNode; children?: ReactNode; searchPlaceholder?: string;
}) {
  return <header className="launcher-collection-toolbar">
    <h1>{icon}{title}<output aria-label="已载入数量">{count}</output></h1>
    <label className="launcher-collection-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label={`搜索${title}`} placeholder={searchPlaceholder} value={query} onChange={event => onQueryChange(event.target.value)} /></label>
    {children}{actions}
  </header>;
}

export function CollectionPagination({ page, pageCount, total, onPageChange }: { page: number; pageCount: number; total: number; onPageChange: (page: number) => void }) {
  return <nav className="launcher-pagination" aria-label="图片分页"><span>{total} 张</span><button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={18} className="mx-auto" /></button><span aria-live="polite">{page} / {pageCount}</span><button type="button" aria-label="下一页" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}><ChevronRight size={18} className="mx-auto" /></button></nav>;
}

export function useCollectionView<T>(items: T[], searchText: (item: T) => string, pageSize = 24) {
  const [query, updateQuery] = useState("");
  const [requestedPage, setPage] = useState(1);
  const filtered = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return words.length ? items.filter(item => { const text = searchText(item).toLocaleLowerCase(); return words.every(word => text.includes(word)); }) : items;
  }, [items, query, searchText]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  return { query, setQuery: (value: string) => { updateQuery(value); setPage(1); }, page, setPage, pageCount, total: filtered.length, visible: filtered.slice((page - 1) * pageSize, page * pageSize) };
}

/** Touch and pointer users get the same actions; menus escape image-card clipping. */
export function ImageCardMenu({ label, children, triggerContent }: { label: string; children: ReactNode; triggerContent?: ReactNode }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = Boolean(position);
  useDialogFocus(open, menu);
  useLayoutEffect(() => {
    if (!open || !menu.current || !button.current) return;
    const trigger = button.current.getBoundingClientRect();
    const popup = menu.current.getBoundingClientRect();
    const viewport = visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = top + (viewport?.height || innerHeight);
    const desired = trigger.bottom + popup.height + 12 <= bottom ? trigger.bottom + 4 : trigger.top - popup.height - 4;
    setPosition({ left: Math.max(8, Math.min(innerWidth - popup.width - 8, trigger.right - popup.width)), top: Math.max(top + 8, Math.min(bottom - popup.height - 8, desired)) });
  }, [open]);
  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => { if (event.target instanceof Node && menu.current?.contains(event.target)) return; setPosition(null); };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [position]);
  return <><button ref={button} className="launcher-image-menu-button" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={() => {
    if (position) { setPosition(null); return; }
    const rect = button.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(innerWidth - 232, rect.right - 224)), top: rect.bottom + 4 });
  }}>{triggerContent ?? <MoreHorizontal size={20} />}</button>{position && createPortal(<div className="launcher-image-menu-backdrop" onClick={() => setPosition(null)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setPosition(null); } }}><div ref={menu} tabIndex={-1} role="menu" aria-label={label} className="launcher-image-menu" style={position} onClick={event => { event.stopPropagation(); if (event.target instanceof Element && event.target.closest("a,button") && !event.target.closest("[data-keep-menu-open]")) setPosition(null); }}>{children}</div></div>, document.body)}</>;
}
