import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 公告存取走 LFN_DATA_DIR，测试用临时目录隔离。
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "lfn-ann-"));
  process.env.LFN_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.LFN_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("公告库", () => {
  it("首次读取时播种教程公告，且置顶排序在前", async () => {
    const { listAnnouncements } = await import("@/lib/announcements");
    const items = await listAnnouncements();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].pinned).toBe(true);
    expect(items[0].content).toContain("/ai/generate-image");
  });

  it("创建、更新、删除公告", async () => {
    const { createAnnouncement, updateAnnouncement, deleteAnnouncement, listAnnouncements } =
      await import("@/lib/announcements");
    const created = await createAnnouncement({
      title: "测试公告",
      content: "## 内容",
      level: "info",
      author: "admin",
      pinned: false,
    });
    expect(created.id).toBeTruthy();

    const updated = await updateAnnouncement(created.id, { title: "改过的标题", pinned: true });
    expect(updated?.title).toBe("改过的标题");
    expect(updated?.pinned).toBe(true);

    const list = await listAnnouncements();
    expect(list.some((item) => item.id === created.id)).toBe(true);

    expect(await deleteAnnouncement(created.id)).toBe(true);
    expect(await deleteAnnouncement(created.id)).toBe(false);
  });
});
