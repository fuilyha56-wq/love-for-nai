import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertGalleryRating,
  deleteGalleryItem,
  isRestrictedRating,
  listGalleryAdmin,
  updateGalleryItem,
} from "@/lib/gallery";

describe("assertGalleryRating", () => {
  it("accepts the three supported ratings", () => {
    expect(assertGalleryRating("general")).toBe("general");
    expect(assertGalleryRating("r13")).toBe("r13");
    expect(assertGalleryRating("r18")).toBe("r18");
  });

  it("rejects unknown or legacy ratings", () => {
    expect(() => assertGalleryRating("sensitive")).toThrow();
    expect(() => assertGalleryRating("explicit")).toThrow();
    expect(() => assertGalleryRating(undefined)).toThrow();
  });
});

describe("isRestrictedRating", () => {
  it("only treats r18 as restricted", () => {
    expect(isRestrictedRating("r18")).toBe(true);
    expect(isRestrictedRating("r13")).toBe(false);
    expect(isRestrictedRating("general")).toBe(false);
  });
});

describe("gallery admin mutations", () => {
  const original = process.env.LFN_DATA_DIR;
  afterEach(() => {
    if (original == null) delete process.env.LFN_DATA_DIR;
    else process.env.LFN_DATA_DIR = original;
  });

  it("updates rating/title and can delete an item", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-admin-"));
    process.env.LFN_DATA_DIR = dir;
    const galleryRoot = path.join(dir, "gallery");
    await mkdir(galleryRoot, { recursive: true });
    await writeFile(
      path.join(galleryRoot, "index.json"),
      JSON.stringify({
        items: [
          {
            id: "work-1",
            ownerId: 1,
            ownerName: "owner",
            authorName: "artist",
            title: "旧标题",
            rating: "general",
            source: "lfn",
            tags: ["cat"],
            prompt: "1girl",
            negativePrompt: "",
            parameters: {},
            imageFile: "work-1.png",
            createdAt: "2026-09-01T00:00:00.000Z",
            likes: 0,
            likedBy: [],
          },
        ],
      }),
    );
    const updated = await updateGalleryItem("work-1", {
      title: "新标题",
      rating: "r13",
      tags: ["cat", "portrait"],
    });
    expect(updated.title).toBe("新标题");
    expect(updated.rating).toBe("r13");
    expect(await deleteGalleryItem("work-1")).toBe(true);
    expect(await listGalleryAdmin()).toEqual([]);
  });
});
