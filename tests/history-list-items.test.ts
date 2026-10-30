import { describe, expect, it } from "vitest";
import { mergeHistoryListItems, type HistoryListItem } from "@/lib/history-list-items";
import type { LocalImageHistorySummary } from "@/lib/local-image-history";
import { localHistoryImageSource, parseLocalHistoryImageSource } from "@/lib/local-history-image-source";

const local = (id: string, overrides: Partial<LocalImageHistorySummary> = {}): LocalImageHistorySummary => ({
  id, ownerId: 7, createdAt: 1000, imageType: "image/png", imageSize: 5000, prompt: id, ...overrides,
});
const remote = (id: string): HistoryListItem => ({ id, createdAt: new Date(2000).toISOString(), imageUrl: `/api/history/${id}/image`, parameters: { prompt: `remote-${id}` }, requestId: "same-batch" });

describe("history listing without loading full images", () => {
  it("keeps all browser copies beyond server retention, with thumbnails and lazy original references", () => {
    const result = mergeHistoryListItems([remote("latest")], Array.from({ length: 65 }, (_, i) => local(`local-${i}`, { remoteId: `old-${i}` })), 7);
    expect(result.items).toHaveLength(66);
    const oldest = result.items.find(item => item.id === "old-64")!;
    expect(oldest.account).toBe(false);
    expect(oldest.thumbnailUrl).toBe(localHistoryImageSource("local-64", true));
    expect(oldest.imageUrl).toBe(localHistoryImageSource("local-64"));
  });

  it("pairs image and metadata by exact image ID, preserving distinct results from the same request", () => {
    const result = mergeHistoryListItems([remote("first")], [local("first-copy", { remoteId: "first", requestId: "same-batch" }), local("second", { requestId: "same-batch" })], 7);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: "first", account: true, localId: "first-copy", parameters: { prompt: "remote-first" } });
    expect(result.localSources.first).toBe(localHistoryImageSource("first-copy"));
    expect(result.items[1]).toMatchObject({ id: "second", account: false });
  });

  it("excludes other accounts and unclaimed legacy records, but accepts an exact current-account legacy copy", () => {
    const result = mergeHistoryListItems([remote("known")], [local("other", { ownerId: 8 }), local("unknown", { ownerId: undefined }), local("known", { ownerId: undefined })], 7);
    expect(result.items.map(item => item.id)).toEqual(["known"]);
    expect(result.localSources.known).toBe(localHistoryImageSource("known"));
    expect(mergeHistoryListItems([], [local("anything")], NaN).items).toEqual([]);
  });

  it("does not show intermediate editor images", () => {
    expect(mergeHistoryListItems([], [local("patch", { parameters: { _lfnHistoryVisibility: "intermediate" } }), local("final")], 7).items.map(item => item.id)).toEqual(["final"]);
  });

  it("round trips arbitrary local IDs without treating them as network URLs", () => {
    expect(parseLocalHistoryImageSource(localHistoryImageSource("a?b/#中文", true))).toEqual({ id: "a?b/#中文", thumbnail: true });
    expect(parseLocalHistoryImageSource("/api/history/a/image")).toBeNull();
    expect(parseLocalHistoryImageSource("lfn-local-history:%invalid")).toBeNull();
  });
});
