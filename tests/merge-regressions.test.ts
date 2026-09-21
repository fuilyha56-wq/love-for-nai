import { describe, expect, it } from "vitest";
import { splitImageBatches, studioBatchSize } from "@/lib/image-batches";
import { estimateNewApiCost } from "@/lib/image-pricing";
import { inpaintModelFor } from "@/lib/inpaint-model";

describe("merged studio request/pricing contract", () => {
  const base = { model: "nai-v5-full", width: 1024, height: 1024, steps: 28 };
  it.each([
    ["sequential", 3, [3], 3.6],
    ["sequential", 5, [4, 1], 4.86],
    ["once", 5, [5], 6],
    ["once", 9, [8, 1], 9.66],
    ["sequential", 30, [4, 4, 4, 4, 4, 4, 4, 2], 36],
  ] as const)("%s with %s images matches actual request chunks", (mode, samples, chunks, usd) => {
    const size = studioBatchSize(mode);
    expect(splitImageBatches(samples, size)).toEqual(chunks);
    const actual = chunks.reduce((sum, n) => sum + estimateNewApiCost(null, { ...base, samples: n }), 0);
    const preview = estimateNewApiCost(null, { ...base, samples, maxSamplesPerRequest: size });
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
