import { NAI_UPSCALE_MODEL_IDS } from "./nai-model-catalog";
import { isNaiMediumModel } from "./nai-native-request";

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
  vibeReferenceImageCount?: number;
  preciseReferenceImageCount?: number;
  referenceMode?: "precise" | "vibe";
  encodedVibeCount?: number;
  characterPromptCount?: number;
  hasInputImage?: boolean;
  serviceTier?: string;
};

export type ModelPricingSnapshot = {
  model: string;
  modelRatio: number;
  modelPrice: number;
  modelRatioKnown?: boolean;
  modelPriceKnown?: boolean;
  quotaType: number;
  effectiveGroup?: string;
  groupRatio: number;
  billingMode?: string;
  tiered?: boolean;
  inEnvelopeUsd?: number;
  outOfEnvelopeUsdPerMillion?: number;
  inEnvelopeBalancePerImage?: number;
  outOfEnvelopeBalancePerUsageToken?: number;
  outOfEnvelopeBaseBalancePerImage?: number;
};

export type RawModelPricing = {
  model_ratio?: unknown;
  model_price?: unknown;
  quota_type?: unknown;
  billing_mode?: unknown;
  billing_expr?: unknown;
};

export type ParsedTieredExpr =
  | { kind: "two_tier"; limitCoeff: number; fullCoeff: number; limitFixedRaw?: number; fullCompletionCoeff?: number }
  | { kind: "base"; coeff: number; completionCoeff?: number };

export type PublicPointVersion = "V5" | "V4.5/旧版";

export const TOKENS_PER_POINT = 50;
export const DEFAULT_QUOTA_PER_USD = 500_000;

export function roundBillingAmount(value: number): number {
  if (!Number.isFinite(value)) throw new Error("计费金额无效");
  const sign = Math.sign(value);
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const fraction = absolute - whole;
  const rounded = Math.abs(fraction - 0.5) <= 1e-9
    ? whole + 0.5
    : fraction > 0.5
      ? whole + 1
      : whole;
  return sign * rounded;
}

export function isHalfStepAmount(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) <= 1e-9;
}

function pricingReferenceCounts(generation: ImagePricingGeneration) {
  const precise = generation.operation === "precise-reference" || generation.referenceMode === "precise";
  const legacy = Math.max(0, Math.floor(generation.referenceImageCount ?? 0));
  return {
    vibe: Math.max(0, Math.floor(generation.vibeReferenceImageCount ?? (precise ? 0 : legacy))),
    precise: Math.max(0, Math.floor(generation.preciseReferenceImageCount ?? (precise ? legacy : 0))),
  };
}

export function officialNaiAnlasCost(generation: ImagePricingGeneration, opusEligible = false): number {
  const operation = generation.operation ?? "generate";
  const samples = Math.max(1, Math.floor(generation.samples));
  const references = Math.max(0, Math.floor(generation.referenceImageCount ?? 0));
  const referenceCounts = pricingReferenceCounts(generation);
  if (operation === "upscale") return upscaleAnlasCost(generation.width, generation.height) * samples;
  if (operation === "encode-vibe") return 2 * Math.max(1, references);
  const tool = operation.replace(/^director-/, "");
  if (tool in DIRECTOR_COSTS) return DIRECTOR_COSTS[tool] * samples;
  const pixels = Math.max(generation.width * generation.height, 65_536);
  const medium = isNaiMediumModel(generation.model);
  const steps = medium ? 14 : generation.steps;
  const stepFactor = medium ? 1 / 1.06521739 : 1;
  const base = Math.ceil(2.951823174884865e-6 * pixels + 5.753298233447344e-7 * pixels * steps * stepFactor);
  const v5 = modelPointVersion(generation.model) === "V5";
  const strength = ["img2img", "inpainting", "infill", "edits", "outpainting"].includes(operation)
    ? generation.strength ?? (operation === "img2img" ? 0.7 : 1)
    : 1;
  const perSample = Math.ceil(Math.max(2, Math.ceil(base * (v5 ? 1.5 : 1) * strength)) * (generation.uncondScale ?? 1));
  const free = opusEligible && steps <= 28 && pixels <= 1_048_576 && generation.serviceTier !== "priority" ? 1 : 0;
  let total = perSample * Math.max(0, samples - free);
  total += 5 * referenceCounts.precise * samples;
  total += 2 * Math.max(0, referenceCounts.vibe - (generation.encodedVibeCount ?? 0)) + 2 * Math.max(0, referenceCounts.vibe - 4);
  return total;
}

