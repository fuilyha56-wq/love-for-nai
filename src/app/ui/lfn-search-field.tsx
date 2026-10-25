"use client";

import { Search, Tags, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./discovery-controls.module.css";

/** LfN search input and tag suggestions, with no browser datalist or clear button. */
export function LfnSearchField({ label, value, onChange, placeholder, suggestions, multiple = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  suggestions?: string[];
  multiple?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const parts = multiple ? value.split(/[,，\n]/) : [value];
  const term = (parts.at(-1) || "").trim().toLocaleLowerCase();
  const selected = parts.slice(0, -1).map((tag) => tag.trim().toLocaleLowerCase());
  const matches = [...new Set(suggestions || [])].filter((tag) =>
    !selected.includes(tag.toLocaleLowerCase()) && tag.toLocaleLowerCase().includes(term),
  ).slice(0, 12);
  const expanded = open && matches.length > 0;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (expanded && active >= 0) root.current?.querySelector(`#${CSS.escape(`${id}-option-${active}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [active, expanded, id]);

  function choose(tag: string) {
    const previous = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean);
    onChange(multiple ? [...previous, tag].join(", ") + ", " : tag);
    setOpen(false);
    setActive(-1);
    input.current?.focus({ preventScroll: true });
  }

  return <div className={styles.field}>
    <label htmlFor={id} className={styles.label}>{label}</label>
    <div className={styles.searchRoot} ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <div className={styles.search}>
        {multiple ? <Tags size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
        <input
          ref={input}
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role={suggestions ? "combobox" : undefined}
          aria-autocomplete={suggestions ? "list" : undefined}
          aria-expanded={suggestions ? expanded : undefined}
          aria-controls={expanded ? `${id}-suggestions` : undefined}
          aria-activedescendant={expanded && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (suggestions && matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setOpen(true);
              setActive((current) => event.key === "ArrowDown" ? (current + 1) % matches.length : (current <= 0 ? matches.length - 1 : current - 1));
            } else if (event.key === "Enter" && expanded && active >= 0 && matches[active]) {
              event.preventDefault();
              choose(matches[active]);
            } else if (event.key === "Escape" && expanded) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            } else if (event.key === "Tab") setOpen(false);
          }}
        />
        {value && <button type="button" className={styles.clear} aria-label={`清空${label}`} onClick={() => { onChange(""); setActive(-1); setOpen(false); input.current?.focus(); }}><X size={16} aria-hidden="true" /></button>}
      </div>
      {expanded && <div className={styles.suggestions}>
        <p className={styles.suggestionHeading}>选择标签 · 可输入多个，以逗号分隔</p>
        <div role="listbox" id={`${id}-suggestions`} aria-label="标签建议">
          {matches.map((tag, index) => <button
            id={`${id}-option-${index}`}
            key={tag}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className={styles.suggestion}
            onPointerDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(tag)}
          ><Tags size={14} aria-hidden="true" /><span>{tag}</span></button>)}
        </div>
      </div>}
    </div>
  </div>;
}
