import { describe, expect, it } from "vitest";
import { isNaiMediumModel, naiNativeGenerationBody, naiUpstreamModel } from "@/lib/nai-native-request";
import { officialNaiAnlasCost, MEDIUM_ANLAS_RATIO, estimateNewApiCost, snapshotFromRawPricing } from "@/lib/image-pricing";

describe("NAI V5 Medium 模型", () => {
  it("matches the official calculator and separately prices NewAPI requests", () => {
    const base = { model: "nai-v5-full", width: 1024, height: 1024, steps: 23, samples: 1 };
    expect(officialNaiAnlasCost(base)).toBe(26);
    expect(officialNaiAnlasCost({ ...base, model: "nai-v5-full-medium", steps: 14 })).toBe(18);
    expect(officialNaiAnlasCost({ ...base, samples: 2 })).toBe(52);
    expect(officialNaiAnlasCost(base, true)).toBe(0);
    const medium = { ...base, model: "nai-v5-full-medium", steps: 14 };
    const price = snapshotFromRawPricing(medium.model, { quota_type: 1, model_price: 5 * MEDIUM_ANLAS_RATIO }, 1);
    expect(estimateNewApiCost(price, medium)).toBeCloseTo(3.46153846);
  });

  it("maps to the official Medium upstream models", () => {
    expect(naiUpstreamModel("nai-v5-full-medium")).toBe("nai-diffusion-5-full-medium");
    expect(naiUpstreamModel("nai-v5-inpaint-medium")).toBe("nai-diffusion-5-full-medium-inpainting");
    expect(isNaiMediumModel("nai-v5-full-medium")).toBe(true);
  });

  it("forces the official Medium generation settings", () => {
    const body = naiNativeGenerationBody({
      model: "nai-v5-full-medium",
      prompt: "1girl",
      negative_prompt: "custom negative",
      steps: 28,
      sampler: "k_euler",
      cfg_rescale: 0.5,
    });
    expect(body.model).toBe("nai-diffusion-5-full-medium");
    expect(body.parameters).toMatchObject({
      steps: 14,
      sampler: "k_euler_ancestral",
      cfg_rescale: 0,
      tag_hint_uc_preset: 2,
    });
  });

  it("uses the Medium inpainting model for infill", () => {
    const body = naiNativeGenerationBody({
      model: "nai-v5-full-medium",
      operation: "inpainting",
      prompt: "repair",
    });
    expect(body.model).toBe("nai-diffusion-5-full-medium-inpainting");
  });
});