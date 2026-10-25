import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { affCost, isInFreeEnvelope } from "@/lib/aff";
import { gatewayAnlasCost, imageCreditCost } from "@/lib/image-pricing";
import { CNY_PER_AFF, DEFAULT_DAILY_IMAGE_POLICY, quoteDailyImage } from "@/lib/daily-image-pricing";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lfn-tiered-"));
  process.env.LFN_DATA_DIR = dataDir;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.LFN_DATA_DIR;
});

describe("两档计费档内判定", () => {
  it("n=1、steps≤28、≤1024×1024、纯文生图视为档内", () => {
    expect(
      isInFreeEnvelope({ model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 }),
    ).toBe(true);
    expect(
      isInFreeEnvelope({ model: "nai-v4.5-full", width: 1024, height: 1024, steps: 28, samples: 1 }),
    ).toBe(true);
  });

  it("多张、高步数、超边界、带参考图都掉出档内", () => {
    expect(
      isInFreeEnvelope({ model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 2 }),
    ).toBe(false);
    expect(
      isInFreeEnvelope({ model: "nai-v5-full", width: 832, height: 1216, steps: 29, samples: 1 }),
    ).toBe(false);
    expect(
      isInFreeEnvelope({ model: "nai-v5-full", width: 1088, height: 1024, steps: 28, samples: 1 }),
    ).toBe(false);
    expect(
      isInFreeEnvelope({
        model: "nai-v5-full",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
        referenceImageCount: 1,
      }),
    ).toBe(false);
    expect(
      isInFreeEnvelope({
        model: "nai-v5-full",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
        operation: "img2img",
      }),
    ).toBe(true);
    expect(
      isInFreeEnvelope({
        model: "nai-v5-inpaint",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
        operation: "outpainting",
      }),
    ).toBe(true);
  });
});

