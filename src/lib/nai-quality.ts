// NAI 质量词与负面预设系统（移植 Aaalice_NAI_Launcher api_constants.dart，MIT）。
// 各模型默认质量词 / V5 两档（标准/轻量）/ 各模型 UC 预设（重度/轻度/
// 人物聚焦/兽人聚焦/无），与官网一致；用户可在提示词预设页覆盖为自定义文本。

export type QualityTier = "nai-default" | "light" | "none" | "custom";
export type UcPresetType = "heavy" | "light" | "furry-focus" | "human-focus" | "none" | "custom";

export const QUALITY_TIER_LABELS: Record<string, string> = {
  "nai-default": "NAI 默认（标准）",
  light: "NAI 默认（轻量）",
  none: "无",
  custom: "自定义",
};

export const UC_PRESET_LABELS: Record<string, string> = {
  heavy: "重度",
  light: "轻度",
  "furry-focus": "兽人聚焦",
  "human-focus": "人物聚焦",
  none: "无",
  custom: "自定义",
};

type UcPresetMap = Record<Exclude<UcPresetType, "custom">, string>;

const FURRY_UC =
  "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast";

// 各模型默认质量词（追加到正面提示词末尾）。
export const MODEL_QUALITY_TAGS: Record<string, string> = {
  "nai-v5-full": "very aesthetic, masterpiece, no text",
  "nai-v5-curated": "very aesthetic, masterpiece, no text",
  "nai-v5-inpaint": "very aesthetic, masterpiece, no text",
  "nai-v4.5-full": "location, very aesthetic, masterpiece, no text",
  "nai-v4.5-curated": "location, masterpiece, no text, -0.8::feet::, rating:general",
  "nai-v4.5-inpaint": "location, very aesthetic, masterpiece, no text",
  "nai-v4-curated": "rating:general, amazing quality, very aesthetic, absurdres",
  nai: "best quality, amazing quality, very aesthetic, absurdres",
  "nai-v3-furry": "{best quality}, {amazing quality}",
};

// V5 独有两档（标准/轻量）。
const V5_QUALITY_TIERS: Record<string, string> = {
  standard: "very aesthetic, masterpiece, no text",
  light: "very aesthetic, amazing quality, no text",
};

export function isV5Model(model: string): boolean {
  return /nai-v5|diffusion-5/.test(model.toLowerCase());
}

export function modelQualityTags(model: string): string {
  return (
    MODEL_QUALITY_TAGS[model.toLowerCase()] ||
    MODEL_QUALITY_TAGS.nai ||
    "best quality, amazing quality, very aesthetic, absurdres"
  );
}

// 模型没有该档位时回退标准档，切模型不丢质量词。
export function qualityTagsForTier(model: string, tier: QualityTier): string {
  if (tier === "none") return "";
  if (tier === "light") {
    return isV5Model(model)
      ? V5_QUALITY_TIERS.light
      : modelQualityTags(model);
  }
  return modelQualityTags(model);
}

const V5_UC: UcPresetMap = {
  heavy:
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
  light:
    "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::",
  "furry-focus": FURRY_UC,
  "human-focus":
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
  none: "",
};

const V45_FULL_UC: UcPresetMap = {
  ...V5_UC,
  light:
    "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
};

const V45_CURATED_UC: UcPresetMap = {
  heavy:
    "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
  light:
    "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page",
  "furry-focus": FURRY_UC,
  "human-focus":
    "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page",
  none: "",
};

const V4_FULL_UC: UcPresetMap = {
  heavy:
    "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks",
  light:
    "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing",
  "furry-focus": FURRY_UC,
  "human-focus":
    "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, bad anatomy, bad hands",
  none: "",
};

const V4_CURATED_UC: UcPresetMap = {
  heavy:
    "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts",
  light:
    "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature",
  "furry-focus": FURRY_UC,
  "human-focus":
    "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, bad anatomy, bad hands",
  none: "",
};

const V3_UC: UcPresetMap = {
  heavy:
    "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
  light:
    "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
  "furry-focus": FURRY_UC,
  "human-focus":
    "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes",
  none: "lowres",
};

const FURRY_V3_UC: UcPresetMap = {
  heavy: FURRY_UC,
  light:
    "{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text",
  "furry-focus": FURRY_UC,
  "human-focus": FURRY_UC,
  none: "",
};

const MODEL_UC_PRESETS: Record<string, UcPresetMap> = {
  "nai-v5-full": V5_UC,
  "nai-v5-curated": V5_UC,
  "nai-v5-inpaint": V5_UC,
  "nai-v4.5-full": V45_FULL_UC,
  "nai-v4.5-inpaint": V45_FULL_UC,
  "nai-v4.5-curated": V45_CURATED_UC,
  "nai-v4-curated": V4_CURATED_UC,
  "nai-v4-full": V4_FULL_UC,
  "nai-v3": V3_UC,
  "nai-v3-inpaint": V3_UC,
  "nai-v3-furry": FURRY_V3_UC,
  "nai-v3-furry-inpaint": FURRY_V3_UC,
};

export function ucPresetContent(model: string, type: Exclude<UcPresetType, "custom">): string {
  const presets =
    MODEL_UC_PRESETS[model.toLowerCase()] ?? V45_FULL_UC;
  return presets[type] ?? "";
}

// 模型没有该 UC 档位时回退 heavy，切模型不丢负面预设。
export function ucForModel(model: string, type: Exclude<UcPresetType, "custom">): string {
  const presets = MODEL_UC_PRESETS[model.toLowerCase()];
  if (!presets) return V45_FULL_UC[type] ?? "";
  return presets[type] ?? presets.heavy ?? "";
}

// 质量词追加到正面提示词末尾（Aaalice appendSuffix 语义）。
export function appendQualityTags(prompt: string, qualityTags: string): string {
  const trimmed = prompt.trim();
  if (!qualityTags.trim()) return trimmed;
  if (!trimmed) return qualityTags.trim();
  return trimmed.endsWith(",") ? `${trimmed} ${qualityTags.trim()}` : `${trimmed}, ${qualityTags.trim()}`;
}

// UC 预设添加到负面提示词前面（Aaalice applyPreset 语义）。
export function prependUcPreset(negative: string, ucContent: string): string {
  const trimmed = negative.trim();
  if (!ucContent.trim()) return trimmed;
  if (!trimmed) return ucContent.trim();
  return `${ucContent.trim()}, ${trimmed}`;
}
