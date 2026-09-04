// NAI 图片参数 → 工作台状态的纯映射（客户端安全，无 server-only 依赖）。
// 别名表与 src/lib/compat-api.ts 的 novelAiModelAliases 保持一致方向：NAI 原名 → LFN id。

const naiModelAliases: Record<string, string> = {
  "nai-diffusion-4-5-full": "nai-v4.5-full",
  "nai-diffusion-4-5-curated": "nai-v4.5-curated",
  "nai-diffusion-4-5-full-inpainting": "nai-v4.5-inpaint",
  "nai-diffusion-5": "nai-v5-full",
  "nai-diffusion-5-curated": "nai-v5-curated",
  "nai-diffusion-5-full": "nai-v5-full",
  "nai-diffusion-5-inpainting": "nai-v5-inpaint",
  "nai-diffusion-4-full": "nai-v4-full",
  "nai-diffusion-4-curated-preview": "nai-v4-curated",
  "nai-diffusion-3": "nai-v3",
  "nai-diffusion-3-inpainting": "nai-v3-inpaint",
  "nai-diffusion-furry-3": "nai-v3-furry",
  "nai-diffusion-furry-3-inpainting": "nai-v3-furry-inpaint",
};

const studioSamplers = new Set([
  "k_euler",
  "k_euler_ancestral",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m",
  "k_dpmpp_2m_sde",
  "k_dpmpp_sde",
  "ddim_v3",
]);

const studioSchedules = new Set([
  "native",
  "karras",
  "exponential",
  "polyexponential",
]);

// 工作台提交校验要求宽高为 64 的倍数，服务端上限 1600×1600（≤2,560,000 像素）。
const DIMENSION_MIN = 64;
const DIMENSION_MAX = 1600;
const MAX_PIXELS = 2_560_000;

function roundTo64(value: number): number {
  return Math.min(DIMENSION_MAX, Math.max(DIMENSION_MIN, Math.round(value / 64) * 64));
}

function clampDimension(value: number): number | undefined {
  if (!Number.isFinite(value) || value < DIMENSION_MIN || value > DIMENSION_MAX)
    return undefined;
  return roundTo64(value);
}

// 超出像素上限时按比例缩到 64 倍数网格内，保持宽高比。
function fitPixelCap(width: number, height: number): { width: number; height: number } {
  if (width * height <= MAX_PIXELS) return { width, height };
  const factor = Math.sqrt(MAX_PIXELS / (width * height));
  return {
    width: roundTo64(width * factor),
    height: roundTo64(height * factor),
  };
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

/**
 * 把 NAI 元数据里的模型名解析为工作台可选模型 id：
 * 先查别名表，再接受本来就是 LFN id 的值；映射结果不在可选列表时
 * 退到同代 curated 版本，仍无则返回 undefined（保持用户当前选择）。
 */
export function resolveStudioModel(
  name: unknown,
  validModels: string[],
): string | undefined {
  if (typeof name !== "string") return undefined;
  const raw = name.trim().toLowerCase();
  if (!raw) return undefined;
  const valid = new Set(validModels);
  const primary = naiModelAliases[raw] ?? raw;
  if (valid.has(primary)) return primary;
  const curated = primary.replace(/-full(?=-|$)/, "-curated");
  if (valid.has(curated)) return curated;
  return undefined;
}

export type NaiImportResult = {
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  cfgRescale?: number;
  sampler?: string;
  noiseSchedule?: string;
  seed?: string;
  count?: number;
  strength?: number;
};

/**
 * 把 parseNaiImageMetadata 输出的 parameters 映射成工作台可用的
 * 参数片段：数值全部经过工作台同款钳制（64 倍数、像素上限、范围），
 * 枚举值只接受工作台支持的 sampler / noise_schedule。
 */
export function mapNaiParameters(
  params: Record<string, unknown>,
  validModels: string[],
): NaiImportResult {
  const result: NaiImportResult = {};

  const prompt = optionalText(params.prompt, 10_000);
  if (prompt) result.prompt = prompt;
  const negative = optionalText(
    params.negative_prompt ?? params.uc ?? params.negativePrompt,
    10_000,
  );
  if (negative) result.negativePrompt = negative;

  const model = resolveStudioModel(params.model, validModels);
  if (model) result.model = model;

  const rawWidth = clampDimension(finiteNumber(params.width) ?? Number.NaN);
  const rawHeight = clampDimension(finiteNumber(params.height) ?? Number.NaN);
  if (rawWidth && rawHeight) {
    const fitted = fitPixelCap(rawWidth, rawHeight);
    result.width = fitted.width;
    result.height = fitted.height;
  }

  const steps = finiteNumber(params.steps);
  if (steps != null && steps >= 1 && steps <= 50)
    result.steps = Math.round(steps);

  const scale = finiteNumber(params.scale);
  if (scale != null && scale >= 0 && scale <= 10) result.scale = scale;

  const cfgRescale = finiteNumber(params.cfg_rescale);
  if (cfgRescale != null && cfgRescale >= 0 && cfgRescale <= 1)
    result.cfgRescale = cfgRescale;

  const sampler = optionalText(params.sampler, 80);
  if (sampler && studioSamplers.has(sampler)) result.sampler = sampler;

  const noiseSchedule = optionalText(params.noise_schedule, 80);
  if (noiseSchedule && studioSchedules.has(noiseSchedule))
    result.noiseSchedule = noiseSchedule;

  const seed = finiteNumber(params.seed);
  if (seed != null && Number.isSafeInteger(seed)) result.seed = String(seed);

  const count = finiteNumber(params.n_samples);
  if (count != null && count >= 1 && count <= 6)
    result.count = Math.round(count);

  const strength = finiteNumber(params.strength);
  if (strength != null && strength >= 0 && strength <= 1)
    result.strength = strength;

  return result;
}
