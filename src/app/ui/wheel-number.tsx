"use client";

import { useEffect, useRef, useState } from "react";

export function commitNumberDraft(draft: string, current: number, min: number, max: number, step: number): number {
  const parsed = draft.trim() ? Number(draft) : current;
  const finite = Number.isFinite(parsed) ? parsed : Number.isFinite(current) ? current : min;
  return Math.min(max, Math.max(min, step >= 1 ? Math.round(finite) : finite));
}

// 悬停在数字输入框上滚动滚轮即可按 step 增减。
// React 的合成 onWheel 走 passive 监听，preventDefault 不生效，
// 因此这里用原生 addEventListener({ passive: false }) 接管。
export function useWheelStep(
  ref: React.RefObject<HTMLInputElement | null>,
  onStep: (direction: 1 | -1) => void,
) {
  const latest = useRef(onStep);
  useEffect(() => {
    latest.current = onStep;
  }, [onStep]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const listener = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current(event.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener("wheel", listener, { passive: false });
    return () => node.removeEventListener("wheel", listener);
  }, [ref]);
}

// 按 step 增减并吸附到 step 网格：0.1 这类小数步进不会累积浮点噪声。
export function quantizeStepValue(
  current: number,
  direction: 1 | -1,
  min: number,
  max: number,
  step: number,
): number {
  const base = Number.isFinite(current) ? current : min;
  const next = base + direction * step;
  const snapped = Math.round(next / step) * step;
  const clamped = Math.min(max, Math.max(min, snapped));
  return Number(clamped.toFixed(6));
}

export function WheelNumberInput({
  className,
  ariaLabel,
  value,
  setValue,
  min,
  max,
  step,
}: {
  className?: string;
  ariaLabel?: string;
  value: number;
  setValue: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Editing text, including an empty field, must never reach pricing as 0/NaN.
  const [draft, setDraft] = useState<string | null>(null);
  useWheelStep(inputRef, (direction) => {
    const current = draft === null ? value : commitNumberDraft(draft, value, min, max, step);
    const next = quantizeStepValue(current, direction, min, max, step);
    setValue(next);
    if (draft !== null) setDraft(String(next));
  });
  return (
    <input
      ref={inputRef}
      className={className}
      aria-label={ariaLabel}
      type="number"
      value={draft ?? value}
      min={min}
      max={max}
      step={step}
      onFocus={() => setDraft(String(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null) setValue(commitNumberDraft(draft, value, min, max, step));
        setDraft(null);
      }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}
