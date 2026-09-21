import { describe, expect, it } from "vitest";
import {
  estimateNewApiCost,
  estimatePoints,
  estimateTokens,
  pointPriceUsd,
  snapshotFromRawPricing,
  tokensToPoints,
  usesLimitPricing,
} from "@/lib/image-pricing";

const base = {
  model: "nai-v4.5-full",
  width: 1024,
  height: 1024,
  steps: 28,
  samples: 1,
};

describe("NewAPI USD estimates using gateway Anlas", () => {
  it("uses $0.03 per Anlas for both versions without rounding token fractions", () => {
    expect(pointPriceUsd(base.model)).toBe(0.03);
    expect(pointPriceUsd("nai-v5-full")).toBe(0.03);
    expect(pointPriceUsd("nai-chat")).toBeNull();
    expect(tokensToPoints(1000)).toBe(20);
    expect(tokensToPoints(51)).toBe(1.02);
  });
  it("charges fixed limit prices without interpreting the 8-token marker as Anlas", () => {
    for (const suffix of ["", "-limit"]) {
      expect(
        estimateNewApiCost(null, { ...base, model: `nai-v4.5-full${suffix}` }),
      ).toBe(0);
      const v5 = { ...base, model: `nai-v5-full${suffix}` };
      expect(estimateNewApiCost(null, v5)).toBe(0.06);
      expect(estimateNewApiCost(null, v5) * 500_000).toBe(30_000);
      expect(estimatePoints(v5)).toBe(0);
    }
  });
  it("matches gateway examples: 1024 squared, 29 steps = 21 Anlas, V5 = 42", () => {
    const full = { ...base, steps: 29 };
    expect(estimatePoints(full)).toBe(21);
    expect(estimateTokens(full)).toBe(1050);
    expect(estimateNewApiCost(null, full)).toBe(0.63);
    expect(estimatePoints({ ...full, model: "nai-v5-full" })).toBe(42);
    expect(estimateNewApiCost(null, { ...full, model: "nai-v5-full" })).toBe(
      1.26,
    );
    expect(estimateNewApiCost(null, { ...base, samples: 2 })).toBe(1.2);
  });
  it("prices sequential n=1 requests separately from one multi-image request", () => {
    expect(
      estimateNewApiCost(null, {
        ...base,
        model: "nai-v5-full",
        samples: 3,
        sequential: true,
      }),
    ).toBe(0.18);
    expect(
      estimateNewApiCost(null, { ...base, samples: 3, sequential: true }),
    ).toBe(0);
    expect(
      estimateNewApiCost(null, { ...base, model: "nai-v5-full", samples: 3 }),
    ).toBe(3.6);
    expect(
      estimateNewApiCost(null, { ...base, operation: "director-bg-remover" }),
    ).toBe(1.95);
  });
  it("matches operate route splitting five images into four plus one", () => {
    expect(
      estimateNewApiCost(null, {
        ...base,
        model: "nai-v5-full",
        samples: 5,
        maxSamplesPerRequest: 4,
      }),
    ).toBe(4.86);
  });
  it("accounts for strength, raw/encoded vibes, precise references and priority", () => {
    expect(
      estimatePoints({
        ...base,
        steps: 29,
        strength: 0.5,
        operation: "img2img",
      }),
    ).toBe(11);
    expect(estimatePoints({ ...base, referenceImageCount: 5 })).toBe(32);
    expect(
      usesLimitPricing({
        ...base,
        referenceImageCount: 5,
        encodedVibeCount: 5,
      }),
    ).toBe(true);
    expect(
      estimatePoints({
        ...base,
        operation: "precise-reference",
        referenceImageCount: 2,
        samples: 2,
      }),
    ).toBe(60);
    expect(usesLimitPricing({ ...base, characterPromptCount: 2 })).toBe(true);
    expect(estimatePoints({ ...base, serviceTier: "priority" })).toBe(20);
    expect(usesLimitPricing({ ...base, hasInputImage: true })).toBe(false);
    expect(
      usesLimitPricing({ ...base, hasInputImage: true, operation: "img2img" }),
    ).toBe(true);
  });
  it("prices Director tools independently of canvas dimensions", () => {
    expect(estimateNewApiCost(null, { ...base, operation: "declutter" })).toBe(
      0.15,
    );
    expect(estimateNewApiCost(null, { ...base, operation: "bg-removal" })).toBe(
      1.95,
    );
    expect(estimateNewApiCost(null, { ...base, operation: "upscale" })).toBe(
      0.03,
    );
  });
  it("keeps actual upstream prices separate from the requested policy", () => {
    const snapshot = snapshotFromRawPricing(
      "nai-v5-full",
      {
        billing_mode: "tiered_expr",
        billing_expr: 'tier("base", p * 240000 + c * 0)',
      },
      1,
    );
    expect(snapshot.inEnvelopeUsd).toBe(1.92);
    expect(snapshot.outOfEnvelopeBalancePerUsageToken).toBe(0.24);
    expect(
      estimateNewApiCost(snapshot, { ...base, model: "nai-v5-full" }),
    ).toBe(0.06);
    const target = snapshotFromRawPricing(
      "nai-v5-full",
      {
        billing_mode: "tiered_expr",
        billing_expr:
          'p < 100 ? tier("limit", p * 7500) : tier("full", p * 600)',
      },
      1,
    );
    expect(target.inEnvelopeUsd).toBe(0.06);
    expect(target.outOfEnvelopeBalancePerUsageToken! * 50).toBeCloseTo(0.03);
  });
});
