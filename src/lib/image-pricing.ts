export type ImagePricingGeneration = {
  model: string;
  width: number;
  height: number;
  steps: number;
  samples: number;
  strength?: number;
  uncondScale?: number;
  sequential?: boolean;
  maxSamplesPerRequest?: number;
  operation?: string;
  referenceImageCount?: number;
  encodedVibeCount?: number;
  characterPromptCount?: number;
  hasInputImage?: boolean;
  serviceTier?: string;
};

export type ModelPricingSnapshot = {
  model: string;
  modelRatio: number;
  modelPrice: number;
  quotaType: number;
  effectiveGroup?: string;
  groupRatio: number;
  tiered?: boolean;
  inEnvelopeUsd?: number;
  outOfEnvelopeUsdPerMillion?: number;
  inEnvelopeBalancePerImage?: number;
  outOfEnvelopeBalancePerUsageToken?: number;
};

export type RawModelPricing = {
  model_ratio?: unknown;
  model_price?: unknown;
  quota_type?: unknown;
  billing_mode?: unknown;
  billing_expr?: unknown;
};

export type ParsedTieredExpr =
  | { kind: "two_tier"; limitCoeff: number; fullCoeff: number }
  | { kind: "base"; coeff: number };

export type PublicPointVersion = "V5" | "V4.5/旧版";

export const TOKENS_PER_POINT = 50;
export const USD_PER_POINT = 0.03;
export const V5_LIMIT_USD = 0.06;
export const DEFAULT_QUOTA_PER_USD = 500_000;

export function tokensToPoints(tokens: number): number {
  return Number.isFinite(tokens) && tokens > 0 ? tokens / TOKENS_PER_POINT : 0;
}

export function modelPointVersion(model: string): PublicPointVersion | null {
  if (!model.startsWith("nai-") || model === "nai-chat") return null;
  return /nai-v5|diffusion-5/.test(model) ? "V5" : "V4.5/旧版";
}

export function pointPriceUsd(model: string): number | null {
  return modelPointVersion(model) ? USD_PER_POINT : null;
}

