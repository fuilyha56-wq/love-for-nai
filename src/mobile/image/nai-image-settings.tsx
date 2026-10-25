"use client";

import { naiDimensionLimit, naiMaxPixels } from "@/lib/nai-image-limits";
import { normalizeImageModelSize } from "@/lib/image-model-capabilities";
import { useState } from "react";
import { RectangleHorizontal, RectangleVertical, Square } from "lucide-react";
import { PopupSelect } from "@/mobile/ui/popup-select";
import { WheelNumberInput } from "@/mobile/ui/wheel-number";

const sizes = {
  small: [512, 768],
  normal: [832, 1216],
  large: [1024, 1536],
  maximum: [1536, 2048],
} as const;
type SizePreset = keyof typeof sizes;

export const MAX_NAI_IMAGE_COUNT = 30;

export function NaiImageSettings({
  model = "nai-v5-full",
  width,
  height,
  count,
  setWidth,
  setHeight,
  setCount,
}: {
  model?: string;
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
    const square = next === "small" ? 640 : next === "maximum" ? 1728 : next === "large" ? 1280 : 1024;
    const size = normalizeImageModelSize(model, shape === "square" ? square : shape === "landscape" ? long : short, shape === "square" ? square : shape === "landscape" ? short : long);
    setWidth(size.width); setHeight(size.height);
    setPreset(next);
  }
  return (
    <section className="nai-image-settings">
      <h3>图像设置</h3>
      <small>面积上限 {naiMaxPixels(model).toLocaleString("zh-CN")} 像素</small>
      <div className="nai-resolution">
        <div className="nai-resolution-heading">
          <b>分辨率</b>
          <div className="nai-dimbox">
            <WheelNumberInput
              ariaLabel="图片宽度"
              min={64}
              max={naiDimensionLimit(height, model)}
              step={64}
              value={width}
              setValue={setWidth}
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
            <WheelNumberInput
              ariaLabel="图片高度"
              min={64}
              max={naiDimensionLimit(width, model)}
              step={64}
              value={height}
              setValue={setHeight}
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
              ...(naiMaxPixels(model) > 1_048_576 ? [{ value: "large", label: "大尺寸" }] : []),
              ...(naiMaxPixels(model) > 1_048_576 ? [{ value: "maximum", label: "最大画布" }] : []),
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
      <div className="nai-count-heading">
        <b>图像数量</b>
        <WheelNumberInput
          className="nai-count-input"
          ariaLabel="生成张数"
          min={1}
          max={MAX_NAI_IMAGE_COUNT}
          step={1}
          value={count}
          setValue={setCount}
        />
      </div>
      <div className="nai-segmented" role="group" aria-label="生成张数快捷选择">
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
