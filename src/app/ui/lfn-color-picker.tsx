"use client";
import { useState } from "react";
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
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rgb = [1, 3, 5].map((start) =>
    parseInt(value.slice(start, start + 2), 16),
  );
  return (
    <div className="relative">
      <button
        type="button"
        className="lfn-button"
        aria-expanded={open}
        aria-label="选择自定义强调色"
        onClick={() => setOpen(!open)}
      >
        取色
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-64 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-xl"
          aria-label="LFN 取色器"
        >
          <div className="flex justify-between">
            <span className="text-xs font-semibold">自定义颜色</span>
            <button
              type="button"
              className="text-xs text-[var(--muted)]"
              onClick={() => setOpen(false)}
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
        </div>
      )}
    </div>
  );
}
