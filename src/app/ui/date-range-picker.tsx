"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type DateRangeValue = { start: string; end: string };

type DateRangePickerProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  min?: string;
  max?: string;
  quickRanges?: Array<{ label: string; getValue: () => DateRangeValue }>;
  ariaLabel?: string;
};

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function monthLabel(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}
function sameDay(a: Date | null, b: Date | null): boolean {
  return Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
}

export function DateRangePicker({ value, onChange, min, max, quickRanges = [], ariaLabel = "日期范围" }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [month, setMonth] = useState(() => parseDate(value.start) || new Date());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden" });
  const start = parseDate(value.start);
  const end = parseDate(value.end);
  const minDate = parseDate(min || "");
  const maxDate = parseDate(max || "");
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: offset + days }, (_, index) => index < offset ? null : new Date(month.getFullYear(), month.getMonth(), index - offset + 1));

  function position() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, Math.max(300, window.innerWidth - 24));
    const below = window.innerHeight - rect.bottom - 10;
    const above = rect.top - 10;
    const aboveOpen = below < 390 && above > below;
    setStyle({ position: "fixed", visibility: "visible", width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: aboveOpen ? undefined : rect.bottom + 8, bottom: aboveOpen ? window.innerHeight - rect.top + 8 : undefined });
  }
  useLayoutEffect(() => { if (open) position(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { const target = event.target as Node; if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape); window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);
  function choose(date: Date) {
    const iso = toIso(date);
    if (minDate && date < minDate || maxDate && date > maxDate) return;
    if (!selectingEnd || !start) { onChange({ start: iso, end: iso }); setSelectingEnd(true); return; }
    if (date < start) { onChange({ start: iso, end: value.end }); return; }
    onChange({ start: value.start, end: iso }); setSelectingEnd(false); setOpen(false);
  }
  const display = value.start && value.end ? `${value.start} ~ ${value.end}` : value.start || "选择日期范围";
  const mobileDisplay = value.start && value.end ? `${value.start.slice(5)}–${value.end.slice(5)}` : "选择日期";
  return <div className="date-range-picker">
    <button ref={triggerRef} type="button" className="date-range-trigger" aria-label={ariaLabel} aria-controls={id} aria-expanded={open} onClick={() => { setOpen((current) => !current); setSelectingEnd(false); }}>
      <CalendarDays size={15} aria-hidden="true" /><span className="date-range-label-wide">{display}</span><span className="date-range-label-narrow">{mobileDisplay}</span>
    </button>
    {open && createPortal(<div ref={popoverRef} id={id} role="dialog" aria-label={ariaLabel} className="date-range-popover" style={style}>
      <div className="date-range-popover-head"><div><b>{monthLabel(month)}</b><p>{selectingEnd ? "请选择结束日期" : "请选择开始日期"}</p></div><button type="button" className="date-range-close" aria-label="关闭日期选择" onClick={() => setOpen(false)}><X size={14} /></button></div>
      <div className="date-range-month-nav"><button type="button" aria-label="上个月" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={15} /></button><span>{monthLabel(month)}</span><button type="button" aria-label="下个月" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={15} /></button></div>
      <div className="date-range-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="date-range-grid">{cells.map((date, index) => date ? (() => { const iso = toIso(date); const inRange = Boolean(start && end && date >= start && date <= end); const disabled = Boolean(minDate && date < minDate || maxDate && date > maxDate); return <button key={iso} type="button" disabled={disabled} className={`date-range-day ${sameDay(date, start) ? "is-start" : ""} ${sameDay(date, end) ? "is-end" : ""} ${inRange ? "is-range" : ""}`} onClick={() => choose(date)}>{sameDay(date, start) || sameDay(date, end) ? <Check size={11} aria-hidden="true" /> : null}{date.getDate()}</button>; })() : <span key={`empty-${index}`} />)}</div>
      <div className="date-range-quick">{quickRanges.map((range) => <button type="button" key={range.label} onClick={() => { onChange(range.getValue()); setOpen(false); }}>{range.label}</button>)}</div>
    </div>, document.body)}
  </div>;
}
