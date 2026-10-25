import { describe, expect, it } from "vitest";
import {
  assertImageModel,
  normalizeDimension,
  normalizeSamples,
  normalizeSteps,
  validateMediumRequest,
  validateNaiModelSize,
} from "@/lib/image-request";
import { externalGeneration, naiGenerationPayload } from "@/lib/compat-api";

describe("图像请求安全边界", () => {
  it("rejects invalid Medium settings before billing", () => {
    const body = { width: 512, height: 512, steps: 14, n: 1 };
    expect(() => validateMediumRequest("nai-v5-full-medium", body)).not.toThrow();
    expect(() => validateMediumRequest("nai-v5-full-medium", { ...body, cfg_rescale: 0 })).not.toThrow();
    for (const override of [{ steps: 28 }, { width: 2048, height: 2048 }, { sampler: "k_euler" }, { negative_prompt: "custom" }, { reference_image: "data" }, { extra_params: { steps: 28 } }, { cfg_rescale: 0.2 }, { ucPreset: 1 }]) {
      expect(() => validateMediumRequest("nai-v5-full-medium", { ...body, ...override })).toThrow();
      try {
        validateMediumRequest("nai-v5-full-medium", { ...body, ...override });
      } catch (error) {
        expect(error).toMatchObject({ code: "lfn_medium_unsupported_parameter" });
      }
    }
    expect(() => validateMediumRequest("nai-v5-full-medium", { width: 2048, height: 1536, steps: 14, n: 2 })).not.toThrow();
    expect(assertImageModel("nai-v5-full-medium")).toBe("nai-v5-full-medium");
    expect(() => assertImageModel("nai-v4.5-full-medium")).toThrow();
    expect(() => assertImageModel("nai-v5-curated-medium")).toThrow();
  });
  it("defaults native Medium requests to 14 steps and rejects nested negative prompts", () => {
    const body = { model: "nai-diffusion-5-full-medium", input: "landscape", parameters: { width: 512, height: 512 } };
    expect(naiGenerationPayload(body)).toMatchObject({ model: "nai-v5-full-medium", steps: 14 });
    expect(() => naiGenerationPayload({ ...body, parameters: { ...body.parameters, v4_negative_prompt: { caption: { char_captions: [{ char_caption: "custom" }] } } } })).toThrow("负面词");
    expect(() => validateMediumRequest("nai-v5-full-medium", { width: 512, height: 512 }, "upscale")).toThrow();
  });
  it("拒绝零值、负数、小数和冲突的样本参数", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => normalizeSamples({ n: value })).toThrow();
    expect(() => normalizeSamples({ n: 1, n_samples: 2 })).toThrow("必须一致");
    expect(normalizeSamples({ n: 2, n_samples: 2 })).toBe(2);
  });

  it("限制尺寸、steps 和图像模型", () => {
    expect(normalizeDimension(832, "width")).toBe(832);
    expect(normalizeDimension(2048, "width")).toBe(2048);
    expect(() => validateNaiModelSize("nai-v5-full", 1616, 512)).toThrow();
    expect(() => normalizeSteps(51)).toThrow();
    expect(assertImageModel("nai-v5-full")).toBe("nai-v5-full");
    expect(() => assertImageModel("nai-chat")).toThrow();
    expect(() => assertImageModel("openai-secret")).toThrow();
  });

  it("固定编辑操作且拒绝原生参数中的不一致张数", () => {
    expect(
      externalGeneration(
        {
          model: "nai-v4.5-inpaint",
          size: "832x1216",
          n: 1,
          n_samples: 2,
          novelai_operation: "generate",
        },
        "edits",
      ),
    ).toBeNull();
    expect(() =>
      naiGenerationPayload({
        model: "nai-diffusion-4-5-full",
        input: "1girl",
        parameters: { width: 832, height: 1216, n: 1, n_samples: 2 },
      }),
    ).toThrow("必须一致");
    expect(
      externalGeneration(
        {
          model: "nai-v4.5-inpaint",
          size: "832x1216",
          n: 1,
          novelai_operation: "generate",
        },
        "edits",
      )?.operation,
    ).toBe("edits");
    expect(
      naiGenerationPayload({
        model: "nai-diffusion-4-5-full",
        input: "1girl",
        parameters: { width: 832, height: 1216, n: 2, steps: 28 },
      }),
    ).toMatchObject({
      model: "nai-v4.5-full",
      n: 2,
      n_samples: 2,
      steps: 28,
      size: "832x1216",
    });
    expect(
      externalGeneration({
        model: "nai-diffusion-5-full",
        size: "832x1216",
        n: 1,
      })?.model,
    ).toBe("nai-v5-full");
  });
});
