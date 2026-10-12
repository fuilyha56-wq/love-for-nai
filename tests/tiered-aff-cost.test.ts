import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { affCost, isInFreeEnvelope } from "@/lib/aff";
import { gatewayAnlasCost, imageCreditCost } from "@/lib/image-pricing";

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
  it("charges Medium one integer AFF per independently submitted image", () => {
    expect(affCost({ model: "nai-v5-full-medium", width: 1024, height: 1024, steps: 14, samples: 1 })).toBe(1);
    expect(affCost({ model: "nai-v5-inpaint-medium", width: 512, height: 512, steps: 14, samples: 1, operation: "inpainting" })).toBe(1);
  });
  it("档内完整版与 -limit 同价：V5 1.5 AFF、V4.5 1 AFF", () => {
    expect(
      affCost({ model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 }),
    ).toBe(1.5);
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
    expect(outOfEnvelope).toBe(40);
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
    expect(gatewayAnlasCost(generation)).toBe(100);
    expect(affCost(generation)).toBe(100);
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
    expect(gatewayAnlasCost(generation)).toBe(80);
    expect(affCost(generation)).toBe(80);
  });

  it("图生图缺省强度按 0.7 本地计算，文生图带源图退出档内", () => {
    const base = { model: "nai-v5-full", width: 832, height: 1216, steps: 29, samples: 1 };
    expect(affCost({ ...base, operation: "img2img" })).toBe(28);
    expect(gatewayAnlasCost({ ...base, operation: "img2img" })).toBe(28);
    expect(affCost({ ...base, operation: "img2img", strength: 1 })).toBe(40);
    expect(affCost({ ...base, steps: 28, hasInputImage: true })).toBe(40);
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
    expect(gatewayAnlasCost({ ...generation, encodedVibeCount: 5 })).toBe(20);
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
    expect(affCost({ ...generation, sequential: true })).toBe(66);
    expect(affCost(generation)).toBe(62);
  });

  it("limit 超界不产生低价账单，独立单张按合法档内价收费", () => {
    expect(isInFreeEnvelope({ model: "nai-v5-full-limit", width: 1024, height: 1024, steps: 50, samples: 1 })).toBe(false);
    expect(isInFreeEnvelope({ model: "nai-v4.5-full-limit", width: 832, height: 1216, steps: 28, samples: 3 })).toBe(false);
    expect(affCost({ model: "nai-v5-full-limit", width: 832, height: 1216, steps: 28, samples: 3, sequential: true })).toBe(4.5);
  });

  it("Director 使用固定价，固定模型单价与预估共享半点取整", () => {
    const base = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
    expect(affCost({ ...base, operation: "director-lineart" })).toBe(5);
    expect(affCost({ ...base, operation: "director-bg-remover" })).toBe(65);
    expect(imageCreditCost(base, 2.49)).toBe(2);
    expect(imageCreditCost({ ...base, samples: 3 }, 2.5)).toBe(7.5);
    expect(imageCreditCost(base, 2.51)).toBe(3);
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
    ).toBe(4);
    // V5 扩散超分按输入面积档位计费（与 NAI 实扣 Anlas 1:1），见 docs/SUPER_RESOLUTION.md。
    expect(
      affCost({
        model: "nai-diffusion-5-curated",
        width: 1024,
        height: 1024,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toBe(1);
    expect(
      affCost({
        model: "nai-diffusion-5-curated",
        width: 1024,
        height: 1536,
        steps: 1,
        samples: 1,
        operation: "upscale",
      }),
    ).toBe(2);
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
