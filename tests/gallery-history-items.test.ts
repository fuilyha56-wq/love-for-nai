import { describe, expect, it } from "vitest";
import { galleryHistoryItems } from "@/lib/gallery-history-items";
import type { LocalImageHistorySummary } from "@/lib/local-image-history";

const local = (id: string, patch: Partial<LocalImageHistorySummary> = {}): LocalImageHistorySummary => ({ id, ownerId: 7, createdAt: 1, imageType: "image/png", imageSize: 123456, prompt: id, ...patch });
const remote = (id: string) => ({ id, createdAt: "2026-10-30T00:00:00Z", parameters: { operation: "generate", prompt: id } });

describe("gallery history list", () => {
  it("keeps every owned cached original beyond the server's forty-image retention window", () => {
    const locals = Array.from({ length: 93 }, (_, index) => local(`local-${index}`, { remoteId: `remote-${index}`, createdAt: index }));
    const items = galleryHistoryItems(Array.from({ length: 40 }, (_, index) => remote(`remote-${index + 53}`)), locals, 7);
    expect(items).toHaveLength(93);
    const oldest = items.find(item => item.localId === "local-0")!;
    expect(oldest).toMatchObject({ origin: "local", prompt: "local-0" });
    expect(oldest.historyId).toBeUndefined();
    expect(oldest.file).toBeUndefined();
    expect(oldest.thumbnail).toContain("variant=thumbnail");
    expect(oldest.image).not.toContain("variant=thumbnail");
  });

  it("never treats ownerless or another account's local originals as the signed-in user's images", () => {
    const items = galleryHistoryItems([remote("live")], [local("unknown", { ownerId: undefined }), local("other", { ownerId: 9 }), local("known"), local("legacy-live", { ownerId: undefined, remoteId: "live" })], 7);
    expect(items.map(item => item.key)).toEqual(["account:live", "local:known"]);
    expect(galleryHistoryItems([], [local("known")])).toEqual([]);
  });

  it("deduplicates only exact identities and retains per-image metadata for a batch", () => {
    const items = galleryHistoryItems([remote("live"), remote("live")], [local("live-cache", { remoteId: "live" }), local("live"), local("a", { remoteId: "expired-a", parameters: { prompt: "first", width: 832, height: 1216 } }), local("a-replay", { remoteId: "expired-a" }), local("b", { remoteId: "expired-b", parameters: { prompt: "second", width: 1216, height: 832 } })], 7);
    expect(items).toHaveLength(3);
    expect(items.find(item => item.localId === "a")).toMatchObject({ prompt: "first", width: 832, height: 1216 });
    expect(items.find(item => item.localId === "b")).toMatchObject({ prompt: "second", width: 1216, height: 832 });
  });
});
