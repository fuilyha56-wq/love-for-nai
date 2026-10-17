import { affCost, MEDIUM_AFF_PER_IMAGE, V5_BASE_AFF_PER_IMAGE, type ImagePricingGeneration } from "./image-pricing";
import { isNaiMediumModel, naiUsageModel } from "./nai-native-request";

export type DailyImageFamily = "v45" | "v5";
export const CNY_PER_AFF = 0.005;
export type DailyPriceTier = {
  afterImages: number;
  baseCny: number;
  anlasMultiplier: number;
  totalMultiplier: number;
};
export type DailyImagePolicy = {
  enabled: boolean;
  /** Optional restriction: disallow switching to NewAPI's independently billed generation. */
  strictApiBilling?: boolean;
  displayUsdPerCny: number;
  v45AnlasCny: number;
  v5AnlasCny: number;
  v45: DailyPriceTier[];
  v5: DailyPriceTier[];
};
export type DailyImageQuote = {
  family: DailyImageFamily;
  day: string;
  startCount: number;
  samples: number;
  anlas: number;
  cnyPerAff: number;
  affCosts: number[];
  cnyCosts: number[];
  costAff: number;
  costCny: number;
};
export type DailyImageBillingState = {
  policy: DailyImagePolicy;
  cnyPerAff: number;
  counts: Record<DailyImageFamily, number>;
  day: string;
  packageCny: number;
  affPerPackage: number;
};

export const DEFAULT_DAILY_IMAGE_POLICY: DailyImagePolicy = {
  enabled: true,
  strictApiBilling: false,
  displayUsdPerCny: 200,
  v45AnlasCny: 0.02,
  v5AnlasCny: 0.025,
  v45: [
    { afterImages: 0, baseCny: 0, anlasMultiplier: 1, totalMultiplier: 1 },
    {
      afterImages: 100,
      baseCny: 0.01,
      anlasMultiplier: 1.1,
      totalMultiplier: 1,
    },
    {
      afterImages: 200,
      baseCny: 0.011,
      anlasMultiplier: 1.12,
      totalMultiplier: 1,
    },
  ],
  v5: [
    { afterImages: 0, baseCny: 0.04, anlasMultiplier: 1, totalMultiplier: 1 },
    {
      afterImages: 50,
      baseCny: 0.04,
      anlasMultiplier: 1,
      totalMultiplier: 1.1,
    },
    {
      afterImages: 100,
      baseCny: 0.04,
      anlasMultiplier: 1,
      totalMultiplier: 1.125,
    },
    {
      afterImages: 200,
      baseCny: 0.04,
      anlasMultiplier: 1,
      totalMultiplier: 1.2,
    },
  ],
};
export function dailyImageDay(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}
export function roundAffAmount(amount: number) {
  return Math.round((amount + Number.EPSILON) * 10_000) / 10_000;
}
export function isAffAmount(amount: number) {
  return (
    Number.isFinite(amount) &&
    Math.abs(amount * 10_000 - Math.round(amount * 10_000)) < 1e-6
  );
}
export function dailyImageFamily(
  generation: ImagePricingGeneration,
): DailyImageFamily | null {
  if (
    ![
      "generate",
      "img2img",
      "inpainting",
      "infill",
      "edits",
      "outpainting",
      "vibe-transfer",
      "character-reference",
      "precise-reference",
    ].includes(generation.operation || "generate")
  )
    return null;
  const model = naiUsageModel(generation.model);
  return model.startsWith("nai-v4.5-")
    ? "v45"
    : model.startsWith("nai-v5-")
      ? "v5"
      : null;
}
export function quoteDailyImage(
  generation: ImagePricingGeneration,
  policy: DailyImagePolicy,
  cnyPerAff: number,
  startCount: number,
  day = dailyImageDay(),
): DailyImageQuote | null {
  const family = dailyImageFamily(generation);
  if (!family || !policy.enabled) return null;
  if (
    !Number.isFinite(cnyPerAff) ||
    cnyPerAff <= 0 ||
    !Number.isInteger(startCount) ||
    startCount < 0 ||
    !Number.isInteger(generation.samples) ||
    generation.samples < 1 ||
    generation.samples > 30
  )
    throw new Error("每日计费参数无效");
  const baseAff = isNaiMediumModel(generation.model) ? MEDIUM_AFF_PER_IMAGE : family === "v5" ? V5_BASE_AFF_PER_IMAGE : 1;
  const baselineAff = affCost(generation) / generation.samples;
  const anlasAff = Math.max(0, baselineAff - baseAff);
  const anlas = anlasAff * generation.samples / (family === "v5" ? 1.25 : 1);
  const anlasPerSample = anlas / generation.samples;
  const anlasCny = family === "v45" ? policy.v45AnlasCny : policy.v5AnlasCny;
  const affCosts = Array.from({ length: generation.samples }, (_, index) => {
    const ordinal = startCount + index + 1;
    const tier =
      [...policy[family]]
        .reverse()
        .find((value) => ordinal > value.afterImages) || policy[family][0];
    const dailySurchargeCny = Math.max(0, tier.baseCny - policy[family][0].baseCny);
    return roundAffAmount(
      (baseAff + (dailySurchargeCny + anlasPerSample * anlasCny * tier.anlasMultiplier) / cnyPerAff) * tier.totalMultiplier,
    );
  });
  const cnyCosts = affCosts.map((cost) => Number((cost * cnyPerAff).toFixed(8)));
  return {
    family,
    day,
    startCount,
    samples: generation.samples,
    anlas,
    cnyPerAff,
    affCosts,
    cnyCosts,
    costAff: roundAffAmount(affCosts.reduce((sum, cost) => sum + cost, 0)),
    costCny: Number(cnyCosts.reduce((sum, cost) => sum + cost, 0).toFixed(8)),
  };
}
