"use client";

import { useState } from "react";
import { RectangleHorizontal, RectangleVertical, Square } from "lucide-react";
import { PopupSelect } from "@/app/ui/popup-select";

const sizes = {
  small: [512, 768],
  normal: [832, 1216],
  large: [1024, 1536],
} as const;
type SizePreset = keyof typeof sizes;

export function NaiImageSettings({
  width,
  height,
  count,
  setWidth,
  setHeight,
  setCount,
}: {
  width: number;
  height: number;
  count: number;
  setWidth: (value: number) => void;
  setHeight: (value: number) => void;
  setCount: (value: number) => void;
}) {
  const [preset, setPreset] = useState<SizePreset>("normal");
  const orientation =
    width === height ? "square" : width > height ? "landscape" : "portrait";
  function applySize(next: SizePreset, shape = orientation) {
    const [short, long] = sizes[next];
    const square = next === "small" ? 640 : next === "large" ? 1280 : 1024;
    setWidth(shape === "square" ? square : shape === "landscape" ? long : short);
    setHeight(shape === "square" ? square : shape === "landscape" ? short : long);
    setPreset(next);
  }
  return (
    <section className="nai-image-settings">
      <h3>图像设置</h3>
      <div className="nai-resolution">
        <div className="nai-resolution-heading">
          <b>分辨率</b>
          <div className="nai-dimbox">
            <input
              type="number"
              aria-label="图片宽度"
              min={64}
              max={1600}
              step={64}
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
            />
            <button
              type="button"
              aria-label="交换宽高"
              title="交换宽高"
              onClick={() => {
                setWidth(height);
                setHeight(width);
              }}
            >
              ×
            </button>
            <input
              type="number"
              aria-label="图片高度"
              min={64}
              max={1600}
              step={64}
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="nai-resolution-options">
          <PopupSelect
            ariaLabel="分辨率预设"
            value={preset}
            onChange={(value) => applySize(value as SizePreset)}
            options={[
              { value: "small", label: "小尺寸" },
              { value: "normal", label: "标准" },
              { value: "large", label: "大尺寸" },
            ]}
          />
          <div className="nai-segmented nai-segmented-icons" role="group" aria-label="画面方向">
            {(
              [
                ["landscape", "横图", RectangleHorizontal],
                ["portrait", "竖图", RectangleVertical],
                ["square", "方图", Square],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                type="button"
                key={value}
                aria-label={label}
                title={label}
                aria-pressed={orientation === value}
                onClick={() => applySize(preset, value)}
              >
                <Icon size={20} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <b>图像数量</b>
      <div className="nai-segmented" role="group" aria-label="生成张数">
        {[1, 2, 3, 4, 5, 6].map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`生成 ${value} 张图片`}
            aria-pressed={count === value}
            onClick={() => setCount(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </section>
  );
}
