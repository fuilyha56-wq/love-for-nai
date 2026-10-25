/** Official canvas limits; Limit aliases keep the Opus-sized envelope. */
export const NAI_IMAGE_MULTIPLE = 64;
export const NAI_MAX_PIXELS = 3_145_728;
export const NAI_LIMIT_MAX_PIXELS = 1_048_576;
export const NAI_MAX_DIMENSION = NAI_MAX_PIXELS / NAI_IMAGE_MULTIPLE;

export function isNaiLimitModel(model: string): boolean {
  return /^nai-/i.test(model) && /-limit(?:-|$)/i.test(model);
}

export function naiMaxPixels(model: string): number {
  return isNaiLimitModel(model) ? NAI_LIMIT_MAX_PIXELS : NAI_MAX_PIXELS;
}

export function naiDimensionLimit(otherDimension: number, model = "nai-v5-full"): number {
  const other = Number.isFinite(otherDimension) ? Math.max(64, otherDimension) : 64;
  return Math.max(64, Math.floor(naiMaxPixels(model) / other / 64) * 64);
}

export function naiImageSizeError(model: string, width: number, height: number): string | null {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value >= 64 && value % 64 === 0))
    return "宽高必须是至少 64 的整数，并且是 64 的倍数。";
  const max = naiMaxPixels(model);
  return width * height > max
    ? `${isNaiLimitModel(model) ? "Limit 模型" : "NAI"}图像面积不能超过 ${max.toLocaleString("zh-CN")} 像素。`
    : null;
}

export function naiMaxSamples(width: number, height: number, model = "nai-v5-full"): number {
  if (isNaiLimitModel(model)) return 1;
  const pixels = width * height;
  return pixels <= 360_448 ? 8 : pixels <= 409_600 ? 6 : 4;
}