export const CNY_PER_ANLAS = 0.02;
export const CNY_PER_AFF = 0.005;
export const AFF_PER_ANLAS = CNY_PER_ANLAS / CNY_PER_AFF;
export const V5_ANLAS_SALES_MULTIPLIER = 1.25;
export const NAI_MAX_ANLAS_PER_IMAGE = 140;

export const MEDIUM_ANLAS_RATIO = 18 / 26;
export const MEDIUM_AFF_PER_IMAGE = Math.max(1, Math.round(2 * MEDIUM_ANLAS_RATIO));
export const V5_BASE_AFF_PER_IMAGE = 5;
const DIRECTOR_COSTS: Record<string, number> = {
  declutter: 5,
  "bg-removal": 65,
  "bg-remover": 65,
  lineart: 5,
  sketch: 5,
  colorize: 5,
  emotion: 5,
};

export type LocalAnlasPrices = { v45AnlasCny: number; v5AnlasCny: number };

export function imageCreditCost(generation: ImagePricingGeneration, fixedCostPerSample: number | null = null, prices?: LocalAnlasPrices): number {
  return fixedCostPerSample != null
    ? Math.round(fixedCostPerSample * generation.samples * 10_000) / 10_000
    : affCost(generation, prices);
}

export function splitImageCreditCost(cost: number, samples: number, packageBalance: number, availablePackageImages: number, sampleCosts?: number[]) {
  const precision = isHalfStepAmount(cost) ? 2 : 10_000;
  const costUnits = Math.round(cost * precision);
  const baseUnits = Math.floor(costUnits / samples);
  const remainderUnits = costUnits % samples;
  let remainingPackage = packageBalance;
  const packageChargesBySample: number[] = [];
  const personalChargesBySample: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const round = (amount: number) => Math.round(amount * 10_000) / 10_000;
    const sampleCost = sampleCosts?.[index] ?? (baseUnits + (index < remainderUnits ? 1 : 0)) / precision;
    const packageCharge = index < availablePackageImages ? round(Math.min(remainingPackage, sampleCost)) : 0;
    remainingPackage = round(remainingPackage - packageCharge);
    packageChargesBySample.push(packageCharge);
    personalChargesBySample.push(round(sampleCost - packageCharge));
  }
  return {
    packageChargesBySample,
    personalChargesBySample,
    packageCost: Math.round(packageChargesBySample.reduce((total, value) => total + value, 0) * 10_000) / 10_000,
    personalCost: Math.round(personalChargesBySample.reduce((total, value) => total + value, 0) * 10_000) / 10_000,
  };
}

export function imagePricingStrength(body: Record<string, unknown>, operation: string): number | undefined {
  if (["inpainting", "edits", "outpainting", "infill"].includes(operation))
    return typeof body.inpaintImg2ImgStrength === "number" ? body.inpaintImg2ImgStrength : 1;
  if (operation === "img2img")
    return typeof body.strength === "number" ? body.strength : 0.7;
  return undefined;
}

export function tokensToPoints(tokens: number): number {
  return Number.isFinite(tokens) && tokens > 0 ? tokens / TOKENS_PER_POINT : 0;
}

export function modelPointVersion(model: string): PublicPointVersion | null {
  model = model.toLowerCase();
  if (!model.startsWith("nai-") || model === "nai-chat") return null;
  return /nai-v5|diffusion-5/.test(model) ? "V5" : "V4.5/旧版";
}

export function pointPriceCny(model: string): number | null {
  const version = modelPointVersion(model);
  return version ? CNY_PER_ANLAS * (version === "V5" ? V5_ANLAS_SALES_MULTIPLIER : 1) : null;
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
    isInFreeEnvelope(generation)
  );
}

// Official Anlas and the fixed-envelope usage markers are separate units.
export function estimatePoints(generation: ImagePricingGeneration): number {
  if (generation.sequential && generation.samples > 1)
    return (
      estimatePoints({ ...generation, samples: 1, sequential: false }) *
      generation.samples
    );
  if (usesLimitPricing(generation)) return 0;
  return gatewayAnlasCost(generation);
}

export function gatewayAnlasCost(generation: ImagePricingGeneration): number {
  return officialNaiAnlasCost(generation, /-limit(?:-|$)/i.test(generation.model));
}

