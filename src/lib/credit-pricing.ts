import { dailyImageDay, dailyImageFamily, quoteDailyImage, roundAffAmount, type DailyImageBillingState, type DailyImagePolicy } from "./daily-image-pricing";
import { CNY_PER_AFF, imageCreditCost, type ImagePricingGeneration } from "./image-pricing";

export type CreditPricing = { policy: DailyImagePolicy; cnyPerAff: number; fixedCosts: Record<string, number>; asOf: string };

export function formatAff(value: number) {
  return Number.isFinite(value) ? roundAffAmount(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 }) : "--";
}
export function formatCny(value: number) {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 8 }) : "--";
}
export function quoteCredits(generation: ImagePricingGeneration, pricing: CreditPricing, state?: DailyImageBillingState) {
  const fixed = pricing.fixedCosts[generation.model] ?? null;
  const family = dailyImageFamily(generation);
  const count = family && state?.day === dailyImageDay() ? state.counts[family] : 0;
  const daily = fixed == null ? quoteDailyImage(generation, pricing.policy, CNY_PER_AFF, count) : null;
  const costAff = daily?.costAff ?? imageCreditCost(generation, fixed, pricing.policy);
  return { daily, costAff, costCny: Number((costAff * CNY_PER_AFF).toFixed(8)), fixed };
}
