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
};

// NewAPI 页面显示的余额单位与人民币的公开展示换算：200 余额单位 = 1 元。
export const NEWAPI_BALANCE_PER_CNY = 200;

export function newApiBalanceToCny(balance: number): number {
  if (!Number.isFinite(balance) || balance < 0) return 0;
  return Number((balance / NEWAPI_BALANCE_PER_CNY).toFixed(8));
}

export function isInFreeEnvelope(generation: ImagePricingGeneration): boolean {
  return (
    (generation.operation ?? "generate") === "generate" &&
    generation.samples <= 1 &&
    generation.steps <= 28 &&
    generation.width * generation.height <= 1024 * 1024 &&
    !(generation.referenceImageCount ?? 0) &&
    !(generation.characterPromptCount ?? 0)
  );
}

export function affCost(generation: ImagePricingGeneration): number {
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
        (pricing.inEnvelopeUsd * generation.samples).toFixed(2),
      );
    const tokens = estimateTokens(
      generation.width,
      generation.height,
      generation.samples,
    );
    return Number(
      ((tokens / 1_000_000) * pricing.outOfEnvelopeUsdPerMillion).toFixed(2),
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