export function estimateTokens(generation: ImagePricingGeneration): number {
  return estimatePoints(generation) * TOKENS_PER_POINT;
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function hasFiniteNonNegative(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  return typeof value === "string" && value.trim() !== "" &&
    Number.isFinite(Number(value)) && Number(value) >= 0;
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
  if (limitCoeff != null && fullCoeff != null) {
    const limitFixedRaw = coeffFromMatch(source.match(/tier\(\s*["']limit["']\s*,\s*p\s*\*\s*0\s*\+\s*c\s*\*\s*0\s*\+\s*(\d+)\s*\)/i));
    const fullCompletionCoeff = coeffFromMatch(source.match(/tier\(\s*["']full["']\s*,\s*p\s*\*\s*\d+\s*\+\s*c\s*\*\s*(\d+)/i));
    return { kind: "two_tier", limitCoeff, fullCoeff, ...(limitFixedRaw != null ? { limitFixedRaw } : {}), ...(fullCompletionCoeff ? { fullCompletionCoeff } : {}) };
  }
  const baseCoeff = coeffFromMatch(
    source.match(/tier\(\s*["']base["']\s*,\s*p\s*\*\s*(\d+)/i),
  );
  const completionCoeff = coeffFromMatch(source.match(/tier\(\s*["']base["']\s*,\s*p\s*\*\s*\d+\s*\+\s*c\s*\*\s*(\d+)/i));
  return baseCoeff != null ? { kind: "base", coeff: baseCoeff, ...(completionCoeff ? { completionCoeff } : {}) } : null;
}

export function envelopeUsageTokens(model: string): number {
  if (isNaiMediumModel(model)) return 18;
  // Gateway _BILLING_LIMIT_UNITS_V5 is 25; NewAPI settles this usage marker.
  return modelPointVersion(model) === "V5" ? 25 : 0;
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
  const mode =
    typeof entry.billing_mode === "string"
      ? entry.billing_mode.trim().toLowerCase()
      : "";
  const snapshot: ModelPricingSnapshot = {
    model,
    modelRatio: finiteNonNegative(entry.model_ratio),
    modelPrice: finiteNonNegative(entry.model_price),
    modelRatioKnown: hasFiniteNonNegative(entry.model_ratio),
    modelPriceKnown: hasFiniteNonNegative(entry.model_price),
    quotaType,
    effectiveGroup,
    groupRatio: ratio,
    billingMode: mode,
  };
  const parsed =
    mode === "tiered_expr" ? parseTieredExpr(entry.billing_expr) : null;
  if (!parsed) return snapshot;

  const inCoeff = parsed.kind === "two_tier" ? parsed.limitCoeff : parsed.coeff;
  const outCoeff = parsed.kind === "two_tier" ? parsed.fullCoeff : parsed.coeff;
  const inEnvelopeUsd =
    ((envelopeUsageTokens(model) * inCoeff + (parsed.kind === "two_tier" ? parsed.limitFixedRaw ?? 0 : 0)) * ratio) / 1_000_000;
  const outPerTokenUsd = (outCoeff * ratio) / 1_000_000;
  return {
    ...snapshot,
    tiered: true,
    inEnvelopeUsd,
    outOfEnvelopeUsdPerMillion: outPerTokenUsd * 1_000_000,
    inEnvelopeBalancePerImage: inEnvelopeUsd,
    outOfEnvelopeBalancePerUsageToken: outPerTokenUsd,
    outOfEnvelopeBaseBalancePerImage: ((parsed.kind === "two_tier" ? parsed.fullCompletionCoeff ?? 0 : parsed.completionCoeff ?? 0) * ratio) / 1_000_000,
  };
}

// NAI 独立超分（/ai/upscale）按输入面积档位计费，与官网价格表逐档对齐；
// 超过 3145728 px（1536x2048）上游直接 400 拒绝。
export const UPSCALE_MAX_PIXELS = 3_145_728;
export const UPSCALE_MODELS = new Set(NAI_UPSCALE_MODEL_IDS);

export function upscaleBillingModel(model: string): string {
  if (!UPSCALE_MODELS.has(model)) throw new Error("超分模型无效");
  return model === "nai-diffusion-5-full" ? "nai-v5-full" : "nai-v5-curated";
}

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
  const references = pricingReferenceCounts(generation);
  const referenceCount = references.vibe;
  return (
    ["generate", "img2img", "inpainting", "infill", "edits", "outpainting", "vibe-transfer", "character-reference"].includes(operation) &&
    operation !== "precise-reference" &&
    generation.referenceMode !== "precise" &&
    references.precise === 0 &&
    generation.samples === 1 &&
    generation.steps >= 1 &&
    generation.steps <= 28 &&
    generation.width * generation.height <= 1024 * 1024 &&
    referenceCount <= 4 &&
    (referenceCount === 0 ||
      (generation.encodedVibeCount ?? 0) >= referenceCount) &&
    generation.serviceTier !== "priority" &&
    !(operation === "generate" && generation.hasInputImage)
  );
}

/** Billable Anlas after the local single-image envelope, without currency conversion. */
export function billableNaiAnlasCost(generation: ImagePricingGeneration): number {
  if (generation.sequential && generation.samples > 1)
    return billableNaiAnlasCost({ ...generation, samples: 1, sequential: false }) * generation.samples;
  if (generation.operation === "annotate") return 0;
  return isInFreeEnvelope(generation) ? 0 : officialNaiAnlasCost(generation);
}

export function affCost(generation: ImagePricingGeneration, prices?: LocalAnlasPrices): number {
  const samples = generation.samples;
  if (!Number.isSafeInteger(samples) || samples < 1 ||
      !Number.isSafeInteger(generation.width) || generation.width < 1 ||
      !Number.isSafeInteger(generation.height) || generation.height < 1 ||
      !Number.isSafeInteger(generation.steps) || generation.steps < 1)
    throw new Error("图像计费参数无效");
  if (generation.sequential && samples > 1)
    return Math.round(affCost({ ...generation, samples: 1, sequential: false }, prices) * samples * 10_000) / 10_000;
  const operation = generation.operation ?? "generate";
  if (operation === "annotate") return samples;
  const standalone = operation === "upscale" || operation === "encode-vibe" ||
    operation.replace(/^director-/, "") in DIRECTOR_COSTS;
  const affPerAnlas = prices
    ? (modelPointVersion(generation.model) === "V5" ? prices.v5AnlasCny : prices.v45AnlasCny) / CNY_PER_AFF
    : AFF_PER_ANLAS * (modelPointVersion(generation.model) === "V5" ? V5_ANLAS_SALES_MULTIPLIER : 1);
  if (standalone) return Math.round(officialNaiAnlasCost(generation) * affPerAnlas * 10_000) / 10_000;
  const baseAff = isNaiMediumModel(generation.model) ? MEDIUM_AFF_PER_IMAGE :
    modelPointVersion(generation.model) === "V5" ? V5_BASE_AFF_PER_IMAGE : 1;
  const anlas = isInFreeEnvelope(generation) ? 0 : officialNaiAnlasCost(generation);
  return Math.round((baseAff * samples + anlas * affPerAnlas) * 10_000) / 10_000;
}

// Estimate the NewAPI balance charge from the effective model/group pricing.
// An unrecognized NAI price must not be shown as a cheap reference quote.
export function estimateNewApiCost(
  pricing: ModelPricingSnapshot | null,
  generation: ImagePricingGeneration,
): number | null {
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
    ) {
      const cost = estimateNewApiCost(pricing, {
        ...generation,
        samples: Math.min(remaining, batchSize),
        sequential: false,
        maxSamplesPerRequest: undefined,
      });
      if (cost === null) return null;
      total += cost;
    }
    return Number(total.toFixed(8));
  }
  if (modelPointVersion(generation.model)) {
    if (!pricing || pricing.model !== generation.model) return null;
    const inEnvelope = usesLimitPricing(generation);
    const usageTokens = inEnvelope
      ? envelopeUsageTokens(generation.model)
      : estimateTokens(generation);
    if (pricing.tiered) {
      const price = inEnvelope
        ? pricing.inEnvelopeUsd
        : pricing.outOfEnvelopeBalancePerUsageToken;
      if (price == null || !Number.isFinite(price) || price < 0) return null;
      const generationSamples = ["generate", "img2img", "inpainting", "infill", "edits", "outpainting", "vibe-transfer", "character-reference", "precise-reference"].includes(generation.operation ?? "generate") ? generation.samples : 0;
      return Number((inEnvelope ? price : usageTokens * price + generationSamples * (pricing.outOfEnvelopeBaseBalancePerImage ?? 0)).toFixed(8));
    }
    if (pricing.billingMode === "tiered_expr") return null;
    if (pricing.quotaType === 1) {
      if (!pricing.modelPriceKnown) return null;
      return pricing.modelPrice * pricing.groupRatio * generation.samples;
    }
    if (!pricing.modelRatioKnown) return null;
    return usageTokens * pricing.modelRatio * 2e-6 * pricing.groupRatio;
  }
  if (!pricing || pricing.model !== generation.model || pricing.billingMode === "tiered_expr")
    return null;
  if (pricing.quotaType === 1) {
    if (!pricing.modelPriceKnown) return null;
    return pricing.modelPrice * pricing.groupRatio * generation.samples;
  }
  if (!pricing.modelRatioKnown) return null;
  return (
    estimateTokens(generation) * pricing.modelRatio * 2e-6 * pricing.groupRatio
  );
}
