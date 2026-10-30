import { privateKey, SlidingWindowRateLimiter, trustedClientKey } from "@/lib/rate-limit";
import { cachedRiskSettings } from "./risk-settings";
import { isNaiMediumModel, NAI_MEDIUM_NEGATIVE_PROMPT } from "@/lib/nai-native-request";
import { officialNaiAnlasCost, NAI_MAX_ANLAS_PER_IMAGE } from "./image-pricing";
import { isNaiLimitModel, naiImageSizeError, NAI_MAX_DIMENSION, NAI_MAX_PIXELS } from "./nai-image-limits";

export const MAX_IMAGE_SAMPLES = 30;
export const MAX_IMAGE_STEPS = 50;
export const MIN_IMAGE_DIMENSION = 64;
export const MAX_IMAGE_DIMENSION = NAI_MAX_DIMENSION;
export const MAX_IMAGE_PIXELS = NAI_MAX_PIXELS;
export const MAX_IMAGE_REFERENCE_COUNT = 12;
export const MAX_IMAGE_BODY_BYTES = 25 * 1024 * 1024;

const limiterStore = globalThis as typeof globalThis & {
  __lfnImageRequestLimiter?: SlidingWindowRateLimiter;
};
const imageRequestLimiter =
  (limiterStore.__lfnImageRequestLimiter ??=
    new SlidingWindowRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 10_000 }));

export class ImageRequestValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "lfn_invalid_image_request") {
    super(message);
    this.name = "ImageRequestValidationError";
    this.code = code;
  }
}

function invalid(message: string): never {
  throw new ImageRequestValidationError(message);
}

function parseSafeInteger(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function positiveInteger(value: unknown, label: string): number {
  const parsed = parseSafeInteger(value);
  if (parsed == null || parsed <= 0) invalid(`${label}必须是正整数`);
  return parsed;
}

export function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return positiveInteger(value, label);
}

export function normalizeSamples(
  body: Record<string, unknown>,
  defaultValue = 1,
): number {
  const n = optionalPositiveInteger(body.n, "n");
  const nSamples = optionalPositiveInteger(body.n_samples, "n_samples");
  if (n !== undefined && nSamples !== undefined && n !== nSamples)
    invalid("n 与 n_samples 必须一致");
  const samples = n ?? nSamples ?? defaultValue;
  if (samples < 1 || samples > MAX_IMAGE_SAMPLES)
    invalid(`生成张数必须在 1-${MAX_IMAGE_SAMPLES} 之间`);
  return samples;
}

export function normalizeDimension(value: unknown, label: string): number {
  const dimension = positiveInteger(value, label);
  if (
    dimension < MIN_IMAGE_DIMENSION ||
    dimension > MAX_IMAGE_DIMENSION ||
    dimension % 8 !== 0
  )
    invalid(`${label}必须是 ${MIN_IMAGE_DIMENSION}-${MAX_IMAGE_DIMENSION} 之间的 8 的倍数`);
  return dimension;
}

export function normalizeSteps(value: unknown, defaultValue = 28): number {
  const steps = value === undefined ? defaultValue : positiveInteger(value, "steps");
  if (steps > MAX_IMAGE_STEPS) invalid(`steps 必须在 1-${MAX_IMAGE_STEPS} 之间`);
  return steps;
}

export function validateImageShape(width: number, height: number): void {
  if (width * height > MAX_IMAGE_PIXELS)
    invalid(`图像像素不能超过 ${MAX_IMAGE_PIXELS.toLocaleString("zh-CN")}`);
}

export function validateNaiModelSize(model: string, width: number, height: number): void {
  const message = naiImageSizeError(model, width, height);
  if (message) invalid(message);
}

export function validateNaiGenerationCost(model: string, width: number, height: number, steps: number, strength?: number, operation = "generate"): void {
  validateNaiModelSize(model, width, height);
  if (strength !== undefined && (!Number.isFinite(strength) || strength < 0 || strength > 1)) invalid("生图强度必须在 0 到 1 之间");
  if (isNaiLimitModel(model) && steps > 28) invalid("Limit 模型最多支持 28 步");
  if (officialNaiAnlasCost({ model, width, height, steps, strength, operation, samples: 1 }) > NAI_MAX_ANLAS_PER_IMAGE)
    invalid("这些设置的单张生成费超过 140 Anlas，请降低分辨率或步数");
}

export function validateReferenceCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_IMAGE_REFERENCE_COUNT)
    invalid(`参考图数量不能超过 ${MAX_IMAGE_REFERENCE_COUNT}`);
}

export function assertImageModel(model: unknown): string {
  if (
    typeof model !== "string" ||
    (!/^nai-v(?:3|4(?:\.5)?|5)(?:-(?:full|curated|inpaint|furry(?:-inpaint)?)(?:-limit)?)?$/i.test(model) &&
      !/^nai-v5-(?:full|inpaint)-medium$/i.test(model) &&
      model !== "nai-v4.5-curated-inpaint") ||
    model.toLowerCase() === "nai-chat"
  )
    invalid("当前模型不允许用于图像生成");
  return model;
}

