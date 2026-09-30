"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Tag 模式胶囊编辑器（移植 Aaalice TagEditorView/tag_editor_commands，MIT）：
// 提示词解析为 tag 胶囊（识别 {}/[] 权重层数、数字 ::权重::、/*disabled:*/
// 禁用块），点选多选（Ctrl 加减选/Shift 范围选），右键菜单：增加/减少权重、
// 禁用/启用、重置权重、复制、删除、加入词库；双击内联编辑；拖拽排序；
// 末尾「添加标签」输入框带联想（Aaalice 的 tag 模式补全语义）。

export type UserLibraryEntry = { name: string; content: string; createdAt: string };

export function loadUserLibrary(): UserLibraryEntry[] {
  try {
    const raw = window.localStorage.getItem("lfn-user-library");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUserLibrary(entries: UserLibraryEntry[]): void {
  window.localStorage.setItem("lfn-user-library", JSON.stringify(entries.slice(0, 500)));
}

type Capsule = {
  /** 源文本里片段起点（不含前导分隔符） */
  start: number;
  end: number;
  raw: string;
  base: string;
  /** {} 深度（负数 = [] 弱化） */
  depth: number;
  /** 数字权重 1.10::tag:: */
  numericWeight: number | null;
  disabled: boolean;
};

type Suggestion = { name: string; displayName?: string; zh?: string };

const NUMERIC_OPEN = /^-?(?:\d+(?:\.\d*)?|\.\d+)::/;
const RESULT_CACHE = new Map<string, Suggestion[]>();

// 括号深度为 0 处按逗号/换行切分；/*disabled:...*/ 整体一段。
function splitSegments(source: string): Array<{ start: number; text: string; disabled: boolean }> {
  const segments: Array<{ start: number; text: string; disabled: boolean }> = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  const push = (end: number) => {
    const text = source.slice(start, end);
    if (text.trim()) segments.push({ start, text, disabled: false });
    start = end + 1;
  };
  while (index < source.length) {
    const char = source[index];
    if (source.startsWith("/*disabled:", index)) {
      const close = source.indexOf("*/", index + 11);
      index = close === -1 ? source.length : close + 2;
      continue;
    }
    if (char === "\\" ) { index += 2; continue; }
    if ("{[(".includes(char)) depth += 1;
    else if ("}])".includes(char)) depth = Math.max(0, depth - 1);
    else if ((char === "," || char === "\n") && depth === 0) {
      push(index);
    }
    index += 1;
  }
  push(source.length);
  return segments.map((segment) => ({
    ...segment,
    disabled: segment.text.trim().startsWith("/*disabled:"),
  }));
}

function parseCapsule(segment: { start: number; text: string; disabled: boolean }): Capsule {
  const raw = segment.text.trim();
  const start = segment.start + (segment.text.length - segment.text.trimStart().length);
  const disabled = segment.disabled;
  let inner = raw;
  if (disabled) {
    const open = inner.indexOf(":") + 1;
    const close = inner.lastIndexOf("*/");
    inner = close > open ? inner.slice(open, close) : inner.slice(open);
    inner = inner.replaceAll("\\*/", "*/").replaceAll("\\\\", "\\");
  }
  let numericWeight: number | null = null;
  let depth = 0;
  let base = inner.trim();
  const numericMatch = base.match(NUMERIC_OPEN);
  if (numericMatch && base.endsWith("::")) {
    numericWeight = Number(numericMatch[0].replace("::", ""));
    base = base.slice(numericMatch[0].length, -2).trim();
  } else {
    let work = base;
    while (work.startsWith("{") && work.endsWith("}")) {
      depth += 1;
      work = work.slice(1, -1).trim();
    }
    while (work.startsWith("[") && work.endsWith("]")) {
      depth -= 1;
      work = work.slice(1, -1).trim();
    }
    base = work;
  }
  return { start, end: start + raw.length, raw: inner.trim() || raw, base, depth, numericWeight, disabled };
}

export function parsePromptCapsules(value: string): Capsule[] {
  return splitSegments(value).map(parseCapsule);
}

// 权重数学（Aaalice withWeight）：数字语法 0.1–3.0 两位小数；
// {} 每层 1.05x，[] 每层 0.95x；权重 = 1 → 裸文本。
function renderWeighted(base: string, depth: number, numericWeight: number | null, disabled: boolean): string {
  let text: string;
  if (numericWeight != null) {
    const value = Math.min(3, Math.max(0.1, numericWeight));
    text = Math.abs(value - 1) < 0.00001
      ? base
      : `${value.toFixed(2)}::${base}::`;
  } else if (depth > 0) {
    text = "{".repeat(depth) + base + "}".repeat(depth);
  } else if (depth < 0) {
    text = "[".repeat(-depth) + base + "]".repeat(-depth);
  } else {
    text = base;
  }
  return disabled ? `/*disabled:${text.replaceAll("\\", "\\\\").replaceAll("*/", "*\\/")}*/` : text;
}

function capsuleWeight(capsule: Capsule): number {
  if (capsule.numericWeight != null) return capsule.numericWeight;
  return capsule.depth > 0 ? Math.pow(1.05, capsule.depth) : Math.pow(0.95, -capsule.depth);
}

function weightLabel(capsule: Capsule): string {
  if (capsule.numericWeight != null) return capsule.numericWeight.toFixed(2);
  if (capsule.depth !== 0) return capsuleWeight(capsule).toFixed(2);
  return "";
}

// 末尾「添加标签」输入框的联想（Aaalice：tag 模式补全只在添加输入框上）。
function AddTagInput({
  onAdd,
  zhOf,
}: {
  onAdd: (tag: string) => void;
  zhOf?: (tag: string) => string | undefined;
}) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounceRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  function query(token: string) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const key = token.trim().toLowerCase();
    if (key.length < 2 || /\s/.test(key)) {
      setOpen(false);
      setSuggestions([]);
      return;
    }
    const cached = RESULT_CACHE.get(key);
    if (cached) {
      setSuggestions(cached);
      setActive(0);
      setOpen(cached.length > 0);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/tags?q=${encodeURIComponent(key)}`, { cache: "no-store" });
        const result = (await response.json()) as { tags?: Suggestion[] };
        const hits = Array.isArray(result.tags) ? result.tags.slice(0, 8) : [];
        RESULT_CACHE.set(key, hits);
        if (RESULT_CACHE.size > 200) RESULT_CACHE.clear();
        setSuggestions(hits);
        setActive(0);
        setOpen(hits.length > 0);
      } catch {
        // 静默
      }
    }, 260);
  }

  function add(name: string) {
    const clean = name.trim().replace(/,+$/, "");
    if (!clean) return;
    onAdd(clean);
    setText("");
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div className="tag-chip-add">
      <input
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          query(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(suggestions[active] && open ? suggestions[active].name : text);
          } else if (event.key === "ArrowDown" && open) {
            event.preventDefault();
            setActive((index) => (index + 1) % Math.max(1, suggestions.length));
          } else if (event.key === "ArrowUp" && open) {
            event.preventDefault();
            setActive((index) => (index - 1 + suggestions.length) % Math.max(1, suggestions.length));
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="添加标签，回车确认…"
        aria-label="添加标签"
        className="tag-chip-add-input"
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
                  add(hit.name);
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
                {zhOf?.(hit.name) && <span className="tag-suggest-meta">{zhOf(hit.name)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TagChipEditor({
  value,
  onChange,
  zhOf,
}: {
  value: string;
  onChange: (next: string) => void;
  zhOf?: (tag: string) => string | undefined;
}) {
  const capsules = useMemo(() => parsePromptCapsules(value), [value]);
  const [selected, setSelected] = useState<number[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [notice, setNotice] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const validSelected = selected.filter((start) =>
    capsules.some((capsule) => capsule.start === start),
  );
  const selectedCapsules = capsules.filter((capsule) => validSelected.includes(capsule.start));

  function applyToSelected(mutate: (capsule: Capsule) => string): void {
    if (!selectedCapsules.length) return;
    const parts: string[] = [];
    let cursor = 0;
    for (const capsule of capsules) {
      if (validSelected.includes(capsule.start)) {
        parts.push(value.slice(cursor, capsule.start));
        parts.push(mutate(capsule));
        cursor = capsule.end;
      }
    }
    parts.push(value.slice(cursor));
    onChange(parts.join(""));
  }

  function adjustWeight(step: number): void {
    applyToSelected((capsule) => {
      if (capsule.numericWeight != null) {
        return renderWeighted(capsule.base, 0, capsule.numericWeight + step, capsule.disabled);
      }
      return renderWeighted(capsule.base, capsule.depth + step, null, capsule.disabled);
    });
  }

  function toggleDisabled(): void {
    applyToSelected((capsule) =>
      renderWeighted(capsule.base, capsule.depth, capsule.numericWeight, !capsule.disabled),
    );
  }

  function resetWeight(): void {
    applyToSelected((capsule) => renderWeighted(capsule.base, 0, null, capsule.disabled));
  }

  function removeSelected(): void {
    if (!selectedCapsules.length) return;
    const parts: string[] = [];
    let cursor = 0;
    for (const capsule of capsules) {
      if (validSelected.includes(capsule.start)) {
        parts.push(value.slice(cursor, capsule.start));
        cursor = capsule.end;
        if (value[cursor] === ",") cursor += 1;
      }
    }
    parts.push(value.slice(cursor));
    onChange(parts.join(""));
    setSelected([]);
  }

  function copySelected(): void {
    const text = selectedCapsules.map((capsule) => capsule.raw).join(", ");
    void navigator.clipboard?.writeText(text).then(() => setNotice(`已复制 ${selectedCapsules.length} 个标签`));
  }

  function addToLibrary(): void {
    const entries = loadUserLibrary();
    for (const capsule of selectedCapsules) {
      if (entries.some((entry) => entry.content === capsule.base)) continue;
      entries.push({ name: capsule.base, content: capsule.base, createdAt: new Date().toISOString() });
    }
    saveUserLibrary(entries);
    setNotice(`已加入词库（${entries.length} 条）`);
  }

  function addTag(tag: string): void {
    const trimmed = value.trimEnd();
    const next = trimmed ? `${trimmed.replace(/,+$/, "")}, ${tag}` : tag;
    onChange(next);
  }

  // 双击内联编辑：替换胶囊 base，保留权重壳与禁用态。
  function commitEdit(capsule: Capsule): void {
    const clean = editText.trim().replace(/,+$/, "");
    setEditing(null);
    if (!clean || clean === capsule.base) return;
    const replacement = renderWeighted(clean, capsule.depth, capsule.numericWeight, capsule.disabled);
    onChange(value.slice(0, capsule.start) + replacement + value.slice(capsule.end));
  }

  // 拖拽排序：重建为胶囊按新顺序 join（规范化空白）。
  function reorder(from: number, to: number): void {
    if (from === to) return;
    const reordered = [...capsules];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    onChange(reordered.map((capsule) => capsule.raw).join(", "));
    setDragIndex(null);
  }

  function selectCapsule(capsule: Capsule, event: React.MouseEvent, index: number): void {
    if (event.shiftKey && selected.length) {
      const anchor = selected[0];
      const from = Math.min(anchor, capsule.start);
      const to = Math.max(anchor, capsule.start);
      const range: number[] = [];
      for (const item of capsules)
        if (item.start >= from && item.start <= to) range.push(item.start);
      setSelected(range);
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((current) =>
        current.includes(capsule.start)
          ? current.filter((item) => item !== capsule.start)
          : [...current, capsule.start],
      );
    } else {
      setSelected([capsule.start]);
      setDragIndex(index);
    }
  }

  const menuItems: Array<{ label: string; action: () => void; disabled?: boolean; danger?: boolean }> = [
    { label: "增加权重 (+0.05/+1层)", action: () => adjustWeight(1), disabled: !selectedCapsules.length },
    { label: "减少权重 (-0.05/-1层)", action: () => adjustWeight(-1), disabled: !selectedCapsules.length },
    { label: "重置权重", action: resetWeight, disabled: !selectedCapsules.length },
    {
      label: selectedCapsules.some((capsule) => capsule.disabled) ? "启用标签" : "禁用标签",
      action: toggleDisabled,
      disabled: !selectedCapsules.length,
    },
    { label: "复制", action: copySelected, disabled: !selectedCapsules.length },
    { label: "加入词库", action: addToLibrary, disabled: !selectedCapsules.length },
    { label: "删除", action: removeSelected, disabled: !selectedCapsules.length, danger: true },
  ];

  return (
    <div className="tag-chip-editor" onContextMenu={(event) => event.preventDefault()}>
      {capsules.length ? (
        <div className="tag-chip-list">
          {capsules.map((capsule, index) =>
            editing === capsule.start ? (
              <input
                key={capsule.start}
                value={editText}
                autoFocus
                onChange={(event) => setEditText(event.target.value)}
                onBlur={() => commitEdit(capsule)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitEdit(capsule);
                  if (event.key === "Escape") setEditing(null);
                }}
                className="tag-chip-edit-input"
                aria-label="编辑标签"
              />
            ) : (
              <button
                type="button"
                key={capsule.start}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dragIndex != null && dragIndex !== index) reorder(dragIndex, index);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={`tag-chip${validSelected.includes(capsule.start) ? " is-selected" : ""}${capsule.disabled ? " is-disabled" : ""}${dragIndex === index ? " is-dragging" : ""}`}
                onClick={(event) => selectCapsule(capsule, event, index)}
                onDoubleClick={() => {
                  setEditing(capsule.start);
                  setEditText(capsule.base);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!validSelected.includes(capsule.start)) setSelected([capsule.start]);
                  setMenu({ x: event.clientX, y: event.clientY });
                }}
              >
                <span className="tag-chip-text">{capsule.base}</span>
                {zhOf?.(capsule.base) && <span className="tag-chip-zh">{zhOf(capsule.base)}</span>}
                {weightLabel(capsule) && <span className="tag-chip-weight">{weightLabel(capsule)}</span>}
                {capsule.disabled && <span className="tag-chip-disabled-mark">已禁用</span>}
              </button>
            ),
          )}
          <AddTagInput onAdd={addTag} zhOf={zhOf} />
        </div>
      ) : (
        <div className="tag-chip-list">
          <AddTagInput onAdd={addTag} zhOf={zhOf} />
        </div>
      )}
      <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">
        单击选中，Ctrl 加减选，Shift 范围选，双击改词，拖拽排序，右键调权重/禁用/词库菜单。
      </p>
      {notice && <p className="mt-1 text-[10px] text-[var(--rose)]">{notice}</p>}
      {menu && (
        <div
          ref={menuRef}
          className="tag-chip-menu"
          style={{ position: "fixed", left: menu.x, top: menu.y }}
          role="menu"
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.action();
                setMenu(null);
              }}
              className={`tag-chip-menu-item${item.danger ? " is-danger" : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