describe("两档 AFF 计费", () => {
  it("档内基础 AFF 不随图包兑换比例变化，人民币展示与扣款等值", () => {
    const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
    for (const cnyPerAff of [0.0025, 0.01]) {
      expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, cnyPerAff, 0)).toMatchObject({ costAff: 5, costCny: 5 * cnyPerAff });
      expect(quoteDailyImage({ ...generation, model: "nai-v4.5-full" }, DEFAULT_DAILY_IMAGE_POLICY, cnyPerAff, 0)).toMatchObject({ costAff: 1, costCny: cnyPerAff });
    }
  });

  it("V5 第 51/101/201 张基础价分别应用 1.1/1.125/1.2 倍率", () => {
    const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
    for (const [startCount, expected] of [[49, 5], [50, 5.5], [100, 5.625], [200, 6]]) {
      expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, 0.0025, startCount)?.costAff).toBe(expected);
    }
  });

  it("V5 High 所有变体基础 5 AFF，Medium 保持 1 AFF", () => {
    const generation = { width: 832, height: 1216, steps: 28, samples: 1 };
    for (const model of ["nai-v5-full", "nai-v5-curated", "nai-v5-inpaint", "nai-v5-full-limit"]) {
      expect(affCost({ ...generation, model })).toBe(5);
      expect(quoteDailyImage({ ...generation, model }, DEFAULT_DAILY_IMAGE_POLICY, 0.005, 0)).toMatchObject({ anlas: 0, costAff: 5, costCny: 0.025 });
    }
    expect(quoteDailyImage({ ...generation, model: "nai-v5-full-medium", steps: 14 }, DEFAULT_DAILY_IMAGE_POLICY, 0.005, 0)?.costAff).toBe(1);
  });

  it("线上 75/125/200 张阶梯按 5 AFF 基础价逐张计费", () => {
    const policy = {
      ...DEFAULT_DAILY_IMAGE_POLICY,
      v5: [
        { afterImages: 0, baseCny: 0.04, anlasMultiplier: 1, totalMultiplier: 1 },
        { afterImages: 75, baseCny: 0.04, anlasMultiplier: 1.1, totalMultiplier: 1.1 },
        { afterImages: 125, baseCny: 0.04, anlasMultiplier: 1.15, totalMultiplier: 1.15 },
        { afterImages: 200, baseCny: 0.04, anlasMultiplier: 1.2, totalMultiplier: 1.2 },
      ],
    };
    const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
    for (const [startCount, expected] of [[0, 5], [74, 5], [75, 5.5], [124, 5.5], [125, 5.75], [199, 5.75], [200, 6]]) {
      expect(quoteDailyImage(generation, policy, CNY_PER_AFF, startCount)?.costAff).toBe(expected);
    }
    expect(quoteDailyImage({ ...generation, samples: 3, sequential: true }, policy, CNY_PER_AFF, 74)?.affCosts).toEqual([5, 5.5, 5.5]);
    expect(quoteDailyImage({ ...generation, model: "nai-v5-full-medium", steps: 14 }, policy, CNY_PER_AFF, 0)?.costAff).toBe(1);
  });

  it("超范围 Anlas 按人民币换算，V5 单价为 V4.5 的 1.25 倍", () => {
    const generation = { model: "nai-v4.5-full", width: 832, height: 1216, steps: 29, samples: 1 };
    expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, CNY_PER_AFF, 0)).toMatchObject({ anlas: 20, costAff: 81, costCny: 0.405 });
    expect(quoteDailyImage({ ...generation, model: "nai-v5-full" }, DEFAULT_DAILY_IMAGE_POLICY, CNY_PER_AFF, 0)).toMatchObject({ anlas: 30, costAff: 155, costCny: 0.775 });
    expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, CNY_PER_AFF, 100)?.costAff).toBe(91);
    expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, CNY_PER_AFF, 200)?.costAff).toBe(92.8);
  });

  it("V4.5 LFN 阶梯在第 101/201 张添加人民币等值附加费", () => {
    const generation = { model: "nai-v4.5-full", width: 832, height: 1216, steps: 28, samples: 1 };
    for (const [startCount, expected] of [[99, 1], [100, 3], [199, 3], [200, 3.2]]) {
      expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, CNY_PER_AFF, startCount)?.costAff).toBe(expected);
    }
  });

  it("V5 LFN 阶梯同时提高基础 AFF 和人民币换算的 Anlas 部分", () => {
    const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 29, samples: 1 };
    for (const [startCount, expected] of [[49, 155], [50, 170.5], [100, 174.375], [200, 186]]) {
      expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, CNY_PER_AFF, startCount)?.costAff).toBe(expected);
    }
  });

  it("charges Medium one integer AFF per independently submitted image", () => {
    expect(affCost({ model: "nai-v5-full-medium", width: 1024, height: 1024, steps: 14, samples: 1 })).toBe(1);
    expect(affCost({ model: "nai-v5-inpaint-medium", width: 512, height: 512, steps: 14, samples: 1, operation: "inpainting" })).toBe(1);
  });
  it("档内完整版与 -limit 同价：V5 5 AFF、V4.5 1 AFF", () => {
    expect(
      affCost({ model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 }),
    ).toBe(5);
    expect(
      affCost({ model: "nai-v4.5-full", width: 832, height: 1216, steps: 28, samples: 1 }),
    ).toBe(1);
  });

  it("档外保持 Anlas 动态公式（steps29 的 V5 明显高于档内）", () => {
    const inEnvelope = affCost({
      model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1,
    });
    const outOfEnvelope = affCost({
      model: "nai-v5-full", width: 832, height: 1216, steps: 29, samples: 1,
    });
    expect(outOfEnvelope).toBeGreaterThan(inEnvelope);
    expect(outOfEnvelope).toBe(155);
  });

  it("precise-reference 同步收取 Gateway 每参考图每样本 5 Anlas", () => {
    const generation = {
      model: "nai-v5-full",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 2,
      operation: "precise-reference",
      referenceImageCount: 1,
    };
    expect(gatewayAnlasCost(generation)).toBe(70);
    expect(affCost(generation)).toBe(360);
  });

  it("uncond_scale 同时进入 Gateway 对照值和 AFF 实际扣款", () => {
    const generation = {
      model: "nai-v5-full",
      width: 832,
      height: 1216,
      steps: 29,
      samples: 1,
      uncondScale: 2,
    };
    expect(gatewayAnlasCost(generation)).toBe(60);
    expect(affCost(generation)).toBe(305);
  });

  it("图生图缺省强度按 0.7 本地计算，文生图带源图退出档内", () => {
    const base = { model: "nai-v5-full", width: 832, height: 1216, steps: 29, samples: 1 };
    expect(affCost({ ...base, operation: "img2img" })).toBe(110);
    expect(gatewayAnlasCost({ ...base, operation: "img2img" })).toBe(21);
    expect(affCost({ ...base, operation: "img2img", strength: 1 })).toBe(155);
    expect(affCost({ ...base, steps: 28, hasInputImage: true })).toBe(155);
  });

  it("未编码 Vibe 按首次编码价计费，编码复用不重复收取", () => {
    const generation = {
      model: "nai-v4.5-full",
      width: 832,
      height: 1216,
      steps: 29,
      samples: 1,
      operation: "vibe-transfer",
      referenceImageCount: 5,
    };
    expect(gatewayAnlasCost(generation)).toBe(32);
    expect(gatewayAnlasCost({ ...generation, encodedVibeCount: 5 })).toBe(22);
  });

  it("顺序分批的 Vibe 每个独立请求计一次参考编码，一次性请求只计一次", () => {
    const generation = {
      model: "nai-v4.5-full",
      width: 832,
      height: 1216,
      steps: 29,
      samples: 3,
      operation: "vibe-transfer",
      referenceImageCount: 1,
    };
    expect(affCost({ ...generation, sequential: true })).toBe(267);
    expect(affCost(generation)).toBe(251);
  });

  it("limit 超界不产生低价账单，独立单张按合法档内价收费", () => {
    expect(isInFreeEnvelope({ model: "nai-v5-full-limit", width: 1024, height: 1024, steps: 50, samples: 1 })).toBe(false);
    expect(isInFreeEnvelope({ model: "nai-v4.5-full-limit", width: 832, height: 1216, steps: 28, samples: 3 })).toBe(false);
    expect(affCost({ model: "nai-v5-full-limit", width: 832, height: 1216, steps: 28, samples: 3, sequential: true })).toBe(15);
  });

  it("Director 使用固定价，固定模型单价保持配置精度", () => {
    const base = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
    expect(affCost({ ...base, operation: "director-lineart" })).toBe(25);
    expect(affCost({ ...base, operation: "director-bg-remover" })).toBe(325);
    expect(imageCreditCost(base, 2.49)).toBe(2.49);
    expect(imageCreditCost({ ...base, samples: 3 }, 2.5)).toBe(7.5);
    expect(imageCreditCost(base, 2.51)).toBe(2.51);
  });

  it("encode-vibe / upscale / annotate 按固定操作计费", () => {
    expect(
      affCost({
        model: "nai-v4.5-full",
        width: 512,
        height: 512,
        steps: 1,
        samples: 1,
        operation: "encode-vibe",
        referenceImageCount: 2,
      }),
    ).toBe(16);
    // V5 扩散超分按输入面积档位计费（官方 Anlas 乘 V5 销售单价 5 AFF），见 docs/SUPER_RESOLUTION.md。
    expect(
      affCost({
        model: "nai-diffusion-5-curated",
        width: 1024,
        height: 1024,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toBe(5);
    expect(
      affCost({
        model: "nai-diffusion-5-curated",
        width: 1024,
        height: 1536,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toBe(10);
    expect(
      affCost({
        model: "hed",
        width: 1024,
        height: 1024,
        steps: 1,
        samples: 1,
        operation: "annotate",
      }),
    ).toBe(1);
  });
});