export function quotaPerUsd(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number(environment.QUOTA_PER_UNIT || DEFAULT_QUOTA_PER_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUOTA_PER_USD;
}

export function usesLimitPricing(generation: ImagePricingGeneration): boolean {
  return (
    /nai-v5|nai-v4\.5|diffusion-5|diffusion-4-5/.test(generation.model) &&
    isInFreeEnvelope({ ...generation, characterPromptCount: 0 })
  );
}

// Mirrors gateway _calc_anlas_cost; AFF is an independent wallet and must not
// supply the limit-tier Anlas estimate. V5's gateway sales multiplier is 2.
export function estimatePoints(generation: ImagePricingGeneration): number {
  if (generation.sequential && generation.samples > 1)
    return (
      estimatePoints({ ...generation, samples: 1, sequential: false }) *
      generation.samples
    );
  if (usesLimitPricing(generation)) return 0;
  const operation = generation.operation ?? "generate";
  if (operation === "upscale")
    return (
      upscaleAnlasCost(generation.width, generation.height) * generation.samples
    );
  if (operation === "encode-vibe")
    return 2 * Math.max(1, generation.referenceImageCount ?? 1);
  const director: Record<string, number> = {
    declutter: 5,
    "bg-removal": 65,
    "bg-remover": 65,
    lineart: 5,
    sketch: 5,
    colorize: 5,
    emotion: 5,
  };
  const tool = operation.replace(/^director-/, "");
  if (tool in director) return director[tool] * generation.samples;
  const pixels = Math.max(generation.width * generation.height, 65_536);
  let perSample = Math.ceil(
    2.951823174884865e-6 * pixels +
      5.753298233447344e-7 * pixels * generation.steps,
  );
  if (generation.strength != null && generation.strength < 1)
    perSample = Math.max(Math.ceil(perSample * generation.strength), 2);
  perSample = Math.ceil(perSample * (generation.uncondScale ?? 1));
  let total = perSample * generation.samples;
  const references = generation.referenceImageCount ?? 0;
  if (operation === "precise-reference")
    total += 5 * references * generation.samples;
  else {
    const raw = Math.max(0, references - (generation.encodedVibeCount ?? 0));
    total += 2 * raw + 2 * Math.max(0, raw - 4);
  }
  return Math.max(
    0,
    total * (modelPointVersion(generation.model) === "V5" ? 2 : 1),
  );
}

export function estimateTokens(generation: ImagePricingGeneration): number {
  return estimatePoints(generation) * TOKENS_PER_POINT;
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function coeffFromMatch(match: RegExpMatchArray | null): number | null {
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : null;
}

export function parseTieredExpr(expr: unknown): ParsedTieredExpr | null {
  if (typeof expr !== "string" || !expr.trim()) return null;
  const source = expr.trim();
  const limitCoeff = coeffFromMatch(
    source.match(/tier\(\s*["']limit["']\s*,\s*p\s*\*\s*(\d+)/i),
  );
  const fullCoeff = coeffFromMatch(
    source.match(/tier\(\s*["']full["']\s*,\s*p\s*\*\s*(\d+)/i),
  );
  if (limitCoeff != null && fullCoeff != null)
    return { kind: "two_tier", limitCoeff, fullCoeff };
  const baseCoeff = coeffFromMatch(
    source.match(/tier\(\s*["']base["']\s*,\s*p\s*\*\s*(\d+)/i),
  );
  return baseCoeff != null ? { kind: "base", coeff: baseCoeff } : null;
}

export function envelopeUsageTokens(model: string): number {
  return model.toLowerCase().includes("nai-v5") ? 8 : 0;
}

export function snapshotFromRawPricing(
  model: string,
  entry: RawModelPricing,
  groupRatio: number,
  effectiveGroup?: string,
): ModelPricingSnapshot {
  const ratio = Number.isFinite(groupRatio) && groupRatio >= 0 ? groupRatio : 1;
  const quotaType =
    Math.round(finiteNonNegative(entry.quota_type)) === 1 ? 1 : 0;
  const snapshot: ModelPricingSnapshot = {
    model,
    modelRatio: finiteNonNegative(entry.model_ratio),
    modelPrice: finiteNonNegative(entry.model_price),
    quotaType,
    effectiveGroup,
    groupRatio: ratio,
  };
  const mode =
    typeof entry.billing_mode === "string"
      ? entry.billing_mode.trim().toLowerCase()
      : "";
  const parsed =
    mode === "tiered_expr" ? parseTieredExpr(entry.billing_expr) : null;
  if (!parsed) return snapshot;

  const inCoeff = parsed.kind === "two_tier" ? parsed.limitCoeff : parsed.coeff;
  const outCoeff = parsed.kind === "two_tier" ? parsed.fullCoeff : parsed.coeff;
  const inEnvelopeUsd =
    (envelopeUsageTokens(model) * inCoeff * ratio) / 1_000_000;
  const outPerTokenUsd = (outCoeff * ratio) / 1_000_000;
  return {
    ...snapshot,
    tiered: true,
    inEnvelopeUsd,
    outOfEnvelopeUsdPerMillion: outPerTokenUsd * 1_000_000,
    inEnvelopeBalancePerImage: inEnvelopeUsd,
    outOfEnvelopeBalancePerUsageToken: outPerTokenUsd,
  };
}

// NAI 独立超分（/ai/upscale）按输入面积档位计费，与官网价格表逐档对齐；
// 超过 3145728 px（1536x2048）上游直接 400 拒绝。
export const UPSCALE_MAX_PIXELS = 3_145_728;
export const UPSCALE_MODELS = new Set([
  "nai-diffusion-5-full",
  "nai-diffusion-5-curated",
]);

export function upscaleAnlasCost(width: number, height: number): number {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0)
    throw new Error("超分图片尺寸无效");
  if (pixels > UPSCALE_MAX_PIXELS)
    throw new Error(
      `图片超出超分上限：${pixels} 像素，最大 ${UPSCALE_MAX_PIXELS}（1536x2048）`,
    );
  // 档位边界来自 NAI webui 价格表：1048576→1、1747627→2、2446678→3、3145728→4。
  if (pixels <= 1_048_576) return 1;
  if (pixels <= 1_747_627) return 2;
  if (pixels <= 2_446_678) return 3;
  return 4;
}

export function isInFreeEnvelope(generation: ImagePricingGeneration): boolean {
  const operation = generation.operation ?? "generate";
  const referenceCount = generation.referenceImageCount ?? 0;
  return (
    ["generate", "img2img", "inpainting", "edits"].includes(operation) &&
    operation !== "precise-reference" &&
    generation.samples === 1 &&
    generation.steps >= 1 &&
    generation.steps <= 28 &&
    generation.width * generation.height <= 1024 * 1024 &&
    (referenceCount === 0 ||
      (generation.encodedVibeCount ?? 0) >= referenceCount) &&
    !(generation.characterPromptCount ?? 0) &&
    generation.serviceTier !== "priority" &&
    !(operation === "generate" && generation.hasInputImage)
  );
}

export function affCost(generation: ImagePricingGeneration): number {
  const operation = generation.operation ?? "generate";
  if (operation === "encode-vibe") {
    const count = Math.max(
      1,
      generation.referenceImageCount ?? generation.samples ?? 1,
    );
    return 2 * count;
  }
  if (operation === "annotate") {
    const samples =
      Number.isSafeInteger(generation.samples) && generation.samples > 0
        ? generation.samples
        : 1;
    return Math.max(1, samples);
  }
  if (operation === "upscale") {
    // V5 扩散超分：按输入面积 1-4 档，与 NAI 实扣 Anlas 1:1。
    const samples =
      Number.isSafeInteger(generation.samples) && generation.samples > 0
        ? generation.samples
        : 1;
    return upscaleAnlasCost(generation.width, generation.height) * samples;
  }
  if (
    !Number.isSafeInteger(generation.samples) ||
    generation.samples < 1 ||
    !Number.isSafeInteger(generation.width) ||
    generation.width < 1 ||
    !Number.isSafeInteger(generation.height) ||
    generation.height < 1 ||
    !Number.isSafeInteger(generation.steps) ||
    generation.steps < 1
  )
    throw new Error("图像计费参数无效");
  const model = generation.model.toLowerCase();
  if (model.includes("-limit") || isInFreeEnvelope(generation)) {
    if (model.includes("nai-v5")) return Math.ceil(1.5 * generation.samples);
    return generation.samples;
  }

  const pixels = Math.max(generation.width * generation.height, 65_536);
  let perSample = Math.ceil(
    2.951823174884865e-6 * pixels +
      5.753298233447344e-7 * pixels * generation.steps,
  );
  if (generation.strength != null && generation.strength < 1)
    perSample = Math.max(Math.ceil(perSample * generation.strength), 2);
  let total = perSample * generation.samples;
  const referenceCount = generation.referenceImageCount ?? 0;
  if (referenceCount > 0) {
    if (generation.operation === "precise-reference")
      total += 5 * referenceCount * generation.samples;
    else {
      const billableCount = Math.max(
        0,
        referenceCount - (generation.encodedVibeCount ?? 0),
      );
      total += 2 * billableCount + 2 * Math.max(0, billableCount - 4);
    }
  }
  if (model.includes("nai-v5")) total *= 2;
  return Math.max(1, Math.ceil(total));
}

// USD policy estimate. Live NewAPI configuration remains visible in the catalog;
// changing this function does not change upstream settlement.
export function estimateNewApiCost(
  pricing: ModelPricingSnapshot | null,
  generation: ImagePricingGeneration,
): number {
  const batchSize = generation.sequential ? 1 : generation.maxSamplesPerRequest;
  if (
    batchSize != null &&
    Number.isSafeInteger(batchSize) &&
    batchSize > 0 &&
    generation.samples > batchSize
  ) {
    let total = 0;
    for (
      let remaining = generation.samples;
      remaining > 0;
      remaining -= batchSize
    )
      total += estimateNewApiCost(pricing, {
        ...generation,
        samples: Math.min(remaining, batchSize),
        sequential: false,
        maxSamplesPerRequest: undefined,
      });
    return Number(total.toFixed(8));
  }
  if (modelPointVersion(generation.model)) {
    if (usesLimitPricing(generation))
      return modelPointVersion(generation.model) === "V5" ? V5_LIMIT_USD : 0;
    return Number((estimatePoints(generation) * USD_PER_POINT).toFixed(8));
  }
  if (!pricing) return 0;
  if (pricing.quotaType === 1)
    return pricing.modelPrice * pricing.groupRatio * generation.samples;
  return (
    estimateTokens(generation) * pricing.modelRatio * 2e-6 * pricing.groupRatio
  );
}
