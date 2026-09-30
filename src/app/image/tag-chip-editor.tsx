"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Tag 模式胶囊编辑器（移植 Aaalice TagEditorView/tag_editor_commands，MIT）：
// 提示词解析为 tag 胶囊（识别 {}/[] 权重层数、数字 ::权重::、/*disabled:*/
// 禁用块），点选多选（Ctrl 加减选/Shift 范围选），右键菜单：增加/减少权重、
// 禁用/启用、重置权重、复制、删除、加入词库。修改写回提示词文本。

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

const NUMERIC_OPEN = /^-?(?:\d+(?:\.\d*)?|\.\d+)::/;

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
  // disabled 段标记
  return segments.map((segment) => ({
    ...segment,
    disabled: segment.text.trim().startsWith("/*disabled:"),
  }));
}

function parseCapsule(segment: { start: number; text: string; disabled: boolean }): Capsule {
  let raw = segment.text.trim();
  const start = segment.start + (segment.text.length - segment.text.trimStart().length);
  let disabled = segment.disabled;
  let inner = raw;
  if (disabled) {
    // /*disabled:xxx*/ → 还原内部文本
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
  const [notice, setNotice] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  // selected 存源文本区间 start；文本变化后失效的选区剔除。
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
      // {} 每层 1.05：加/减一层；-1 深度以下走 [] 弱化。
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
        // 连带吃掉片段后的一个分隔符，避免残留 ", ,"
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

  function selectCapsule(capsule: Capsule, event: React.MouseEvent): void {
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
          {capsules.map((capsule) => (
            <button
              type="button"
              key={capsule.start}
              className={`tag-chip${validSelected.includes(capsule.start) ? " is-selected" : ""}${capsule.disabled ? " is-disabled" : ""}`}
              onClick={(event) => selectCapsule(capsule, event)}
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
          ))}
        </div>
      ) : (
        <span className="text-[11px] text-[var(--muted)]">
          提示词为空。切回「文本」模式输入，或用随机骰子生成。
        </span>
      )}
      <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">
        单击选中，Ctrl 加减选，Shift 范围选，右键调出权重/禁用/词库菜单。
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
