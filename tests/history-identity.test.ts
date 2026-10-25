import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/image-watermark", () => ({ embedWatermark: vi.fn(async (image: string) => image), verifyWatermark: vi.fn(async () => ({ valid: false })) }));
vi.mock("@/lib/remote-history", () => ({ putRemoteHistoryImage: vi.fn(async () => false), getRemoteHistoryImage: vi.fn(async () => null), deleteRemoteHistoryImage: vi.fn(async () => true) }));

import { listHistory, reserveHistoryImageIds, saveHistory } from "@/lib/history";

let directory = "";
const originalDataDir = process.env.LFN_DATA_DIR;
const image = (value: string) => `data:image/jpeg;base64,${Buffer.from(value).toString("base64")}`;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-history-identity-"));
  process.env.LFN_DATA_DIR = directory;
});
afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.join(path.resolve(os.tmpdir()), "lfn-history-identity-"))) throw new Error("Unexpected test directory");
  await rm(resolved, { recursive: true, force: true });
});

describe("streamed history persistence", () => {
  it("reserves the same identity for repeated bytes within one request", async () => {
    const images = [image("same"), image("other"), image("same")];
    const ids = reserveHistoryImageIds(images);
    expect(ids[0]).toBe(ids[2]);
    expect(ids[0]).not.toBe(ids[1]);
    const created = await saveHistory(1, { operation: "generate" }, images, null, { requestId: "request", imageIds: ids });
    expect(created.map((item) => item.id)).toEqual(ids);
    expect(await listHistory(1)).toHaveLength(2);
  });

  it("persists exactly the image IDs already returned to the browser", async () => {
    const ids = ["5d345b6e-738a-42cf-8cc2-d56b37a2d001", "5d345b6e-738a-42cf-8cc2-d56b37a2d002"];
    const created = await saveHistory(1, { operation: "generate" }, [image("first"), image("second")], null, { requestId: "request", imageIds: ids });
    expect(created.map((item) => item.id)).toEqual(ids);
    expect((await listHistory(1)).map((item) => item.id)).toEqual(ids);
    expect(await readFile(path.join(directory, "history", "1", `${ids[0]}.jpg`), "utf8")).toBe("first");
    expect(await readFile(path.join(directory, "history", "1", `${ids[1]}.jpg`), "utf8")).toBe("second");
  });

  it("replaying one request does not create extra rows, while another request remains distinct", async () => {
    const first = await saveHistory(1, { operation: "generate" }, [image("same")], null, { requestId: "request-a" });
    const replay = await saveHistory(1, { operation: "generate" }, [image("same")], null, { requestId: "request-a" });
    const second = await saveHistory(1, { operation: "generate" }, [image("same")], null, { requestId: "request-b" });
    expect(replay[0].id).toBe(first[0].id);
    expect(second[0].id).not.toBe(first[0].id);
    expect(await listHistory(1)).toHaveLength(2);
  });

  it("preserves reserved IDs when concurrent batches finish in a different order", async () => {
    const results = await Promise.all(["batch-b", "batch-a", "batch-c"].map((requestId) =>
      saveHistory(1, { operation: "generate" }, [image(requestId)], null, { requestId, imageIds: [requestId] }),
    ));
    expect(results.flatMap((items) => items.map((item) => item.id))).toEqual(["batch-b", "batch-a", "batch-c"]);
    expect(await listHistory(1)).toHaveLength(3);
  });
});
