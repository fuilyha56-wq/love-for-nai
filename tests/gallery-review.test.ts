import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertGalleryRating,
  deleteGalleryItem,
  isRestrictedRating,
  listGalleryAdmin,
  listGallery,
  updateGalleryItem,
  publishLocalImage,
  publishFromHistory,
  galleryImagePath,
  publicGalleryItem,
  getGalleryItem,
  toggleGalleryLike,
} from "@/lib/gallery";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";
import { readImageCharacterPrompts } from "@/lib/image-character-prompts";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pngWithNaiComment(parameters: Record<string, unknown> = {}): Promise<Buffer> {
  const base = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  const metadata = Buffer.from(JSON.stringify({ Software: "NovelAI", prompt: "private prompt", uc: "private negative", width: 1, height: 1, ...parameters }));
  const keyword = Buffer.from("Comment\0");
  const chunkData = Buffer.concat([keyword, metadata]);
  const type = Buffer.from("tEXt");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(chunkData.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, chunkData])));
  const chunk = Buffer.concat([length, type, chunkData, crc]);
  let offset = 8;
  while (offset + 12 <= base.length) {
    const chunkLength = base.readUInt32BE(offset);
    if (base.toString("ascii", offset + 4, offset + 8) === "IEND") break;
    offset += chunkLength + 12;
  }
  return Buffer.concat([base.subarray(0, offset), chunk, base.subarray(offset)]);
}

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

  it("strips embedded NAI parameters when a local upload is private", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-private-"));
    process.env.LFN_DATA_DIR = dir;
    const image = await pngWithNaiComment();
    const item = await publishLocalImage(2, "owner", image, "private.png", {
      title: "private",
      authorName: "artist",
      rating: "general",
      source: "local",
      tags: [],
      prompt: "",
      negativePrompt: "",
      parameters: {},
      exposeParameters: false,
    });
    expect(item.prompt).toBe("");
    expect(item.negativePrompt).toBe("");
    expect(item.parameters).toEqual({});
    const storedImage = await readFile(galleryImagePath(item.imageFile));
    expect(PNG_SIGNATURE.equals(storedImage.subarray(0, 8))).toBe(true);
    expect(parseNaiImageMetadata(storedImage)).toBeNull();
  });

  it("keeps full prompts and generation parameters out of the public gallery list", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-list-"));
    process.env.LFN_DATA_DIR = dir;
    const galleryRoot = path.join(dir, "gallery");
    await mkdir(galleryRoot, { recursive: true });
    await writeFile(path.join(galleryRoot, "index.json"), JSON.stringify({ items: [{
      id: "public-work", ownerId: 1, ownerName: "owner", authorName: "artist", title: "work",
      rating: "general", source: "lfn", tags: ["cat"], prompt: "long prompt", negativePrompt: "negative",
      parameters: { prompt: "long prompt", width: 832 }, imageFile: "public-work.png",
      createdAt: "2026-09-01T00:00:00.000Z", likes: 0, likedBy: [], status: "approved",
    }] }));

    const [item] = await listGallery();
    expect(item.prompt).toBe("");
    expect(item.negativePrompt).toBe("");
    expect(item.parameters).toEqual({});
    expect(item.title).toBe("work");
  });

  it("unlocks gated prompts only for the owner and users who currently like the work", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-liked-"));
    process.env.LFN_DATA_DIR = dir;
    const item = await publishLocalImage(2, "owner", await pngWithNaiComment(), "liked.png", {
      title: "liked", authorName: "artist", rating: "general", source: "local", tags: [],
      prompt: "", negativePrompt: "", parameters: {}, exposeParameters: true, requireLikeForParameters: true,
    });
    expect(parseNaiImageMetadata(await readFile(galleryImagePath(item.imageFile)))).toBeNull();
    expect(publicGalleryItem(item)).toMatchObject({ parametersLocked: true, prompt: "", negativePrompt: "", parameters: {} });
    expect(publicGalleryItem(item, 7)).toMatchObject({ parametersLocked: true, parameters: {} });
    expect(publicGalleryItem(item, 2)).toMatchObject({ parametersLocked: false, prompt: "private prompt" });
    await updateGalleryItem(item.id, { status: "approved" });
    await toggleGalleryLike(item.id, 7);
    const liked = (await getGalleryItem(item.id))!;
    expect(publicGalleryItem(liked, 7)).toMatchObject({ liked: true, parametersLocked: false, prompt: "private prompt" });
    expect(publicGalleryItem(liked, 8)).toMatchObject({ liked: false, parametersLocked: true, parameters: {} });
    expect(publicGalleryItem(liked, 7).likedBy).toEqual([]);
    await toggleGalleryLike(item.id, 7);
    expect(publicGalleryItem((await getGalleryItem(item.id))!, 7)).toMatchObject({ liked: false, parametersLocked: true, prompt: "", parameters: {} });
  });

  it("uploads PNG role tags and keeps both role captions behind the like gate", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-roles-"));
    const parameters = { v4_prompt: { caption: { base_caption: "scene", char_captions: [{ char_caption: "red hair", centers: [{ x: .2, y: .5 }] }] }, use_coords: true }, v4_negative_prompt: { caption: { char_captions: [{ char_caption: "hat" }] } } };
    const item = await publishLocalImage(2, "owner", await pngWithNaiComment(parameters), "roles.png", {
      title: "roles", authorName: "artist", rating: "general", source: "local", tags: ["public"], prompt: "", negativePrompt: "", parameters: {}, exposeParameters: true, requireLikeForParameters: true,
    });
    expect(readImageCharacterPrompts(item.parameters)).toEqual([{ prompt: "red hair", negativePrompt: "hat", center: { x: .2, y: .5 } }]);
    expect(JSON.stringify(publicGalleryItem(item, 7))).not.toContain("red hair");
    expect(publicGalleryItem(item, 2).tags).toEqual(["public"]);
    expect(parseNaiImageMetadata(await readFile(galleryImagePath(item.imageFile)))).toBeNull();
    await updateGalleryItem(item.id, { status: "approved" });
    await toggleGalleryLike(item.id, 7);
    expect(readImageCharacterPrompts(publicGalleryItem((await getGalleryItem(item.id))!, 7).parameters)).toHaveLength(1);
    await toggleGalleryLike(item.id, 7);
    expect(publicGalleryItem((await getGalleryItem(item.id))!, 7).parameters).toEqual({});
  });

  it("recovers role tags from old history PNGs before metadata is stripped for publication", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-old-history-"));
    process.env.LFN_DATA_DIR = dir;
    const historyRoot = path.join(dir, "history", "2");
    await mkdir(historyRoot, { recursive: true });
    await writeFile(path.join(historyRoot, "old.png"), await pngWithNaiComment({ v4_prompt: { caption: { char_captions: [{ char_caption: "old character" }] } } }));
    await writeFile(path.join(historyRoot, "index.json"), JSON.stringify([{ id: "old", imagePath: "old.png", parameters: { prompt: "saved main", negative_prompt: "saved negative" } }]));
    const item = await publishFromHistory(2, "owner", "old", { title: "old", authorName: "artist", rating: "general", source: "lfn", tags: [], exposeParameters: true, requireLikeForParameters: true });
    expect(item.prompt).toBe("saved main");
    expect(readImageCharacterPrompts(item.parameters)[0].prompt).toBe("old character");
    expect(parseNaiImageMetadata(await readFile(galleryImagePath(item.imageFile)))).toBeNull();
  });

  it("reads missing roles from existing public works without changing the index", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-gallery-old-work-"));
    process.env.LFN_DATA_DIR = dir;
    const folder = path.join(dir, "gallery"); await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "old.png"), await pngWithNaiComment({ v4_prompt: { caption: { char_captions: [{ char_caption: "legacy character" }] } } }));
    const index = JSON.stringify({ items: [{ id: "old-work", ownerId: 2, title: "old", status: "approved", parameters: { prompt: "saved main" }, imageFile: "old.png", tags: [], likedBy: [] }] });
    await writeFile(path.join(folder, "index.json"), index);
    const item = await getGalleryItem("old-work");
    expect(readImageCharacterPrompts(item!.parameters)[0].prompt).toBe("legacy character");
    expect(await readFile(path.join(folder, "index.json"), "utf8")).toBe(index);
  });
});
