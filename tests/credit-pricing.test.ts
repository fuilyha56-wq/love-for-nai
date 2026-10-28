import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_DAILY_IMAGE_POLICY, dailyImageDay } from "@/lib/daily-image-pricing";
import { quoteCredits, formatAff, type CreditPricing } from "@/lib/credit-pricing";
import { splitImageCreditCost } from "@/lib/image-pricing";
import { dailyImageBillingState, saveDailyImagePolicy } from "@/lib/daily-image-billing";
import { affStatus, refundImageCredits, trySpendImageCredits } from "@/lib/aff";
import { resetRuntimeConfigCache, updateModelBilling, updateRuntimeSettings } from "@/lib/runtime-config";
import { GET } from "@/app/api/public/credit-pricing/route";

const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
const pricing: CreditPricing = { policy: { ...DEFAULT_DAILY_IMAGE_POLICY, v5: [
  { afterImages: 0, baseCny: 0.04, anlasMultiplier: 1, totalMultiplier: 1 },
  { afterImages: 75, baseCny: 0.04, anlasMultiplier: 1, totalMultiplier: 1.1 },
  { afterImages: 125, baseCny: 0.04, anlasMultiplier: 1, totalMultiplier: 1.15 },
] }, cnyPerAff: 0.005, fixedCosts: {}, asOf: "2026-10-28T00:00:00Z" };
let directory: string;
const saved = { ...process.env };
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-credit-pricing-"));
  process.env.LFN_DATA_DIR = directory;
  process.env.LFN_AFF_GATEWAY_URL = "https://gateway.test";
  process.env.LFN_AFF_GATEWAY_TOKEN = "fixture-private-gateway-key";
  resetRuntimeConfigCache();
  await saveDailyImagePolicy(pricing.policy);
  await mkdir(path.join(directory, "aff"), { recursive: true });
  await writeFile(path.join(directory, "aff/801.json"), JSON.stringify({ balance: 100, packageBalance: 3.1234, transactions: [] }));
});
afterEach(async () => { resetRuntimeConfigCache(); process.env = { ...saved }; await rm(directory, { recursive: true, force: true }); });

describe("live local credit prices", () => {
  it("distinguishes the 5 AFF base from a 2 AFF/Anlas surcharge", () => {
    expect(quoteCredits(generation, pricing)).toMatchObject({ costAff: 5, costCny: 0.025, daily: { anlas: 0 } });
    expect(quoteCredits({ ...generation, steps: 29 }, pricing)).toMatchObject({ costAff: 65, costCny: 0.325, daily: { anlas: 30 } });
  });
  it.each(["upscale", "director-lineart", "encode-vibe"])("applies configured prices to %s outside the daily tiers and actually debits both wallets", async operation => {
    const input = { ...generation, operation };
    const preview = quoteCredits(input, pricing);
    const charge = await trySpendImageCredits(801, input, "current-price");
    expect(charge?.cost).toBe(preview.costAff);
    expect(charge?.cost).toBe(operation === "upscale" ? 2 : operation === "encode-vibe" ? 4 : 10);
    expect(charge?.dailyQuote).toBeNull();
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
    expect(charge?.personalCost).toBe(splitImageCreditCost(preview.costAff, 1, 3.1234, 10).personalCost);
    await refundImageCredits(801, charge!);
    expect(await affStatus(801)).toMatchObject({ balance: 100, packageBalance: 3.1234 });
  });
  it("keeps fractional tier prices and package splits through preview, debit and refund", async () => {
    const state = { ...await dailyImageBillingState(801), counts: { v45: 0, v5: 125 } };
    const input = { ...generation, samples: 2, sequential: true };
    const quote = quoteCredits(input, pricing, state);
    expect(quote.daily?.affCosts).toEqual([5.75, 5.75]);
    expect(quote.costAff).toBe(11.5);
    const { reserveDailyImageQuote } = await import("@/lib/daily-image-billing");
    for (let count = 0; count < 4; count++) await reserveDailyImageQuote(801, { ...generation, samples: 30, sequential: true }, `earlier-${count}`);
    await reserveDailyImageQuote(801, { ...generation, samples: 5, sequential: true }, "earlier-five");
    const charge = await trySpendImageCredits(801, input, "fractional");
    expect(charge).toMatchObject({ cost: 11.5, packageCost: 3.1234, personalCost: 8.3766 });
    expect(JSON.parse(await readFile(path.join(directory, "aff/801.json"), "utf8")).balance).toBe(91.6234);
    await refundImageCredits(801, charge!, 1);
    expect(await affStatus(801)).toMatchObject({ balance: 97.3734, packageBalance: 0 });
    expect(formatAff(5.75)).toBe("5.75");
    expect(formatAff(8.3766)).toBe("8.3766");
  });
  it("uses configured Anlas rates when daily tiers are disabled and preserves fixed overrides", async () => {
    const p = { ...pricing, policy: { ...pricing.policy, enabled: false, v5AnlasCny: 0.0075 } };
    await saveDailyImagePolicy(p.policy);
    const input = { ...generation, operation: "upscale" };
    expect(quoteCredits(input, p).costAff).toBe(1.5);
    expect((await trySpendImageCredits(801, input, "disabled"))?.cost).toBe(1.5);
    await updateModelBilling({ "nai-v5-full": { mode: "fixed", fixedCost: 0.1234 } });
    expect((await trySpendImageCredits(801, input, "override"))?.cost).toBe(0.1234);
    expect(quoteCredits(input, { ...p, fixedCosts: { "nai-v5-full": 0.1234 } }).costAff).toBe(0.1234);
  });
  it("reads public prices without a session and excludes private runtime/account fields", async () => {
    await updateRuntimeSettings({ affGatewayToken: "fixture-private-admin-value" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(Object.keys(result).sort()).toEqual(["asOf", "cnyPerAff", "fixedCosts", "policy"]);
    expect(result.policy.v5AnlasCny).toBe(0.01);
    expect(JSON.stringify(result)).not.toMatch(/private|token|userId|balance/i);
    expect(quoteCredits(generation, result, { ...await dailyImageBillingState(801), day: dailyImageDay(Date.now() - 86400_000), counts: { v45: 0, v5: 126 } }).costAff).toBe(5);
  });
});
