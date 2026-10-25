import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { queryGallery, recordGalleryMetric } from "@/lib/gallery";

const originalDataDir = process.env.LFN_DATA_DIR;

async function useGalleryFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-discovery-"));
  process.env.LFN_DATA_DIR = dir;
  const galleryRoot = path.join(dir, "gallery");
  await mkdir(galleryRoot, { recursive: true });
  await writeFile(path.join(galleryRoot, "index.json"), JSON.stringify({ items: [
    { id: "fox", ownerId: 1, ownerName: "owner", authorName: "Alice", title: "Blue fox", rating: "r13", source: "lfn", tags: ["blue", "fox"], prompt: "secret phrase", negativePrompt: "", parameters: {}, imageFile: "fox.png", createdAt: "2026-10-03T00:00:00.000Z", likes: 3, downloads: 2, uses: 10, likedBy: [], status: "approved" },
    { id: "cat", ownerId: 2, ownerName: "owner", authorName: "Bob", title: "Blue cat", rating: "r13", source: "local", tags: ["blue", "cat"], prompt: "", negativePrompt: "", parameters: {}, imageFile: "cat.png", createdAt: "2026-10-02T00:00:00.000Z", likes: 9, downloads: 5, uses: 1, likedBy: [], status: "approved" },
    { id: "hidden", ownerId: 3, ownerName: "owner", authorName: "Eve", title: "Hidden work", rating: "general", source: "local", tags: ["blue"], prompt: "private marker", negativePrompt: "", parameters: {}, imageFile: "hidden.png", createdAt: "2026-10-04T00:00:00.000Z", likes: 0, downloads: 0, uses: 0, likedBy: [], status: "pending" },
  ] }), "utf8");
}

afterEach(() => {
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("gallery discovery", () => {
  it("filters by public text, exact tags and rating, then paginates a metric ranking", async () => {
    await useGalleryFixture();

    const first = await queryGallery({ q: "blue", tags: ["blue"], rating: "r13", sort: "downloads", page: 1, pageSize: 1 });
    expect(first.total).toBe(2);
    expect(first.pageCount).toBe(2);
    expect(first.items.map((item) => item.id)).toEqual(["cat"]);

    const second = await queryGallery({ tags: ["blue"], rating: "r13", sort: "downloads", page: 2, pageSize: 1 });
    expect(second.items.map((item) => item.id)).toEqual(["fox"]);
    expect(second.tags).toContain("fox");
  });

  it("does not search private prompt text and records explicit download and use counts", async () => {
    await useGalleryFixture();

    expect((await queryGallery({ q: "secret phrase" })).total).toBe(0);
    expect(await recordGalleryMetric("fox", "download")).toEqual({ downloads: 3 });
    expect(await recordGalleryMetric("fox", "use")).toEqual({ uses: 11 });

    const ranked = await queryGallery({ sort: "uses" });
    expect(ranked.items[0]?.id).toBe("fox");
    expect(await recordGalleryMetric("missing", "use")).toBeNull();
  });
});
