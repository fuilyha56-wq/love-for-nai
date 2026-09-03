import { privateKey, SlidingWindowRateLimiter, trustedClientKey } from "@/lib/rate-limit";

export const MAX_IMAGE_SAMPLES = 6;
export const MAX_IMAGE_STEPS = 50;
export const MIN_IMAGE_DIMENSION = 64;
export const MAX_IMAGE_DIMENSION = 1600;
export const MAX_IMAGE_PIXELS = 1_600 * 1_600;
export const MAX_IMAGE_REFERENCE_COUNT = 12;
export const MAX_IMAGE_BODY_BYTES = 25 * 1024 * 1024;

const limiterStore = globalThis as typeof globalThis & {
  __lfnImageRequestLimiter?: SlidingWindowRateLimiter;
};
const imageRequestLimiter =
  (limiterStore.__lfnImageRequestLimiter ??=
    new SlidingWindowRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 10_000 }));

export class ImageRequestValidationError extends Error {}

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

export function validateReferenceCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_IMAGE_REFERENCE_COUNT)
    invalid(`参考图数量不能超过 ${MAX_IMAGE_REFERENCE_COUNT}`);
}

export function assertImageModel(model: unknown): string {
  if (
    typeof model !== "string" ||
    !/^nai-v(?:3|4(?:\.5)?|5)(?:-(?:full|curated|inpaint|furry(?:-inpaint)?)(?:-limit)?)?$/i.test(model) ||
    model.toLowerCase() === "nai-chat"
  )
    invalid("当前模型不允许用于图像生成");
  return model;
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
  return imageRequestLimiter.check(imageRateLimitKey(request, identity));
}
