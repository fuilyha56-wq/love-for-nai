import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { affCost, isInFreeEnvelope } from "@/lib/aff";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lfn-charprompts-"));
  process.env.LFN_DATA_DIR = dataDir;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.LFN_DATA_DIR;
});

describe("多角色与档内判定", () => {
  it("纯文字 characterPrompts 不会让文生图掉出免费档", () => {
    expect(
      isInFreeEnvelope({
        model: "nai-v5-full",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
        characterPromptCount: 2,
      }),
    ).toBe(true);
    expect(
      isInFreeEnvelope({
        model: "nai-v5-full",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
        characterPromptCount: 0,
      }),
    ).toBe(true);
  });

  it("纯文字角色和普通文生图都按档内价格计费", () => {
    const withCharacters = affCost({
      model: "nai-v5-full",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 1,
      characterPromptCount: 2,
    });
    const withoutCharacters = affCost({
      model: "nai-v5-full",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 1,
    });

    expect(withoutCharacters).toBe(5);
    expect(withCharacters).toBe(5);
  });

  it("-limit 模型带角色仍按张数计费（位置坐标不影响 limit 价格）", () => {
    expect(
      affCost({
        model: "nai-v5-full-limit",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
        characterPromptCount: 3,
      }),
    ).toBe(5);
  });
});

describe("历史角色参数保存", () => {
  it("保留角色文字与坐标，但排除角色附带图片结构", async () => {
    const { saveHistory, listHistory } = await import("@/lib/history");
    await mkdir(path.join(dataDir, "history", "950"), { recursive: true });
    const items = await saveHistory(
      950,
      {
        model: "nai-v5-full",
        prompt: "scene",
        width: 832,
        height: 1216,
        characterPrompts: [
          { prompt: "1girl", negativePrompt: "hat", center: { x: 0.3, y: 0.5 }, image: "private-image" },
        ],
      },
      ["data:image/png;base64,aaaa"],
      {},
    );

    expect(items).toHaveLength(1);
    expect(items[0].parameters.characterPrompts).toEqual([{ prompt: "1girl", negativePrompt: "hat", center: { x: .3, y: .5 } }]);
    expect(items[0].parameters.prompt).toBe("scene");
    const listed = await listHistory(950);
    expect(listed[0].parameters.characterPrompts).toEqual(items[0].parameters.characterPrompts);
    expect(JSON.stringify(listed[0].parameters)).not.toContain("private-image");
    await rm(path.join(dataDir, "history", "950"), {
      recursive: true,
      force: true,
    });
  });
});
