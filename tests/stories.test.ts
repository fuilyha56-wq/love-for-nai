import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "lfn-stories-"));
  process.env.LFN_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.LFN_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("故事存储", () => {
  it("创建、更新并隔离用户故事", async () => {
    const { createStory, listStories, updateStory } = await import("@/lib/stories");
    const created = await createStory(1, { title: "盐风港", model: "luna" });
    const updated = await updateStory(1, created.id, {
      synopsis: "一座会遗忘名字的港口。",
      branch: { id: created.activeBranchId, content: "潮声抵达窗前。" },
    });

    expect(updated.model).toBe("luna");
    expect(updated.synopsis).toContain("港口");
    expect(updated.branches[0].content).toBe("潮声抵达窗前。");
    expect(await listStories(2)).toEqual([]);
  });

  it("从当前正文复制新分支并切换为活动分支", async () => {
    const { createStory, createStoryBranch, updateStory } = await import("@/lib/stories");
    const created = await createStory(7, { title: "分岔" });
    const saved = await updateStory(7, created.id, {
      branch: { id: created.activeBranchId, content: "门后有两条路。" },
    });
    const forked = await createStoryBranch(7, saved.id, saved.activeBranchId, "推门而入");
    const branch = forked.branches.find((item) => item.id === forked.activeBranchId);

    expect(forked.branches).toHaveLength(2);
    expect(branch?.parentId).toBe(saved.activeBranchId);
    expect(branch?.content).toBe("门后有两条路。");
    expect(branch?.name).toBe("推门而入");
  });

  it("拒绝越过故事模型白名单", async () => {
    const { createStory, updateStory } = await import("@/lib/stories");
    const created = await createStory(9);
    await expect(
      updateStory(9, created.id, { model: "astra" as "sol" }),
    ).rejects.toThrow("模型只能是 sol 或 luna");
  });
});