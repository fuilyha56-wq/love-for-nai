import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { affCost, envelopeUsageTokens, estimateNewApiCost, estimateTokens, snapshotFromRawPricing, usesLimitPricing, type ImagePricingGeneration } from "@/lib/image-pricing";

const plan = JSON.parse(readFileSync(new URL("../docs/nai-parity-pricing-proposal-2026-10-23.json", import.meta.url), "utf8")) as { models: { model: string; proposed: { billingMode: string; billingExpr: string | null; modelPrice: number } }[] };
function value(expr: string, p: number, c: number) {
  return new Function("p", "c", "tier", "return " + expr)(p, c, (_name: string, amount: number) => amount);
}

describe("NewAPI 与 LFN 首档一致", () => {
  for (const row of plan.models) {
    it(`${row.model} 固定价与大图、批量、工具精确对齐`, () => {
      const medium = row.model.endsWith("-medium");
      const limit = row.model.endsWith("-limit");
      const pricing = snapshotFromRawPricing(row.model, { billing_mode: row.proposed.billingMode, billing_expr: row.proposed.billingExpr, quota_type: 1, model_price: row.proposed.modelPrice }, 1);
      const base = { model: row.model, width: 1024, height: 1024, steps: medium ? 14 : 28, samples: 1 };
      const cases: ImagePricingGeneration[] = limit ? [base, { ...base, operation: "img2img", strength: 0.55 }] : [
        base,
        { ...base, width: 2048, height: 1536 },
        { ...base, width: 2048, height: 1536, samples: 2 },
        { ...base, width: 2048, height: 1536, operation: "img2img", strength: 0.55 },
        ...(medium ? [] : [
          { ...base, operation: "precise-reference", referenceMode: "precise" as const, referenceImageCount: 1 },
          { ...base, operation: "upscale" },
          { ...base, operation: "director-bg-remover" },
        ]),
      ];
      for (const generation of cases) {
        const expectedCny = affCost(generation) * 0.005;
        expect(estimateNewApiCost(pricing, generation)! / 200).toBeCloseTo(expectedCny, 8);
        if (row.proposed.billingExpr) {
          const p = usesLimitPricing(generation) ? Math.max(1, envelopeUsageTokens(row.model)) : estimateTokens(generation);
          const standalone = ["upscale", "director-bg-remover"].includes(generation.operation ?? "");
          const c = standalone ? 0 : generation.samples;
          const quota = Math.round(value(row.proposed.billingExpr, p, c) / 1e6 * 500000);
          expect(quota / 1e8).toBeCloseTo(expectedCny, 8);
        }
      }
      expect(estimateNewApiCost({ ...pricing, groupRatio: 0, inEnvelopeUsd: 0, outOfEnvelopeBalancePerUsageToken: 0, outOfEnvelopeBaseBalancePerImage: 0 }, base)).toBe(0);
    });
  }
});
