"use client";

import { useEffect, useRef, useState } from "react";

// 提示词标签联想（借鉴 novelai_local_web / Aaalice 的补全交互）：
// 输入时按光标所在 token 实时查询 /api/tags（Danbooru + 中文捷径），
// 浮层按 LFN 主题渲染；Enter/Tab 接受、Esc 关闭、点击插入并补逗号。

export type TagHit = {
  name: string;
  displayName?: string;
  categoryName?: string;
  postCount?: number;
  zh?: string;
};

const RESULT_CACHE = new Map<string, TagHit[]>();
const CACHE_MAX_KEYS = 200;
const MAX_SUGGESTIONS = 10;
const DEBOUNCE_MS = 260;

function tokenSpanBefore(text: string, cursor: number): { start: number; token: string } {
  const slice = text.slice(0, cursor);
  const start = Math.max(slice.lastIndexOf(","), slice.lastIndexOf("\n")) + 1;
  return { start, token: slice.slice(start) };
}

export function PromptAutocompleteTextarea({
  value,
  onChange,
  className,
  placeholder,
  autocomplete = false,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  autocomplete?: boolean;
  id?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<number | null>(null);
  const [suggestions, setSuggestions] = useState<TagHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  function trackCursor(el: HTMLTextAreaElement) {
    if (!autocomplete) return;
    const span = tokenSpanBefore(el.value, el.selectionStart ?? el.value.length);
    const token = span.token.trim().toLowerCase();
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // 空格结尾或过短不联想（Danbooru tag 无空格，多词组合由用户手写）。
    if (token.length < 2 || /\s$/.test(span.token) || /\s/.test(token)) {
      setOpen(false);
      setSuggestions([]);
      return;
    }
    const cached = RESULT_CACHE.get(token);
    if (cached) {
      setSuggestions(cached);
      setActive(0);
      setOpen(cached.length > 0);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/tags?q=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const result = (await response.json()) as { tags?: TagHit[] };
        const hits = Array.isArray(result.tags) ? result.tags.slice(0, MAX_SUGGESTIONS) : [];
        if (RESULT_CACHE.size >= CACHE_MAX_KEYS) RESULT_CACHE.clear();
        RESULT_CACHE.set(token, hits);
        // 响应回来时 token 可能已变，只在仍匹配时展示。
        const now = tokenSpanBefore(
          el.value,
          el.selectionStart ?? el.value.length,
        ).token
          .trim()
          .toLowerCase();
        if (now !== token) return;
        setSuggestions(hits);
        setActive(0);
        setOpen(hits.length > 0);
      } catch {
        // 网络失败静默，不打断输入。
      }
    }, DEBOUNCE_MS);
  }

  function acceptTag(hit: TagHit) {
    const el = textareaRef.current;
    if (!el) return;
    const span = tokenSpanBefore(el.value, el.selectionStart ?? el.value.length);
    const after = el.value.slice(span.start + span.token.length);
    // 替换当前 token；后文存在且不以逗号/换行开头时补 ", "。
    const afterStart = after.trimStart();
    const joiner = !afterStart
      ? ""
      : /^[,\n]/.test(afterStart)
        ? ""
        : ", ";
    const next =
      el.value.slice(0, span.start) + hit.name + (joiner ? joiner + afterStart : after);
    onChange(next);
    setOpen(false);
    setSuggestions([]);
    const caret = span.start + hit.name.length + (joiner ? joiner.length : 0);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || !suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptTag(suggestions[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="prompt-autocomplete-wrap">
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          trackCursor(event.target);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => trackCursor(event.currentTarget)}
        onClick={(event) => trackCursor(event.currentTarget)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <div className="tag-suggest-panel" role="listbox" aria-label="标签联想">
          <p className="tag-suggest-head">猜你想用</p>
          <div className="tag-suggest-list">
            {suggestions.map((hit, index) => (
              <button
                type="button"
                key={hit.name}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  acceptTag(hit);
                }}
                onMouseEnter={() => setActive(index)}
                className={`tag-suggest-item${index === active ? " is-active" : ""}`}
              >
                <span className="tag-suggest-name">
                  {hit.displayName || hit.name}
                  {hit.zh && hit.zh !== (hit.displayName || hit.name) && (
                    <span className="tag-suggest-zh">{hit.zh}</span>
                  )}
                </span>
                <span className="tag-suggest-meta">
                  {hit.categoryName || ""}
                  {hit.postCount != null
                    ? ` · ${hit.postCount.toLocaleString("zh-CN")}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
