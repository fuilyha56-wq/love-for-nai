"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { insertPromptCompletion, loadPromptCompletionWordlist, localCooccurringTags, matchLocalPromptTags, promptCompletionText, promptTokenAt, type PromptCompletion } from "@/lib/prompt-completion";
import { tagZh } from "@/lib/tag-translations";
import { observePromptOverlay, promptOverlayViewport } from "./prompt-overlay";

export type TagHit = PromptCompletion;
const RESULT_CACHE = new Map<string, TagHit[]>();

/** Shared editor: local fallback, tag search, library aliases and private local cooccurrences. */
export function PromptAutocompleteTextarea({ value, onChange, className, placeholder, autocomplete = false, id, onContextMenu,
  library = [], cooccurrence = false, relatedSamples = [], onCopy, onFeedback,
}: {
  value: string; onChange: (value: string) => void; className?: string; placeholder?: string; autocomplete?: boolean; id?: string;
  onContextMenu?: React.MouseEventHandler<HTMLTextAreaElement>; onCopy?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  library?: Array<{ name: string; content: string }>; cooccurrence?: boolean; relatedSamples?: string[]; onFeedback?: (message: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const listId = useId();
  const [suggestions, setSuggestions] = useState<TagHit[]>([]);
  const [open, setOpen] = useState(false);
  const [related, setRelated] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const showSuggestions = open && suggestions.length > 0 && (related ? cooccurrence : autocomplete);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); requestRef.current?.abort(); }, []);
  useLayoutEffect(() => {
    if (!showSuggestions) return;
    const place = () => {
      const bounds = textareaRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewport = promptOverlayViewport();
      const below = Math.max(0, viewport.bottom - bounds.bottom - 4);
      const above = Math.max(0, bounds.top - viewport.top - 4);
      const upward = below < 180 && above > below;
      const width = Math.min(Math.max(bounds.width, 260), viewport.width);
      const maxHeight = Math.min(240, viewport.height, upward ? above : below);
      setPosition({ position: "fixed", left: Math.max(viewport.left, Math.min(bounds.left, viewport.right - width)), width,
        top: Math.max(viewport.top, Math.min(upward ? bounds.top - maxHeight - 4 : bounds.bottom + 4, viewport.bottom - maxHeight)),
        bottom: "auto", right: "auto", maxHeight, zIndex: 1100, visibility: "visible" });
    };
    place();
    return observePromptOverlay(place);
  }, [showSuggestions]);
  function cancelPending() {
    requestNumber.current++;
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    requestRef.current?.abort();
  }
  function display(hits: TagHit[], relatedMode = false) { setSuggestions(hits); setActive(0); setOpen(hits.length > 0); setRelated(relatedMode); }
  function trackCursor(element: HTMLTextAreaElement) {
    cancelPending();
    if (!autocomplete) { setOpen(false); return; }
    const token = promptTokenAt(element.value, element.selectionStart).token.toLowerCase();
    if (token.startsWith("<")) {
      const query = token.slice(1);
      display(library.filter((entry) => entry.name.trim() && entry.name.toLowerCase().includes(query)).slice(0, 10)
        .map((entry) => ({ name: "<" + entry.name + ">", displayName: entry.name, insertion: "<" + entry.name + ">", categoryName: "我的词库", zh: entry.content, local: true })));
      return;
    }
    if (token.length < 2 || token.length > 80 || /[{}\[\]<>]|::/.test(token)) { setOpen(false); return; }
    const cacheKey = token.replace(/[ \t]+/g, "_");
    const cached = RESULT_CACHE.get(cacheKey);
    if (cached) { display(cached); return; }
    const sequence = requestNumber.current;
    const isCurrent = () => sequence === requestNumber.current && document.activeElement === element && promptTokenAt(element.value, element.selectionStart).token.toLowerCase() === token;
    let localHits: TagHit[] = [];
    void loadPromptCompletionWordlist().then((names) => {
      localHits = matchLocalPromptTags(token, [...names, ...library.flatMap((entry) => entry.content.split(/[,，\n]/))]);
      if (isCurrent()) display(localHits.map((hit) => ({ ...hit, zh: tagZh(hit.name) })));
    });
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController(); requestRef.current = controller;
      try {
        const response = await fetch(`/api/tags?q=${encodeURIComponent(cacheKey)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { tags?: TagHit[] };
        const seen = new Set<string>();
        const hits = [...(Array.isArray(result.tags) ? result.tags : []), ...localHits].filter((hit) => typeof hit.name === "string" && !seen.has(hit.name) && Boolean(seen.add(hit.name))).slice(0, 10);
        if (RESULT_CACHE.size >= 200) RESULT_CACHE.clear();
        RESULT_CACHE.set(cacheKey, hits);
        if (isCurrent()) display(hits);
      } catch { /* The local wordlist remains usable offline. */ }
    }, 260);
  }
  function showRelated(element: HTMLTextAreaElement, quiet = false) {
    cancelPending();
    if (!cooccurrence) return;
    const selected = element.value.slice(element.selectionStart, element.selectionEnd).trim() || promptTokenAt(element.value, element.selectionStart).token;
    const hits = localCooccurringTags(selected, relatedSamples, element.value);
    display(hits.map((hit) => ({ ...hit, zh: tagZh(hit.name) })), true);
    if (!hits.length && !quiet) onFeedback?.("本次历史和词库中没有这个标签的共现记录。保存含该标签的词库条目或生成图片后再试。");
  }
  function acceptTag(hit: TagHit) {
    const element = textareaRef.current;
    if (!element) return;
    cancelPending();
    const insertion = promptCompletionText(hit);
    const next = related ? { text: element.value.trimEnd() + (/[,，\n]\s*$/.test(element.value) ? " " : element.value.trim() ? ", " : "") + insertion, cursor: 0 }
      : insertPromptCompletion(element.value, element.selectionStart, insertion);
    onChange(next.text); setOpen(false);
    const caret = related ? next.text.length : next.cursor;
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(caret, caret); });
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.ctrlKey && event.shiftKey && event.code === "Space") { event.preventDefault(); showRelated(event.currentTarget); return; }
    if (!showSuggestions || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setActive((index) => (index + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); acceptTag(suggestions[active]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelPending(); setOpen(false); }
  }
  return <div className="prompt-autocomplete-wrap">
    <textarea ref={textareaRef} id={id} value={value} onChange={(event) => { onChange(event.target.value); if (!(event.nativeEvent as InputEvent).isComposing) trackCursor(event.target); }}
      onCompositionEnd={(event) => trackCursor(event.currentTarget)} onKeyDown={onKeyDown} onCopy={onCopy}
      aria-autocomplete={autocomplete ? "list" : "none"} aria-controls={showSuggestions ? listId : undefined}
      aria-activedescendant={showSuggestions ? listId + "-" + active : undefined}
      onBlur={() => { cancelPending(); setOpen(false); }} onSelect={(event) => { if (event.currentTarget.selectionEnd > event.currentTarget.selectionStart) showRelated(event.currentTarget, true); }}
      onClick={(event) => { if (event.ctrlKey) showRelated(event.currentTarget); }}
      onMouseDown={(event) => { if (event.button === 2 && event.currentTarget.selectionEnd > event.currentTarget.selectionStart) event.preventDefault(); }}
      onContextMenu={onContextMenu} placeholder={placeholder} className={className} />
    {showSuggestions && createPortal(<div data-replica-menu id={listId} style={position} className="tag-suggest-panel replica-completion-panel" role="listbox" aria-label={related ? "本地共现标签" : "标签联想"}>
      <p className="tag-suggest-head">{related ? "本次历史 / 我的词库共现" : "标签建议 · ↑↓ 选择 · Enter / Tab 插入"}</p>
      <div className="tag-suggest-list">{suggestions.map((hit, index) => <button type="button" id={listId + "-" + index} key={hit.catalogKey || hit.name} role="option" aria-selected={index === active} title={hit.description || hit.zh || hit.name}
        onPointerDown={(event) => { event.preventDefault(); acceptTag(hit); }} onMouseEnter={() => setActive(index)} className={"tag-suggest-item" + (index === active ? " is-active" : "")}>
        <span className="tag-suggest-name">{hit.displayName || hit.name}{hit.zh && <span className="tag-suggest-zh">{hit.zh}</span>}{hit.description && <span className="block line-clamp-2 text-[10px] font-normal leading-4 text-[var(--muted)]">{hit.description}</span>}</span>
        <span className="tag-suggest-meta">{hit.categoryName || "标签"}{hit.source === "danbooru" ? " · Danbooru" : ""}{hit.occurrences != null ? ` · ${hit.occurrences} 条记录` : hit.postCount != null && hit.source !== "quicktagcloud" ? ` · ${hit.postCount.toLocaleString("zh-CN")}` : ""}</span>
      </button>)}</div>
      {suggestions[active]?.catalogKey && <a className="block border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--rose)]"
        href={`/tags?key=${encodeURIComponent(suggestions[active].catalogKey!)}`} target="_blank" rel="noreferrer"
        onMouseDown={(event) => event.preventDefault()}>查看当前标签的完整介绍与原始记录 ↗</a>}
    </div>, document.body)}
  </div>;
}
