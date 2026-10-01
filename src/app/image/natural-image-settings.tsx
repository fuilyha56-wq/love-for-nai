"use client";

import { resolveImageModelCapabilities, nearestImageSize, nearestImageAspectRatio, type ImageProviderProtocol } from "@/lib/image-model-capabilities";

export type NaturalImageSettingsProps = {
  model: string; imageProtocol?: ImageProviderProtocol;
  width: number; height: number; setWidth: (value: number) => void; setHeight: (value: number) => void;
  setDimensions?: (size: { width: number; height: number }) => void;
  quality: string; setQuality: (value: string) => void;
  imageSize: string; setImageSize: (value: string) => void;
  background: string; setBackground: (value: string) => void;
};

export function NaturalImageSettings(props: NaturalImageSettingsProps) {
  const caps = resolveImageModelCapabilities(props.model, props.imageProtocol);
  const labelClass = "block text-xs font-semibold";
  const selectClass = "field mt-1.5 h-10 w-full px-3 text-sm";
  const dimensions = (width: number, height: number) => { if (props.setDimensions) props.setDimensions({ width, height }); else { props.setWidth(width); props.setHeight(height); } };
  return <div className="natural-image-settings space-y-3" aria-label="图像模型输出设置">
    <p className="text-xs leading-5 text-[var(--muted)]">用完整句子描述主体、构图、文字和修改要求。排除内容会作为描述约束提交。</p>
    {caps.sizes.length > 0 && <label className={labelClass}>输出尺寸<select aria-label="模型输出尺寸" className={selectClass}
      value={nearestImageSize(props.width, props.height, caps.sizes)} onChange={(event) => { const [width, height] = event.target.value.split("x").map(Number); dimensions(width, height); }}>
      {caps.sizes.map((size) => <option key={size} value={size}>{size.replace("x", " × ")}</option>)}
    </select></label>}
    {caps.sizeConstraints && <div className="grid grid-cols-2 gap-2">
      <label className={labelClass}>输出宽度<input aria-label="模型输出宽度" type="number" className={selectClass} min={256} max={caps.sizeConstraints.maxEdge} step={caps.sizeConstraints.multipleOf} value={props.width} onChange={event => props.setWidth(Number(event.target.value))} /></label>
      <label className={labelClass}>输出高度<input aria-label="模型输出高度" type="number" className={selectClass} min={256} max={caps.sizeConstraints.maxEdge} step={caps.sizeConstraints.multipleOf} value={props.height} onChange={event => props.setHeight(Number(event.target.value))} /></label>
      <p className="col-span-2 text-xs text-[var(--muted)]">提交时按模型的像素数、最大边长和比例限制自动对齐尺寸。</p>
    </div>}
    {caps.family === "gpt-image" && <>
      <label className={labelClass}>图像质量<select aria-label="图像质量" className={selectClass} value={props.quality} onChange={(event) => props.setQuality(event.target.value)}>
        {caps.qualityOptions.map(value => <option key={value} value={value}>{{ auto: "自动", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" }[value] || value}</option>)}
      </select></label>
      <label className={labelClass}>输出背景<select aria-label="输出背景" className={selectClass} value={props.background} onChange={(event) => props.setBackground(event.target.value)}>
        <option value="auto">自动</option><option value="opaque">不透明</option><option value="transparent">透明 PNG</option>
      </select></label>
    </>}
    {caps.family === "gemini" && <>
      <label className={labelClass}>画面比例<select aria-label="模型画面比例" className={selectClass} value={nearestImageAspectRatio(props.width, props.height, caps.aspectRatios)} onChange={(event) => {
        const [w, h] = event.target.value.split(":").map(Number); const scale = 1024 / Math.max(w, h); dimensions(Math.round(w * scale / 64) * 64, Math.round(h * scale / 64) * 64);
      }}>{caps.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
      {caps.imageSizes.length > 1 && <label className={labelClass}>分辨率<select aria-label="Gemini 图像分辨率" className={selectClass} value={props.imageSize} onChange={(event) => props.setImageSize(event.target.value)}>
        {caps.imageSizes.map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>}
    </>}
    {caps.edit && <p className="text-xs leading-5 text-[var(--muted)]">重绘、参考图和图像工具使用当前模型的编辑接口。蒙版以外区域由 LFN 合成保留。</p>}
  </div>;
}
