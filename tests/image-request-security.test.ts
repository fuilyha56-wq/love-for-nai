import { describe, expect, it } from "vitest";
import {
  assertImageModel,
  normalizeDimension,
  normalizeSamples,
  normalizeSteps,
} from "@/lib/image-request";
import { externalGeneration, naiGenerationPayload } from "@/lib/compat-api";

describe("图像请求安全边界", () => {
  it("拒绝零值、负数、小数和冲突的样本参数", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => normalizeSamples({ n: value })).toThrow();
    expect(() => normalizeSamples({ n: 1, n_samples: 2 })).toThrow("必须一致");
    expect(normalizeSamples({ n: 2, n_samples: 2 })).toBe(2);
  });

  it("限制尺寸、steps 和图像模型", () => {
    expect(normalizeDimension(832, "width")).toBe(832);
    expect(() => normalizeDimension(1616, "width")).toThrow();
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
