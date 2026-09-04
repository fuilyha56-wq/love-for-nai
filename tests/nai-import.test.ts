import { describe, expect, it } from "vitest";
import {
  mapNaiParameters,
  resolveStudioModel,
} from "@/lib/nai-import";

const studioModels = [
  "nai-v5-full",
  "nai-v5-curated",
  "nai-v5-inpaint",
  "nai-v5-full-limit",
  "nai-v5-curated-limit",
  "nai-v5-inpaint-limit",
  "nai-v4.5-full",
  "nai-v4.5-curated",
  "nai-v4.5-inpaint",
  "nai-v4.5-full-limit",
  "nai-v4.5-curated-limit",
  "nai-v4.5-inpaint-limit",
  "nai-v4-curated",
  "nai-v3",
  "nai-v3-furry",
  "nai-v3-inpaint",
  "nai-v3-furry-inpaint",
];

describe("resolveStudioModel", () => {
  it("maps NAI 原名到 LFN 模型 id", () => {
    expect(resolveStudioModel("nai-diffusion-4-5-full", studioModels)).toBe(
      "nai-v4.5-full",
    );
    expect(resolveStudioModel("nai-diffusion-5-curated", studioModels)).toBe(
      "nai-v5-curated",
    );
    expect(resolveStudioModel("nai-diffusion-furry-3", studioModels)).toBe(
      "nai-v3-furry",
    );
  });

  it("接受本来就是 LFN id 的值，忽略未知模型", () => {
    expect(resolveStudioModel("nai-v5-full", studioModels)).toBe("nai-v5-full");
    expect(resolveStudioModel("unknown-model", studioModels)).toBeUndefined();
    expect(resolveStudioModel(undefined, studioModels)).toBeUndefined();
  });

  it("别名目标不在列表时退到同代 curated", () => {
    // nai-v4-full / nai-v4-curated 不在工作台列表，v4 全量应退到 v4 curated。
    expect(resolveStudioModel("nai-diffusion-4-full", studioModels)).toBe(
      "nai-v4-curated",
    );
  });
});

describe("mapNaiParameters", () => {
  it("回填 prompt/负向/尺寸/步数/CFG/采样器与种子", () => {
    const result = mapNaiParameters(
      {
        prompt: "1girl, white hair",
        uc: "lowres",
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5,
        cfg_rescale: 0.4,
        sampler: "k_euler_ancestral",
        noise_schedule: "karras",
        seed: 1234567,
        n_samples: 2,
        strength: 0.6,
      },
      studioModels,
    );
    expect(result).toEqual({
      prompt: "1girl, white hair",
      negativePrompt: "lowres",
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5,
      cfgRescale: 0.4,
      sampler: "k_euler_ancestral",
      noiseSchedule: "karras",
      seed: "1234567",
      count: 2,
      strength: 0.6,
    });
  });

  it("尺寸吸附到 64 倍数并在超像素上限时保持比例缩放", () => {
    const aligned = mapNaiParameters(
      { width: 850, height: 1216 },
      studioModels,
    );
    expect(aligned.width).toBe(832);
    expect(aligned.height).toBe(1216);

    const oversized = mapNaiParameters(
      { width: 1600, height: 1600 },
      studioModels,
    );
    expect(oversized.width).toBeLessThanOrEqual(1600);
    expect(oversized.height).toBeLessThanOrEqual(1600);
    expect((oversized.width || 0) * (oversized.height || 0)).toBeLessThanOrEqual(
      2_560_000,
    );
    expect((oversized.width || 0) % 64).toBe(0);
    expect((oversized.height || 0) % 64).toBe(0);
  });

  it("非法/越界值与不支持的枚举被丢弃", () => {
    const result = mapNaiParameters(
      {
        width: 20,
        height: 3000,
        steps: 99,
        scale: -1,
        sampler: "ddim_v2",
        noise_schedule: "turbo",
        seed: "not-a-seed",
      },
      studioModels,
    );
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.steps).toBeUndefined();
    expect(result.scale).toBeUndefined();
    expect(result.sampler).toBeUndefined();
    expect(result.noiseSchedule).toBeUndefined();
    expect(result.seed).toBeUndefined();
  });
});
