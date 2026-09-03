export type ImagePricingGeneration = {
  model: string;
  width: number;
  height: number;
  steps: number;
  samples: number;
  strength?: number;
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
export const V45_CNY_PER_POINT = 0.04;
export const V5_CNY_PER_POINT = 0.06;

export function tokensToPoints(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.max(1, Math.ceil(tokens / TOKENS_PER_POINT));
}

export function modelPointVersion(model: string): PublicPointVersion | null {
  const lower = model.toLowerCase();
  if (!lower.startsWith("nai-") || lower === "nai-chat") return null;
  return lower.includes("nai-v5") ? "V5" : "V4.5/旧版";
}

export function pointPriceCny(model: string): number | null {
  const version = modelPointVersion(model);
  if (!version) return null;
  return version === "V5" ? V5_CNY_PER_POINT : V45_CNY_PER_POINT;
}

export function estimatePoints(generation: ImagePricingGeneration): number {
  return tokensToPoints(
    estimateTokens(generation.width, generation.height, generation.samples),
  );
}

export function estimatePointCny(generation: ImagePricingGeneration): number | null {
  const price = pointPriceCny(generation.model);
  return price == null ? null : Number((estimatePoints(generation) * price).toFixed(2));
}

// NewAPI 页面显示的余额单位与人民币的公开展示换算：200 余额单位 = 1 元。
export const NEWAPI_BALANCE_PER_CNY = 200;
export const DEFAULT_QUOTA_PER_USD = 500_000;
// 生产账单实证：quota = usage × 系数 × 0.5（Draw 分组倍率为 1 时仍有这一项）。
export const NEWAPI_IMAGE_QUOTA_MULTIPLIER = 0.5;

export function quotaPerUsd(environment: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(environment.QUOTA_PER_UNIT || DEFAULT_QUOTA_PER_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUOTA_PER_USD;
}

export function newApiBalanceToCny(balance: number): number {
  if (!Number.isFinite(balance) || balance < 0) return 0;
  return Number((balance / NEWAPI_BALANCE_PER_CNY).toFixed(8));
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
  const ratio =
    Number.isFinite(groupRatio) && groupRatio >= 0 ? groupRatio : 1;
  const quotaType = Math.round(finiteNonNegative(entry.quota_type)) === 1 ? 1 : 0;
  const snapshot: ModelPricingSnapshot = {
    model,
    modelRatio: finiteNonNegative(entry.model_ratio),
    modelPrice: finiteNonNegative(entry.model_price),
    quotaType,
    effectiveGroup,
    groupRatio: ratio,
  };
  const mode =
    typeof entry.billing_mode === "string" ? entry.billing_mode.trim().toLowerCase() : "";
  const parsed = mode === "tiered_expr" ? parseTieredExpr(entry.billing_expr) : null;
  if (!parsed) return snapshot;

  const inCoeff = parsed.kind === "two_tier" ? parsed.limitCoeff : parsed.coeff;
  const outCoeff = parsed.kind === "two_tier" ? parsed.fullCoeff : parsed.coeff;
  const unit = Math.max(1, quotaPerUsd());
  const inEnvelopeUsd =
    (envelopeUsageTokens(model) * inCoeff * NEWAPI_IMAGE_QUOTA_MULTIPLIER * ratio) /
    unit;
  const outPerTokenUsd =
    (outCoeff * NEWAPI_IMAGE_QUOTA_MULTIPLIER * ratio) / unit;
  return {
    ...snapshot,
    tiered: true,
    inEnvelopeUsd,
    outOfEnvelopeUsdPerMillion: outPerTokenUsd * 1_000_000,
    inEnvelopeBalancePerImage: inEnvelopeUsd,
    outOfEnvelopeBalancePerUsageToken: outPerTokenUsd,
  };
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

export function estimateTokens(
  width: number,
  height: number,
  samples: number,
): number {
  return Math.max(1, Math.round((width * height) / 500) * samples);
}

// 这是现有工作台显示的 NewAPI 余额单位估算；不要把它当作服务端扣费承诺。
export function estimateNewApiCost(
  pricing: ModelPricingSnapshot | null,
  generation: ImagePricingGeneration,
): number {
  if (
    pricing?.tiered &&
    pricing.inEnvelopeUsd != null &&
    pricing.outOfEnvelopeUsdPerMillion != null
  ) {
    if (isInFreeEnvelope(generation))
      return Number(
        (pricing.inEnvelopeBalancePerImage != null
          ? pricing.inEnvelopeBalancePerImage * generation.samples
          : pricing.inEnvelopeUsd! * generation.samples
        ).toFixed(8),
      );
    const tokens = estimateTokens(
      generation.width,
      generation.height,
      generation.samples,
    );
    if (pricing.outOfEnvelopeBalancePerUsageToken != null)
      return Number(
        (tokens * pricing.outOfEnvelopeBalancePerUsageToken).toFixed(8),
      );
    return Number(
      ((tokens / 1_000_000) * pricing.outOfEnvelopeUsdPerMillion!).toFixed(8),
    );
  }
  if (pricing) {
    if (pricing.quotaType === 1)
      return Number(
        (pricing.modelPrice * pricing.groupRatio * generation.samples).toFixed(2),
      );
    const tokens = estimateTokens(
      generation.width,
      generation.height,
      generation.samples,
    );
    return Number(
      (
        tokens *
        pricing.modelRatio *
        2e-6 *
        pricing.groupRatio
      ).toFixed(2),
    );
  }
  return Number(
    (estimateTokens(generation.width, generation.height, generation.samples) * 0.13).toFixed(2),
  );
}

export function estimateNewApiCny(
  pricing: ModelPricingSnapshot | null,
  generation: ImagePricingGeneration,
): number {
  return newApiBalanceToCny(estimateNewApiCost(pricing, generation));
}
