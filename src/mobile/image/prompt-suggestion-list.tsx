"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PromptCompletion } from "@/lib/prompt-completion";
import { observePromptOverlay, promptOverlayViewport } from "./prompt-overlay";

export function PromptSuggestionList({ anchor, listId, suggestions, active, setActive, accept, related = false, showDetails = false }: {
  anchor: RefObject<HTMLElement | null>;
  listId: string;
  suggestions: PromptCompletion[];
  active: number;
  setActive: (index: number) => void;
  accept: (hit: PromptCompletion) => void;
  related?: boolean;
  showDetails?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    const field = anchor.current;
    if (!node || !field) return;
    const place = () => {
      const bounds = field.getBoundingClientRect();
      const viewport = promptOverlayViewport();
      const pane = field.closest(".mobile-studio-workspace-content");
      const topEdge = Math.max(viewport.top, pane ? pane.getBoundingClientRect().top + 4 : viewport.top);
      const height = viewport.bottom - topEdge;
      if (!bounds.height || height <= 0 || bounds.bottom <= topEdge || bounds.top >= viewport.bottom) {
        node.style.visibility = "hidden";
        return;
      }
      const below = Math.max(0, viewport.bottom - bounds.bottom - 4);
      const above = Math.max(0, bounds.top - topEdge - 4);
      // On very short viewports, overlap the bottom of the editor instead of clipping the list.
      const overlap = Math.max(above, below) < Math.min(120, Math.max(56, height / 2));
      const upward = overlap || (below < 180 && above > below);
      const width = Math.min(Math.max(bounds.width, 260), viewport.width);
      const top = overlap ? viewport.bottom : upward ? bounds.top - 4 : bounds.bottom + 4;
      const maxHeight = Math.min(240, overlap ? Math.min(height, Math.max(56, height / 2)) : upward ? above : below);
      node.classList.toggle("is-compact", maxHeight < 70);
      Object.assign(node.style, {
        left: `${Math.max(viewport.left, Math.min(bounds.left, viewport.right - width))}px`,
        width: `${width}px`, top: `${top}px`, translate: upward ? "0 -100%" : "none",
        maxHeight: `${maxHeight}px`,
        visibility: "visible",
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(field);
    const stopObserving = observePromptOverlay(place);
    return () => { observer.disconnect(); stopObserving(); };
  }, [anchor]);

  const catalogKey = showDetails ? suggestions[active]?.catalogKey : undefined;
  return createPortal(<div ref={panel} data-replica-menu id={listId} className="tag-suggest-panel replica-completion-panel" role="listbox" aria-label={related ? "本地共现标签" : "标签联想"}>
    <p className="tag-suggest-head">{related ? "本次历史 / 我的词库共现" : "标签建议 · 点按插入"}</p>
    <div className="tag-suggest-list">{suggestions.map((hit, index) => <button type="button" id={`${listId}-${index}`} key={hit.catalogKey || hit.name} role="option" tabIndex={-1} aria-selected={index === active} title={hit.description || hit.zh || hit.name}
      onMouseDown={(event) => event.preventDefault()} onClick={() => accept(hit)} onMouseEnter={() => setActive(index)} className={"tag-suggest-item" + (index === active ? " is-active" : "")}>
      <span className="tag-suggest-name">{hit.displayName || hit.name}{hit.zh && hit.zh !== (hit.displayName || hit.name) && <span className="tag-suggest-zh">{hit.zh}</span>}{showDetails && hit.description && <span className="block line-clamp-2 text-[10px] font-normal leading-4 text-[var(--muted)]">{hit.description}</span>}</span>
      <span className="tag-suggest-meta">{hit.categoryName || "标签"}{showDetails && hit.source === "danbooru" ? " · Danbooru" : ""}{hit.occurrences != null ? ` · ${hit.occurrences} 条记录` : showDetails && hit.postCount != null && hit.source !== "quicktagcloud" ? ` · ${hit.postCount.toLocaleString("zh-CN")}` : ""}</span>
    </button>)}</div>
    {catalogKey && <a className="block border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--rose)]"
      href={`/tags?key=${encodeURIComponent(catalogKey)}`} target="_blank" rel="noreferrer"
      onMouseDown={(event) => event.preventDefault()}>查看当前标签的完整介绍与原始记录 ↗</a>}
  </div>, document.body);
}