export function validateMediumRequest(model: string, body: Record<string, unknown>, operation = "generate"): void {
  if (!isNaiMediumModel(model)) return;
  const reject = (message: string): never => {
    throw new ImageRequestValidationError(message, "lfn_medium_unsupported_parameter");
  };
  const guard = <T>(check: () => T): T => {
    try {
      return check();
    } catch (error) {
      if (error instanceof ImageRequestValidationError)
        reject(error.message);
      throw error;
    }
  };
  if (!["generate", "img2img", "inpainting", "edits", "outpainting"].includes(operation))
    reject("Medium 档仅支持生成、图生图和局部重绘");
  const extra = body.extra_params;
  if (extra != null && (typeof extra !== "object" || Array.isArray(extra))) reject("extra_params 必须是对象");
  const parameters = { ...body, ...(extra as Record<string, unknown> | undefined) };
  const size = typeof parameters.size === "string" ? parameters.size.split("x").map(Number) : [];
  const width = guard(() => normalizeDimension(parameters.width ?? size[0], "width"));
  const height = guard(() => normalizeDimension(parameters.height ?? size[1], "height"));
  guard(() => validateNaiModelSize(model, width, height));
  guard(() => normalizeSamples(parameters));
  if (guard(() => normalizeSteps(parameters.steps, 14)) !== 14)
    reject("Medium 档步数固定为 14");
  if (parameters.cfg_rescale !== undefined && parameters.cfg_rescale !== 0)
    reject("Medium 档不支持 Prompt Guidance Rescale");
  const fixed: Record<string, unknown> = { sampler: "k_euler_ancestral", uncond_scale: 1, params_version: 4, ucPreset: 0, ucPresetId: "heavy", tag_hint_uc_preset: 2, sm: false, sm_dyn: false };
  for (const [key, value] of Object.entries(fixed)) {
    if (parameters[key] !== undefined && parameters[key] !== value) reject(`Medium 档不支持修改 ${key}`);
  }
  if ([parameters.negative_prompt, parameters.negativePrompt].some((value) => Boolean(value) && value !== NAI_MEDIUM_NEGATIVE_PROMPT) || parameters.service_tier === "priority")
    reject("Medium 档不支持自定义负面词或 priority 服务");
  // Official clients may include empty reference lists even when references are off.
  const hasReferenceValue = (value: unknown): boolean => Array.isArray(value) ? value.length > 0 : Boolean(value);
  const hasReferences = Object.entries(parameters).some(([key, value]) => /^(?:reference_|director_reference_)/.test(key) && hasReferenceValue(value)) ||
    hasReferenceValue(parameters.references) || hasReferenceValue(parameters.characters);
  const hasControlNet = Object.entries(parameters).some(([key, value]) => Boolean(value) && /^controlnet_/.test(key) && key !== "controlnet_strength");
  if (hasReferences || hasControlNet || parameters.upscale || parameters.upscaled_enhance)
    reject("Medium 档不支持参考图、ControlNet 或付费图像工具");
  if (operation === "generate" && parameters.image) reject("Medium 文生图不能携带输入图片");
  if (Array.isArray(parameters.characterPrompts) && parameters.characterPrompts.some((item) => item && typeof item === "object" && (item.negativePrompt || item.negative)))
    reject("Medium 档不支持角色负面词");
  if (parameters.v4_negative_prompt && typeof parameters.v4_negative_prompt === "object") {
    const caption = (parameters.v4_negative_prompt as Record<string, unknown>).caption;
    if (caption && typeof caption === "object") {
      const negative = caption as Record<string, unknown>;
      if ((negative.base_caption && negative.base_caption !== NAI_MEDIUM_NEGATIVE_PROMPT) ||
        (Array.isArray(negative.char_captions) && negative.char_captions.some((item) => item && typeof item === "object" && item.char_caption)))
        reject("Medium 档不支持嵌套自定义负面词");
    }
  }
}

export function assertBodySize(request: Pick<Request, "headers">): void {
  const rawLength = request.headers.get("content-length");
  if (rawLength && (!/^\d+$/.test(rawLength) || Number(rawLength) > MAX_IMAGE_BODY_BYTES))
    invalid("请求体超过图像接口大小限制");
}

export function imageRateLimitKey(request: Pick<Request, "headers">, identity: string): string {
  const ip = trustedClientKey(request) || "proxy-untrusted";
  return `${privateKey(identity)}:${privateKey(ip)}`;
}

export function checkImageRateLimit(request: Pick<Request, "headers">, identity: string): { allowed: boolean; retryAfterSeconds: number } {
  const userId = identity.match(/^(?:user|session):(\d+)$/)?.[1];
  const settings = cachedRiskSettings(userId ? Number(userId) : undefined);
  return imageRequestLimiter.check(imageRateLimitKey(request, identity), Date.now(), Number(settings.values[userId ? "rate.perMinute" : "rate.preAuthPerMinute"]));
}
