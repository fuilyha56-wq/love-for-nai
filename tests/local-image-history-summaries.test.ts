import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteLocalImageHistory, findLocalImageHistory, getLocalImageHistoryThumbnail, listLocalImageHistorySummaries, saveLocalImageHistory } from "@/lib/local-image-history";

const { thumbnail } = vi.hoisted(() => ({ thumbnail: vi.fn() }));
vi.mock("@/lib/browser-image-cache", () => ({ cacheImageBlob: vi.fn(async () => {}), createImageThumbnail: thumbnail }));

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  thumbnail.mockReset().mockResolvedValue(new Blob(["thumbnail"], { type: "image/webp" }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const item = (id: string, createdAt = 1) => ({ id, ownerId: 7, remoteId: `remote-${id}`, createdAt, image: new Blob([`original-${id}`], { type: "image/png" }), prompt: `prompt-${id}`, parameters: { characters: [{ prompt: `character-${id}` }] } });

async function saveLegacyRows(version = 1) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("lfn-local-image-history-v1", version);
    open.onupgradeneeded = () => open.result.createObjectStore("images", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    for (let index = 0; index < 86; index++) transaction.objectStore("images").put(item(String(index), index));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }); } finally { db.close(); }
}

describe("local history summary and thumbnail storage", () => {
  it("migrates all legacy metadata without fetching all originals or decoding every image", async () => {
    await saveLegacyRows();
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const rows = await listLocalImageHistorySummaries();
    expect(rows).toHaveLength(86);
    expect(rows[0]).toMatchObject({ id: "85", ownerId: 7, imageType: "image/png", parameters: { characters: [{ prompt: "character-85" }] } });
    expect(rows.every(row => !("image" in row))).toBe(true);
    expect(getAll.mock.contexts.map(store => (store as IDBObjectStore).name)).toEqual(["summaries"]);
    expect(thumbnail).not.toHaveBeenCalled();
    expect(await (await findLocalImageHistory("remote-0"))?.image.text()).toBe("original-0");
  });

  it("decodes one visible legacy original, coalesces concurrent reads, and reuses the persisted thumbnail", async () => {
    await saveLegacyRows();
    await listLocalImageHistorySummaries();
    const [first, second] = await Promise.all([getLocalImageHistoryThumbnail("2"), getLocalImageHistoryThumbnail("2")]);
    expect(await first?.text()).toBe("thumbnail");
    expect(second).toBe(first);
    expect(thumbnail).toHaveBeenCalledTimes(1);
    await getLocalImageHistoryThumbnail("2");
    expect(thumbnail).toHaveBeenCalledTimes(1);
  });

  it("repairs an incomplete v2 schema without losing any original records", async () => {
    await saveLegacyRows(2);
    const rows = await listLocalImageHistorySummaries();
    expect(rows).toHaveLength(86);
    expect(await (await findLocalImageHistory("remote-85"))?.image.text()).toBe("original-85");
    expect(await (await getLocalImageHistoryThumbnail("85"))?.text()).toBe("thumbnail");
  });

  it("updates and deletes originals, summaries and thumbnail together", async () => {
    await saveLocalImageHistory(item("new"));
    expect((await listLocalImageHistorySummaries())[0]).toMatchObject({ id: "new", prompt: "prompt-new" });
    expect(await (await getLocalImageHistoryThumbnail("new"))?.text()).toBe("thumbnail");
    thumbnail.mockResolvedValueOnce(new Blob(["replacement-thumbnail"], { type: "image/webp" }));
    await saveLocalImageHistory({ ...item("new"), image: new Blob(["replacement"], { type: "image/jpeg" }), prompt: "changed" });
    expect((await listLocalImageHistorySummaries())[0]).toMatchObject({ prompt: "changed", imageType: "image/jpeg" });
    expect(await (await getLocalImageHistoryThumbnail("new"))?.text()).toBe("replacement-thumbnail");
    await deleteLocalImageHistory("new");
    expect(await listLocalImageHistorySummaries()).toEqual([]);
    expect(await findLocalImageHistory("new")).toBeNull();
    expect(await getLocalImageHistoryThumbnail("new")).toBeNull();
  });

  it("retains a valid original if preview decoding fails", async () => {
    thumbnail.mockRejectedValue(new Error("unsupported image"));
    await saveLocalImageHistory(item("undecodable"));
    expect((await listLocalImageHistorySummaries())[0].id).toBe("undecodable");
    expect(await (await findLocalImageHistory("undecodable"))?.image.text()).toBe("original-undecodable");
    expect(await getLocalImageHistoryThumbnail("undecodable")).toBeNull();
  });

  it("returns a generated preview and preserves the original when the thumbnail cache is full", async () => {
    await saveLegacyRows();
    await listLocalImageHistorySummaries();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "thumbnails") throw new DOMException("Preview cache full", "QuotaExceededError");
      return put.apply(this, args);
    });
    expect(await (await getLocalImageHistoryThumbnail("2"))?.text()).toBe("thumbnail");
    await expect(saveLocalImageHistory(item("new"))).resolves.toBeUndefined();
    expect(await (await findLocalImageHistory("new"))?.image.text()).toBe("original-new");
    expect(await (await getLocalImageHistoryThumbnail("new"))?.text()).toBe("thumbnail");
  });
});
