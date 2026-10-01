import { describe, expect, it } from "vitest";
import {
  envelopeUsageTokens,
  estimateNewApiCost,
  estimatePoints,
  estimateTokens,
  pointPriceUsd,
  snapshotFromRawPricing,
  tokensToPoints,
  usesLimitPricing,
} from "@/lib/image-pricing";

const base = {
  model: "nai-v5-full",
  width: 1024,
  height: 1024,
  steps: 28,
  samples: 1,
};

const liveV5 = snapshotFromRawPricing(
  base.model,
  {
    quota_type: 1,
    billing_mode: "tiered_expr",
    billing_expr: 'tier("base", p * 260000 + c * 0)',
  },
  1,
);

describe("NewAPI image cost previews", () => {
  it("keeps the Anlas conversion separate from NewAPI usage tokens", () => {
    expect(pointPriceUsd(base.model)).toBe(0.03);
    expect(tokensToPoints(1000)).toBe(20);
    expect(tokensToPoints(51)).toBe(1.02);
    expect(estimatePoints(base)).toBe(0);
    expect(estimateTokens(base)).toBe(0);
    expect(envelopeUsageTokens(base.model)).toBe(8);
  });

  it("uses the gateway's 8-token V5 envelope marker, including the group ratio", () => {
    expect(liveV5.inEnvelopeUsd).toBe(2.08);
    expect(estimateNewApiCost(liveV5, base)).toBe(2.08);
    const halfPrice = snapshotFromRawPricing(
      base.model,
      {
        billing_mode: "tiered_expr",
        billing_expr: 'tier("base", p * 260000 + c * 0)',
      },
      0.5,
    );
    expect(estimateNewApiCost(halfPrice, base)).toBe(1.04);
    expect(estimateNewApiCost(halfPrice, { ...base, samples: 4 })).toBe(1040);
  });

  it("matches logged V5 batch charges at 1024 squared and 28 steps", () => {
    expect(estimatePoints({ ...base, samples: 4 })).toBe(160);
    expect(estimateTokens({ ...base, samples: 4 })).toBe(8000);
    expect(estimateNewApiCost(liveV5, { ...base, samples: 3 })).toBe(1560);
    expect(estimateNewApiCost(liveV5, { ...base, samples: 4 })).toBe(2080);
    expect(estimateNewApiCost(liveV5, { ...base, steps: 29 })).toBe(546);
  });

  it("prices independent n=1 requests separately from one multi-image request", () => {
    expect(estimateNewApiCost(liveV5, { ...base, samples: 3, sequential: true })).toBe(6.24);
    expect(estimateNewApiCost(liveV5, { ...base, samples: 3, maxSamplesPerRequest: 1 })).toBe(6.24);
    expect(estimateNewApiCost(liveV5, { ...base, samples: 3 })).toBe(1560);
    expect(estimateNewApiCost(liveV5, { ...base, samples: 5, maxSamplesPerRequest: 4 })).toBe(2082.08);
  });

  it("keeps text-only character prompts inside the fixed envelope", () => {
    const withCharacters = { ...base, characterPromptCount: 2 };
    expect(usesLimitPricing(withCharacters)).toBe(true);
    expect(estimatePoints(withCharacters)).toBe(0);
    expect(estimateNewApiCost(liveV5, withCharacters)).toBe(2.08);
    expect(usesLimitPricing({ ...base, hasInputImage: true })).toBe(false);
    expect(usesLimitPricing({ ...base, hasInputImage: true, operation: "img2img" })).toBe(true);
  });

  it("uses actual tier coefficients rather than a fixed local point price", () => {
    const target = snapshotFromRawPricing(
      base.model,
      {
        billing_mode: "tiered_expr",
        billing_expr: 'p < 100 ? tier("limit", p * 7500) : tier("full", p * 600)',
      },
      1,
    );
    expect(estimateNewApiCost(target, base)).toBe(0.06);
    expect(estimateNewApiCost(target, { ...base, samples: 4 })).toBe(4.8);
  });

  it("does not show a numeric quote without a matching, readable price", () => {
    expect(estimateNewApiCost(null, base)).toBeNull();
    expect(estimateNewApiCost(null, { ...base, samples: 3, sequential: true })).toBeNull();
    const unreadable = snapshotFromRawPricing(
      base.model,
      { quota_type: 1, billing_mode: "tiered_expr", billing_expr: "unknown expression" },
      1,
    );
    expect(estimateNewApiCost(unreadable, base)).toBeNull();
    expect(estimateNewApiCost({ ...liveV5, model: "nai-v4.5-full" }, base)).toBeNull();
    const missingPerRequest = snapshotFromRawPricing(base.model, { quota_type: 1 }, 1);
    const missingPerToken = snapshotFromRawPricing(base.model, {}, 1);
    expect(estimateNewApiCost(missingPerRequest, base)).toBeNull();
    expect(estimateNewApiCost(missingPerToken, base)).toBeNull();
  });

  it("retains ordinary non-tiered and non-NAI pricing paths", () => {
    const perRequest = snapshotFromRawPricing(base.model, { quota_type: 1, model_price: 2 }, 0.5);
    expect(estimateNewApiCost(perRequest, { ...base, samples: 3 })).toBe(3);
    const perToken = snapshotFromRawPricing(base.model, { model_ratio: 100000 }, 1);
    expect(estimateNewApiCost(perToken, base)).toBeCloseTo(1.6);
    const chat = snapshotFromRawPricing("nai-chat", { quota_type: 1, model_price: 2 }, 0.5);
    expect(estimateNewApiCost(chat, { ...base, model: "nai-chat", samples: 3 })).toBe(3);
    const otherImage = { ...base, model: "custom-image" };
    expect(estimateNewApiCost(null, otherImage)).toBeNull();
    expect(estimateNewApiCost(snapshotFromRawPricing(otherImage.model, { quota_type: 1 }, 1), otherImage)).toBeNull();
  });

  it("keeps V4.5 fixed-envelope usage at zero when priced by usage tokens", () => {
    const generation = { ...base, model: "nai-v4.5-full" };
    const pricing = snapshotFromRawPricing(
      generation.model,
      { billing_mode: "tiered_expr", billing_expr: 'tier("base", p * 260000 + c * 0)' },
      1,
    );
    expect(envelopeUsageTokens(generation.model)).toBe(0);
    expect(estimateNewApiCost(pricing, generation)).toBe(0);
    expect(estimatePoints({ ...generation, samples: 3 })).toBe(60);
    expect(estimateNewApiCost(pricing, { ...generation, samples: 3 })).toBe(780);
  });
});
