import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { deleteRemoteHistoryImage } = vi.hoisted(() => ({
  deleteRemoteHistoryImage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/remote-history", () => ({
  deleteRemoteHistoryImage,
  getRemoteHistoryImage: vi.fn(),
  putRemoteHistoryImage: vi.fn(),
}));

describe("deleteHistories", () => {
  let dataDirectory = "";
  let previousDirectory: string | undefined;

  beforeEach(async () => {
    previousDirectory = process.env.LFN_DATA_DIR;
    dataDirectory = await mkdtemp(path.join(os.tmpdir(), "lfn-history-delete-"));
    process.env.LFN_DATA_DIR = dataDirectory;
    deleteRemoteHistoryImage.mockClear();
  });

  afterEach(async () => {
    if (previousDirectory === undefined) delete process.env.LFN_DATA_DIR;
    else process.env.LFN_DATA_DIR = previousDirectory;
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  });

  it("deletes selected rows and only removes files no remaining row references", async () => {
    const userDirectory = path.join(dataDirectory, "history", "7");
    await mkdir(userDirectory, { recursive: true });
    const sharedImage = Buffer.from("shared image");
    const uniqueImage = Buffer.from("unique image");
    await writeFile(path.join(userDirectory, "shared.png"), sharedImage);
    await writeFile(path.join(userDirectory, "unique.png"), uniqueImage);
    await writeFile(path.join(userDirectory, "index.json"), JSON.stringify([
      { id: "a", imagePath: "shared.png", remote: false },
      { id: "b", imagePath: "shared.png", remote: false },
      { id: "c", imagePath: "unique.png", remote: false },
    ]));

    const { deleteHistories } = await import("@/lib/history");
    await expect(deleteHistories(7, ["a", "c", "a"])).resolves.toBe(2);
    await expect(readFile(path.join(userDirectory, "shared.png"))).resolves.toEqual(sharedImage);
    await expect(readFile(path.join(userDirectory, "unique.png"))).rejects.toThrow();
    const remaining = JSON.parse(await readFile(path.join(userDirectory, "index.json"), "utf8")) as Array<{ id: string }>;
    expect(remaining.map((item) => item.id)).toEqual(["b"]);
  });

  it("removes a remote image once after its final selected history row is deleted", async () => {
    const userDirectory = path.join(dataDirectory, "history", "8");
    await mkdir(userDirectory, { recursive: true });
    await writeFile(path.join(userDirectory, "index.json"), JSON.stringify([
      { id: "a", imagePath: "remote.png", remote: true },
      { id: "b", imagePath: "remote.png", remote: true },
    ]));

    const { deleteHistories } = await import("@/lib/history");
    await expect(deleteHistories(8, ["a", "b"])).resolves.toBe(2);
    expect(deleteRemoteHistoryImage).toHaveBeenCalledOnce();
    expect(deleteRemoteHistoryImage).toHaveBeenCalledWith(8, "remote.png");
  });
});
