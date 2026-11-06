import { dailyImageDay, dailyImageFamily, quoteDailyImage, roundAffAmount, type DailyImageBillingState, type DailyImagePolicy } from "./daily-image-pricing";
import { imageCreditCost, type ImagePricingGeneration } from "./image-pricing";

export type CreditPricing = { policy: DailyImagePolicy; cnyPerAff: number; fixedCosts: Record<string, number>; asOf: string };

export function formatAff(value: number) {
  return Number.isFinite(value) ? roundAffAmount(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 }) : "--";
}
export function formatCny(value: number) {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 8 }) : "--";
}
export function formatNewApiQuote(value: number) {
  return Number.isFinite(value)
    ? "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8, useGrouping: false })
    : "--";
}
export function quoteCredits(generation: ImagePricingGeneration, pricing: CreditPricing, state?: DailyImageBillingState) {
  const fixed = pricing.fixedCosts[generation.model] ?? null;
  const family = dailyImageFamily(generation);
  const count = family && state?.day === dailyImageDay() ? state.counts[family] : 0;
  const daily = fixed == null ? quoteDailyImage(generation, pricing.policy, pricing.cnyPerAff, count) : null;
  const costAff = daily?.costAff ?? imageCreditCost(generation, fixed, pricing.policy);
  return { daily, costAff, costCny: Number((costAff * pricing.cnyPerAff).toFixed(8)), fixed };
}
