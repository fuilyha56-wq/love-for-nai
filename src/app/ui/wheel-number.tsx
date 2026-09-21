"use client";

import { useEffect, useRef } from "react";

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
  useWheelStep(inputRef, (direction) =>
    setValue(quantizeStepValue(value, direction, min, max, step)),
  );
  return (
    <input
      ref={inputRef}
      className={className}
      aria-label={ariaLabel}
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => setValue(Number(event.target.value))}
    />
  );
}
