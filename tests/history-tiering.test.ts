import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 远程存储走 fetch，测试用 fetch mock 模拟一个内存对象存储。
const remoteObjects = new Map<string, Buffer>();
const putRemote = vi.fn(async (userId: number, fileName: string) => {
  const key = `${userId}/${fileName}`;
  const local = path.join(
    process.env.LFN_DATA_DIR || "",
    "history",
    String(userId),
    fileName,
  );
  remoteObjects.set(key, await readFile(local));
  return true;
});
const deleteRemote = vi.fn(async (userId: number, fileName: string) => {
  remoteObjects.delete(`${userId}/${fileName}`);
  return true;
});
vi.mock("@/lib/remote-history", () => ({
  putRemoteHistoryImage: putRemote,
  getRemoteHistoryImage: vi.fn(),
  deleteRemoteHistoryImage: deleteRemote,
}));

let dataDir: string;
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "lfn-hist-"));
  process.env.LFN_DATA_DIR = dataDir;
  remoteObjects.clear();
  putRemote.mockClear();
  deleteRemote.mockClear();
});

afterEach(async () => {
  delete process.env.LFN_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

function body() {
  return { operation: "generate", prompt: "test", width: 64, height: 64 };
}

describe("历史分层保留", () => {
  it("前 40 张全部留在本地磁盘", async () => {
    const { saveHistory, listHistory } = await import("@/lib/history");
    for (let i = 0; i < 40; i += 1) {
      await saveHistory(1, body(), [PNG_1PX], null);
    }
    const items = await listHistory(1);
    expect(items).toHaveLength(40);
    expect(items.every((item) => !item.remote)).toBe(true);
    const files = await readdir(path.join(dataDir, "history", "1"));
    // 40 张图 + index.json
    expect(files).toHaveLength(41);
    expect(putRemote).not.toHaveBeenCalled();
  });

  it("第 41-100 张转存远程并从本地删除文件，索引保留", async () => {
    const { saveHistory, listHistory } = await import("@/lib/history");
    for (let i = 0; i < 70; i += 1) {
      await saveHistory(1, body(), [PNG_1PX], null);
    }
    const items = await listHistory(1);
    expect(items).toHaveLength(70);
    // 本地磁盘只留最新 40 张图 + index.json
    const files = await readdir(path.join(dataDir, "history", "1"));
    expect(files).toHaveLength(41);
    // 远程收到 30 个对象，索引里 30 条带 remote 标记
    expect(putRemote).toHaveBeenCalledTimes(30);
    const remoteItems = items.filter((item) => item.remote);
    expect(remoteItems).toHaveLength(30);
    // 远程条目都在列表尾部（更旧），本地条目在前 40
    expect(items.slice(0, 40).every((item) => !item.remote)).toBe(true);
    expect(items.slice(40).every((item) => item.remote)).toBe(true);
  });

  it("超过 100 张删除远程最旧图片，总数稳定在 100", async () => {
    const { saveHistory, listHistory } = await import("@/lib/history");
    for (let i = 0; i < 120; i += 1) {
      await saveHistory(1, body(), [PNG_1PX], null);
    }
    const items = await listHistory(1);
    expect(items).toHaveLength(100);
    expect(items.slice(0, 40).every((item) => !item.remote)).toBe(true);
    expect(items.slice(40).every((item) => item.remote)).toBe(true);
    // 120 次保存，40 张留在本地，远程净剩 60（转存 80 次、删除 20 次）
    expect(putRemote).toHaveBeenCalledTimes(80);
    expect(remoteObjects.size).toBe(60);
    expect(deleteRemote).toHaveBeenCalledTimes(20);
  });

  it("删除远程条目时同步清理远程对象", async () => {
    const { saveHistory, deleteHistory, listHistory } = await import(
      "@/lib/history"
    );
    for (let i = 0; i < 50; i += 1) {
      await saveHistory(1, body(), [PNG_1PX], null);
    }
    const items = await listHistory(1);
    const remoteItem = items.find((item) => item.remote);
    expect(remoteItem).toBeTruthy();
    expect(await deleteHistory(1, remoteItem!.id)).toBe(true);
    expect(remoteObjects.has(`1/${remoteItem!.imagePath}`)).toBe(false);
    expect((await listHistory(1))).toHaveLength(49);
  });
});
