"use client";

import { resolveImageModelCapabilities, nearestImageAspectRatio, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { PopupSelect } from "@/app/ui/popup-select";

export type NaturalImageSettingsProps = {
  model: string; imageProtocol?: ImageProviderProtocol;
  width: number; height: number; setWidth: (value: number) => void; setHeight: (value: number) => void;
  setDimensions?: (size: { width: number; height: number }) => void;
  quality: string; setQuality: (value: string) => void;
  imageSize: string; setImageSize: (value: string) => void;
  background: string; setBackground: (value: string) => void;
};

const QUALITY_LABELS: Record<string, string> = { auto: "自动", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };

export function NaturalImageSettings(props: NaturalImageSettingsProps) {
  // 未选具体模型时（如刚切换接口），按接口协议的代表性模型展示该接口的能力；
  // 选中模型后能力严格跟随模型。
  const effectiveModel = props.model
    || (props.imageProtocol === "gemini" ? "nano-banana" : props.imageProtocol === "openai-images" ? "gpt-image-1.5" : "");
  const caps = resolveImageModelCapabilities(effectiveModel, props.imageProtocol);
  const labelClass = "block text-xs font-semibold";
  const dimensions = (width: number, height: number) => { if (props.setDimensions) props.setDimensions({ width, height }); else { props.setWidth(width); props.setHeight(height); } };
  return <div className="natural-image-settings space-y-3" aria-label="图像模型输出设置">
    <p className="text-xs leading-5 text-[var(--muted)]">用完整句子描述主体、构图、文字和修改要求。排除内容会作为描述约束提交。</p>
    {caps.sizeConstraints && <div className="grid grid-cols-2 gap-2">
      <label className={labelClass}>输出宽度<input aria-label="模型输出宽度" type="number" className="field mt-1.5 h-10 w-full px-3 text-sm" min={256} max={caps.sizeConstraints.maxEdge} step={caps.sizeConstraints.multipleOf} value={props.width} onChange={event => props.setWidth(Number(event.target.value))} /></label>
      <label className={labelClass}>输出高度<input aria-label="模型输出高度" type="number" className="field mt-1.5 h-10 w-full px-3 text-sm" min={256} max={caps.sizeConstraints.maxEdge} step={caps.sizeConstraints.multipleOf} value={props.height} onChange={event => props.setHeight(Number(event.target.value))} /></label>
      <p className="col-span-2 text-xs text-[var(--muted)]">提交时按模型的像素数、最大边长和比例限制自动对齐尺寸。</p>
    </div>}
    {caps.family === "gpt-image" && <>
      <label className={labelClass}>图像质量<PopupSelect
        ariaLabel="图像质量"
        value={props.quality}
        options={caps.qualityOptions.map((value) => ({ value, label: QUALITY_LABELS[value] || value }))}
        onChange={props.setQuality}
      /></label>
      <label className={labelClass}>输出背景<PopupSelect
        ariaLabel="输出背景"
        value={props.background}
        options={[{ value: "auto", label: "自动" }, { value: "opaque", label: "不透明" }, { value: "transparent", label: "透明 PNG" }]}
        onChange={props.setBackground}
      /></label>
    </>}
    {(caps.family === "gemini" || caps.family === "nano-banana") && <>
      <label className={labelClass}>画面比例<PopupSelect
        ariaLabel="模型画面比例"
        value={nearestImageAspectRatio(props.width, props.height, caps.aspectRatios)}
        options={caps.aspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
        onChange={(value) => {
          const [w, h] = value.split(":").map(Number); const scale = 1024 / Math.max(w, h); dimensions(Math.round(w * scale / 64) * 64, Math.round(h * scale / 64) * 64);
        }}
      /></label>
      {caps.imageSizes.length > 1 && <label className={labelClass}>分辨率<PopupSelect
        ariaLabel="Gemini 图像分辨率"
        value={props.imageSize}
        options={caps.imageSizes.map((size) => ({ value: size, label: size }))}
        onChange={props.setImageSize}
      /></label>}
    </>}
    {caps.edit && <p className="text-xs leading-5 text-[var(--muted)]">重绘、参考图和图像工具使用当前模型的编辑接口。蒙版以外区域由 LFN 合成保留。</p>}
  </div>;
}
