import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { affCost, isInFreeEnvelope } from "@/lib/aff";

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
    ).toBe(false);
  });
});

describe("两档 AFF 计费", () => {
  it("档内完整版与 -limit 同价：V5 2 AFF、V4.5 1 AFF", () => {
    expect(
      affCost({ model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 }),
    ).toBe(2);
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

  it("limit 模型不受档位影响，超界仍按张数计费", () => {
    expect(
      affCost({ model: "nai-v5-full-limit", width: 1024, height: 1024, steps: 50, samples: 1 }),
    ).toBe(2);
    expect(
      affCost({ model: "nai-v4.5-full-limit", width: 832, height: 1216, steps: 28, samples: 3 }),
    ).toBe(3);
  });
});
