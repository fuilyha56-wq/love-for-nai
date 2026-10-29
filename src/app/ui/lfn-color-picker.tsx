"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { lfnPrompt } from "./lfn-dialog";

const swatches = [
  "#a83a4c",
  "#d65773",
  "#b97129",
  "#4e8566",
  "#4076a7",
  "#7564a5",
  "#30343b",
];
export function LfnColorPicker({
  value,
  onChange,
  ariaLabel = "选择自定义强调色",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const position = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = Math.min(256, (viewport?.width || window.innerWidth) - 16);
    const bottom = top + (viewport?.height || window.innerHeight);
    const below = Math.max(0, bottom - trigger.bottom - 14);
    const above = Math.max(0, trigger.top - top - 14);
    const openAbove = below < 300 && above > below;
    setStyle({ position: "fixed", visibility: "visible", zIndex: 40000, width,
      left: Math.max(left + 8, Math.min(trigger.right - width, left + (viewport?.width || window.innerWidth) - width - 8)),
      top: openAbove ? undefined : trigger.bottom + 6,
      bottom: openAbove ? window.innerHeight - trigger.top + 6 : undefined,
      maxHeight: openAbove ? above : below, overflowY: "auto" });
  }, []);
  useLayoutEffect(() => { if (open) { position(); menuRef.current?.focus({ preventScroll: true }); } }, [open, position]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, position]);
  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }
  const rgb = [1, 3, 5].map((start) =>
    parseInt(value.slice(start, start + 2), 16),
  );
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="lfn-button"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={id}
        onClick={() => { setPortalTarget(triggerRef.current?.closest("dialog[open]") || document.body); setOpen(!open); }}
      >
        <span aria-hidden="true" className="h-4 w-4 rounded-full border border-[var(--line)]" style={{ backgroundColor: value }} />取色
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={id}
          role="dialog"
          tabIndex={-1}
          style={style}
          className="lfn-color-menu space-y-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--ink)] shadow-xl"
          aria-label="LFN 取色器"
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
        >
          <div className="flex justify-between">
            <span className="text-xs font-semibold">自定义颜色</span>
            <button
              type="button"
              className="text-xs text-[var(--muted)]"
              onClick={close}
            >
              关闭
            </button>
          </div>
          <div className="h-10 rounded-lg" style={{ backgroundColor: value }} />
          <div className="flex justify-between">
            {swatches.map((color) => (
              <button
                type="button"
                key={color}
                aria-label={`选择 ${color}`}
                className="h-6 w-6 rounded-full border border-[var(--line)]"
                style={{ backgroundColor: color }}
                onClick={() => onChange(color)}
              />
            ))}
          </div>
          {["红", "绿", "蓝"].map((label, index) => (
            <label key={label} className="flex items-center gap-2 text-xs">
              <span>{label}</span>
              <input
                className="min-w-0 flex-1"
                type="range"
                min={0}
                max={255}
                value={rgb[index]}
                onChange={(event) => {
                  const next = [...rgb];
                  next[index] = Number(event.target.value);
                  onChange(
                    `#${next.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
                  );
                }}
              />
              <span className="w-6 text-right">{rgb[index]}</span>
            </label>
          ))}
          <button
            type="button"
            className="lfn-button w-full font-mono"
            onClick={async () => {
              const next = await lfnPrompt("输入 #RRGGBB 格式的颜色", value);
              if (next && /^#[\da-f]{6}$/i.test(next.trim()))
                onChange(next.trim());
            }}
          >
            {value}
          </button>
        </div>, portalTarget || document.body
      )}
    </div>
  );
}
