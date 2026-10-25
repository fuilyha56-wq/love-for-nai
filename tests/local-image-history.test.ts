import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageHistoryContent, sameImageHistoryContent } from "@/lib/image-history-content";
import { findLocalImageHistory, linkLocalImageHistoryToRemote, listLocalImageHistory, saveLocalImageHistory } from "@/lib/local-image-history";

const now = Date.parse("2026-10-18T08:50:00Z");
const images = new Map<string, Uint8Array>();
const fetchImage = vi.fn(async (input: string) => {
  const bytes = images.get(input);
  return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 503 });
});
const bytes = (value: string) => new TextEncoder().encode(value);
const remote = (id: string, requestId?: string) => ({ id, requestId, createdAt: new Date(now).toISOString(), imageUrl: `/images/${id}`, parameters: { model: "nai-v5-full" } });

async function local(id: string, content: Uint8Array | string, requestId?: string, remoteId?: string) {
  await saveLocalImageHistory({ id, requestId, remoteId, createdAt: now, image: new Blob([typeof content === "string" ? bytes(content) : new Uint8Array(content)]), model: "nai-v5-full" });
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  // The deployed HTTP origin has no SubtleCrypto API.
  vi.stubGlobal("crypto", {});
  vi.stubGlobal("fetch", (input: string) => input === "/api/images/cache-scope" ? Promise.resolve(Response.json({ scope: "user:1" })) : fetchImage(input));
  fetchImage.mockClear();
  images.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("local/account image history identity", () => {
  it("shows one identity for a new streamed result before and after account persistence", async () => {
    await local("browser-copy", "image", "request", "reserved-history");
    await linkLocalImageHistoryToRemote([remote("reserved-history", "request")]);
    const items = await listLocalImageHistory();
    expect(new Set([...items.map((item) => item.remoteId || item.id), "reserved-history"]).size).toBe(1);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("repairs a batch with identical timestamps and replayed local copies by image content", async () => {
    await local("local-a", "first", "request");
    await local("local-a-replay", "first", "request");
    await local("local-b", "second", "request");
    images.set("/images/server-a", bytes("first"));
    images.set("/images/server-b", bytes("second"));
    const remoteItems = [remote("server-b", "request"), remote("server-a", "request")];
    await linkLocalImageHistoryToRemote(remoteItems);
    expect((await listLocalImageHistory()).map((item) => [item.id, item.remoteId])).toEqual([
      ["local-a", "server-a"], ["local-a-replay", "server-a"], ["local-b", "server-b"],
    ]);
    expect(new Set((await listLocalImageHistory()).map((item) => item.remoteId)).size).toBe(2);
    expect(fetchImage).toHaveBeenCalledTimes(2);
    await linkLocalImageHistoryToRemote(remoteItems);
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it("keeps distinct unsynchronized outputs instead of attaching them to the nearest timestamp", async () => {
    await local("local-a", "first", "request");
    await local("local-b", "second", "request");
    images.set("/images/server-a", bytes("first"));
    await linkLocalImageHistoryToRemote([remote("server-a", "request")]);
    expect((await findLocalImageHistory("local-a"))?.remoteId).toBe("server-a");
    expect((await findLocalImageHistory("local-b"))?.remoteId).toBeUndefined();
    expect(await findLocalImageHistory("not-saved-yet")).toBeNull();
  });

  it("repairs an old copy without request metadata when content and save time uniquely match", async () => {
    await local("old-browser-copy", "same-image");
    images.set("/images/account-copy", bytes("same-image"));
    await linkLocalImageHistoryToRemote([remote("account-copy", "request")]);
    expect((await findLocalImageHistory("old-browser-copy"))?.remoteId).toBe("account-copy");
  });

  it("leaves identical images from different requests and ambiguous legacy copies separate", async () => {
    await local("known-a", "same", "request-a", "server-a");
    await local("known-b", "same", "request-b", "server-b");
    await local("unknown", "same");
    await linkLocalImageHistoryToRemote([remote("server-a", "request-a"), remote("server-b", "request-b")]);
    expect((await findLocalImageHistory("known-a"))?.remoteId).toBe("server-a");
    expect((await findLocalImageHistory("known-b"))?.remoteId).toBe("server-b");
    expect((await findLocalImageHistory("unknown"))?.remoteId).toBeUndefined();
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("preserves local history when a server image cannot be read", async () => {
    await local("local", "first", "request");
    await linkLocalImageHistoryToRemote([remote("unavailable", "request")]);
    expect((await listLocalImageHistory())[0].remoteId).toBeUndefined();
  });

  it("matches streamed PNG bytes to the account copy after server watermarking", async () => {
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const metadata = bytes("LFN-Watermark\0test-signature");
    const chunk = new Uint8Array(metadata.length + 12);
    new DataView(chunk.buffer).setUint32(0, metadata.length);
    chunk.set(bytes("tEXt"), 4);
    chunk.set(metadata, 8);
    const marked = new Uint8Array(png.length + chunk.length);
    marked.set(png.subarray(0, 33));
    marked.set(chunk, 33);
    marked.set(png.subarray(33), 33 + chunk.length);
    expect(sameImageHistoryContent(imageHistoryContent(marked), png)).toBe(true);
    await local("streamed", png, "request");
    images.set("/images/watermarked", marked);
    await linkLocalImageHistoryToRemote([remote("watermarked", "request")]);
    expect((await findLocalImageHistory("streamed"))?.remoteId).toBe("watermarked");
  });
});
