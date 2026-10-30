import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheImageBlob, deleteCachedImage, fetchCachedImageBlob } from "@/lib/browser-image-cache";

let scope = "user:1";
let scopeAvailable = true;
const source = "/api/history/example/image";
const thumbnail = `${source}?variant=thumbnail`;
const imageFetch = vi.fn(async (url: string) => { void url; return new Response("original-bytes", { headers: { "Content-Type": "image/png" } }); });
const drawImage = vi.fn();

beforeEach(() => {
  scope = "user:1";
  scopeAvailable = true;
  imageFetch.mockReset().mockImplementation(async () => new Response("original-bytes", { headers: { "Content-Type": "image/png" } }));
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", (url: string) => url === "/api/images/cache-scope"
    ? Promise.resolve(scopeAvailable ? Response.json({ scope }) : new Response(null, { status: 503 }))
    : imageFetch(url));
  vi.stubGlobal("Image", class {
    naturalWidth = 1000;
    naturalHeight = 1600;
    onload?: () => void;
    set src(_src: string) { queueMicrotask(() => this.onload?.()); }
  });
  drawImage.mockClear();
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["local-thumbnail"], { type: "image/webp" })) }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("persistent browser image cache", () => {
  it("requests a thumbnail once across concurrent reads and a later page load, without requesting the original", async () => {
    await Promise.all([fetchCachedImageBlob(thumbnail), fetchCachedImageBlob(thumbnail)]);
    expect(imageFetch.mock.calls.map(([url]) => url)).toEqual([thumbnail]);
    vi.resetModules();
    const reloaded = await import("@/lib/browser-image-cache");
    expect(await (await reloaded.fetchCachedImageBlob(thumbnail)).text()).toBe("original-bytes");
    expect(imageFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches the original on demand, preserves its exact bytes, and reuses it for subsequent views and downloads", async () => {
    await fetchCachedImageBlob(thumbnail);
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("original-bytes");
    await fetchCachedImageBlob(source);
    expect(imageFetch.mock.calls.map(([url]) => url)).toEqual([thumbnail, source]);
  });

  it("builds and persists a proportional thumbnail from a generated local original with no image request", async () => {
    await cacheImageBlob(source, new Blob(["generated-original"], { type: "image/png" }));
    expect(await (await fetchCachedImageBlob(thumbnail)).text()).toBe("local-thumbnail");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 320, 512);
    await fetchCachedImageBlob(thumbnail);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("generated-original");
    expect(imageFetch).not.toHaveBeenCalled();
  });

  it("requests only the new thumbnail when a list gains a new image", async () => {
    await fetchCachedImageBlob(thumbnail);
    await Promise.all([fetchCachedImageBlob(thumbnail), fetchCachedImageBlob("/api/history/new/image?variant=thumbnail")]);
    expect(imageFetch.mock.calls.map(([url]) => url)).toEqual([thumbnail, "/api/history/new/image?variant=thumbnail"]);
  });

  it("isolates persisted images when the signed-in account changes", async () => {
    await cacheImageBlob(source, new Blob(["first-user"], { type: "image/png" }));
    scope = "user:2";
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("original-bytes");
    scope = "user:1";
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("first-user");
    expect(imageFetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache a previous owner's asynchronously saved original under the new account", async () => {
    scope = "user:2";
    await cacheImageBlob(source, new Blob(["private-user-one-original"], { type: "image/png" }), "user:1");
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("original-bytes");
    expect(imageFetch).toHaveBeenCalledTimes(1);
    scope = "user:1";
    await cacheImageBlob(source, new Blob(["private-user-one-original"], { type: "image/png" }), "user:1");
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("private-user-one-original");
  });

  it("deletes both variants of the selected image while retaining other users' caches", async () => {
    await fetchCachedImageBlob(source);
    await fetchCachedImageBlob(thumbnail);
    scope = "user:2";
    await cacheImageBlob(source, new Blob(["second-user"], { type: "image/png" }));
    scope = "user:1";
    await deleteCachedImage(source);
    await fetchCachedImageBlob(thumbnail);
    await fetchCachedImageBlob(source);
    expect(imageFetch.mock.calls.map(([url]) => url)).toEqual([source, thumbnail, source]);
    scope = "user:2";
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("second-user");
  });

  it("still displays images when IndexedDB is unavailable, without requesting them twice", async () => {
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("storage unavailable"); } });
    expect(await (await fetchCachedImageBlob(thumbnail)).text()).toBe("original-bytes");
    expect(imageFetch).toHaveBeenCalledTimes(1);
  });

  it("does not restore deleted cached data when a previous image request finishes late", async () => {
    let finish!: (response: Response) => void;
    imageFetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const previous = fetchCachedImageBlob(source);
    await vi.waitFor(() => expect(imageFetch).toHaveBeenCalledTimes(1));
    await deleteCachedImage(source);
    finish(new Response("removed-image", { headers: { "Content-Type": "image/png" } }));
    await previous;
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("original-bytes");
    expect(imageFetch).toHaveBeenCalledTimes(2);
  });

  it("does not read another account's cache when session identification is unavailable", async () => {
    await cacheImageBlob(source, new Blob(["private-cache"], { type: "image/png" }));
    scopeAvailable = false;
    expect(await (await fetchCachedImageBlob(source)).text()).toBe("original-bytes");
    expect(imageFetch).toHaveBeenCalledTimes(1);
  });

  it("does not store error responses, and retries a later explicit read", async () => {
    imageFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(fetchCachedImageBlob(thumbnail)).rejects.toThrow("图片读取失败");
    expect(await (await fetchCachedImageBlob(thumbnail)).text()).toBe("original-bytes");
    expect(imageFetch).toHaveBeenCalledTimes(2);
  });
});
