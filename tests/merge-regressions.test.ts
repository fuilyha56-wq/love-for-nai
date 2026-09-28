import { describe, expect, it } from "vitest";
import { splitImageBatches, studioBatchSize } from "@/lib/image-batches";
import { estimateNewApiCost, snapshotFromRawPricing } from "@/lib/image-pricing";
import { inpaintModelFor } from "@/lib/inpaint-model";

describe("merged studio request/pricing contract", () => {
  const base = { model: "nai-v5-full", width: 1024, height: 1024, steps: 28 };
  const pricing = snapshotFromRawPricing(
    base.model,
    {
      quota_type: 1,
      billing_mode: "tiered_expr",
      billing_expr: 'tier("base", p * 260000 + c * 0)',
    },
    1,
    "Draw",
  );
  it.each([
    ["sequential", 2, [1, 1], 13],
    ["sequential", 3, [1, 1, 1], 19.5],
    ["sequential", 4, [1, 1, 1, 1], 26],
    ["sequential", 5, [1, 1, 1, 1, 1], 32.5],
    ["once", 4, [4], 2080],
    ["once", 5, [5], 2600],
    ["sequential", 30, Array(30).fill(1), 195],
  ] as const)("%s with %s images matches actual request chunks", (mode, samples, chunks, usd) => {
    const size = studioBatchSize(mode);
    expect(splitImageBatches(samples, size)).toEqual(chunks);
    const actual = chunks.reduce((sum, n) => {
      const cost = estimateNewApiCost(pricing, { ...base, samples: n });
      if (cost == null) throw new Error("Expected tiered pricing estimate");
      return sum + cost;
    }, 0);
    const preview = estimateNewApiCost(pricing, { ...base, samples, maxSamplesPerRequest: size });
    expect(preview).toBe(usd);
    expect(preview).toBeCloseTo(actual);
  });
});

describe("editor model family preservation", () => {
  it.each([
    ["nai-v4.5-full", "nai-v4.5-inpaint"],
    ["nai-v4.5-curated-limit", "nai-v4.5-inpaint-limit"],
    ["nai-v5-curated", "nai-v5-inpaint"],
    ["nai-v5-full-limit", "nai-v5-inpaint-limit"],
    ["nai-v3", "nai-v3-inpaint"],
    ["nai-v3-furry", "nai-v3-furry-inpaint"],
    ["nai-v3-furry-inpaint", "nai-v3-furry-inpaint"],
    ["nai-v4.5-inpaint-limit", "nai-v4.5-inpaint-limit"],
  ])("maps %s to %s", (source, expected) => {
    expect(inpaintModelFor(source)).toBe(expected);
  });
  it("does not silently switch unsupported models to V5", () => {
    expect(inpaintModelFor("nai-v4-curated")).toBeNull();
    expect(inpaintModelFor("nai-chat")).toBeNull();
  });
});
