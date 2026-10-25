import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createImageThumbnail, stripImageMetadata } from "@/lib/image-processing";
import { embedWatermark, verifyWatermark, WatermarkPreservationError } from "@/lib/image-watermark";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";

const originalDataDir = process.env.LFN_DATA_DIR;
const imageUrl = (data: Buffer) => `data:image/png;base64,${data.toString("base64")}`;
const imageBytes = (url: string) => Buffer.from(url.split(",")[1], "base64");
afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

async function signedNaiImage() {
  process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-strip-"));
  resetRuntimeConfigCache();
  await updateRuntimeSettings({ watermarkEnabled: true, publicUrl: "https://love-for-nai.test" });
  const base = await sharp({ create: { width: 32, height: 20, channels: 3, background: "#456" } }).png().toBuffer();
  const withMetadata = Buffer.concat([base.subarray(0, base.length - 12), pngTextChunk("Software", "NovelAI"), pngTextChunk("Comment", JSON.stringify({ prompt: "private-nai-prompt", steps: 21, seed: 9876 })), base.subarray(base.length - 12)]);
  const marked = imageBytes(await embedWatermark(imageUrl(withMetadata), "image-keep", 7, "nai-v5-full", {
    requestId: "request-keep", requestFingerprint: "fingerprint-keep",
    parameters: { prompt: "private-nai-prompt", seed: 9876, reference_image: "private-reference" },
  }));
  return { marked, base };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngTextChunk(keyword: string, value: string): Buffer {
  const type = Buffer.from("tEXt");
  const data = Buffer.from(`${keyword}\0${value}`, "latin1");
  const body = Buffer.concat([type, data]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return chunk;
}

describe("image processing", () => {
  it("creates a bounded WebP thumbnail", async () => {
    const source = await sharp({ create: { width: 1400, height: 900, channels: 3, background: "#c23d58" } }).png().toBuffer();
    const thumbnail = await createImageThumbnail(source);
    const metadata = await sharp(thumbnail).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBeLessThanOrEqual(512);
    expect(metadata.height).toBeLessThanOrEqual(512);
  });

  it("re-encodes PNG images without embedded NAI text metadata", async () => {
    const base = await sharp({ create: { width: 32, height: 20, channels: 3, background: "#456" } }).png().toBuffer();
    const withMetadata = Buffer.concat([base.subarray(0, base.length - 12), pngTextChunk("Comment", "NovelAI generation_parameters"), base.subarray(base.length - 12)]);
    expect(withMetadata.includes(Buffer.from("NovelAI"))).toBe(true);
    const cleaned = await stripImageMetadata(withMetadata, "input.png");
    expect(cleaned.extension).toBe("png");
    expect(cleaned.data.includes(Buffer.from("NovelAI"))).toBe(false);
    expect((await sharp(cleaned.data).metadata()).width).toBe(32);
  });

  it("retains valid LFN provenance and image integrity while removing NAI metadata and signed generation parameters", async () => {
    const { marked, base } = await signedNaiImage();
    const before = await verifyWatermark(imageUrl(marked));
    const cleaned = await stripImageMetadata(marked, "input.png");
    const after = await verifyWatermark(imageUrl(cleaned.data));
    expect(after).toMatchObject({ valid: true, shaMatch: true, payload: {
      imageId: "image-keep", requestId: "request-keep", requestFingerprint: "fingerprint-keep",
      userId: 7, model: "nai-v5-full", domain: "https://love-for-nai.test",
      timestamp: before.payload?.timestamp, metadataStripped: true, sourceSha256: before.payload?.sha256,
    } });
    expect(after.payload).not.toHaveProperty("parameters");
    expect(JSON.stringify(after.payload)).not.toContain("private-");
    expect(parseNaiImageMetadata(cleaned.data)).toBeNull();
    expect(cleaned.data.includes(Buffer.from("NovelAI"))).toBe(false);
    expect(await sharp(cleaned.data).raw().toBuffer()).toEqual(await sharp(base).raw().toBuffer());
  });

  it("preserves an existing LFN watermark even if signing new images is now disabled", async () => {
    const { marked } = await signedNaiImage();
    await updateRuntimeSettings({ watermarkEnabled: false });
    const cleaned = await stripImageMetadata(marked, "input.png");
    expect(await verifyWatermark(imageUrl(cleaned.data))).toMatchObject({ valid: true, shaMatch: true });
  });

  it("keeps provenance valid across repeated cleaning and a mismatched filename", async () => {
    const { marked } = await signedNaiImage();
    const before = await verifyWatermark(imageUrl(marked));
    const first = await stripImageMetadata(marked, "wrong.jpg");
    const second = await stripImageMetadata(first.data, "input.png");
    expect(first.extension).toBe("png");
    expect(await verifyWatermark(imageUrl(second.data))).toMatchObject({ valid: true, shaMatch: true, payload: {
      sourceSha256: before.payload?.sha256, requestId: "request-keep", timestamp: before.payload?.timestamp,
    } });
  });

  it("does not silently remove or re-sign provenance whose source image was modified", async () => {
    const { marked } = await signedNaiImage();
    const modified = Buffer.concat([marked.subarray(0, marked.length - 12), pngTextChunk("Comment", "modified after signing"), marked.subarray(marked.length - 12)]);
    expect(await verifyWatermark(imageUrl(modified))).toMatchObject({ valid: true, shaMatch: false });
    await expect(stripImageMetadata(modified, "input.png")).rejects.toBeInstanceOf(WatermarkPreservationError);
  });

  it("does not mint LFN provenance for unsigned images or copied invalid signatures", async () => {
    const { base } = await signedNaiImage();
    const unsigned = await stripImageMetadata(base, "input.png");
    expect(await verifyWatermark(imageUrl(unsigned.data))).toMatchObject({ valid: false });
    const forged = Buffer.concat([base.subarray(0, base.length - 12), pngTextChunk("LFN-Watermark", "forged"), base.subarray(base.length - 12)]);
    await expect(stripImageMetadata(forged, "input.png")).rejects.toBeInstanceOf(WatermarkPreservationError);
  });
});
