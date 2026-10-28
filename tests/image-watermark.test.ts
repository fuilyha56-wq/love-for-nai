import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { embedWatermark, verifyWatermark } from "@/lib/image-watermark";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";
import sharp from "sharp";
import { deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

function withoutLfnChunk(bytes: Buffer): Buffer {
  const parts = [bytes.subarray(0, 8)];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const end = offset + bytes.readUInt32BE(offset) + 12;
    if (!(bytes.toString("ascii", offset + 4, offset + 8) === "tEXt" && bytes.toString("latin1", offset + 8, end - 4).startsWith("LFN-Watermark\0"))) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(parts);
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const originalDataDir = process.env.LFN_DATA_DIR;

afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("LFN image watermark", () => {
  it("preserves every original PNG byte outside the LFN chunk, all NAI parameters and decoded pixels", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-watermark-nai-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ watermarkEnabled: true });
    const png = Buffer.from(PNG.split(",")[1], "base64");
    const parameters = { prompt: "1girl, 1.7::sitting::", negative_prompt: "lowres", seed: 4177658580, steps: 28, scale: 5, width: 832, height: 1216,
      v4_prompt: { caption: { base_caption: "1girl", char_captions: [{ char_caption: "white hair", centers: [{ x: 0.3, y: 0.5 }] }] } },
      v4_negative_prompt: { caption: { base_caption: "lowres", char_captions: [{ char_caption: "blurry", centers: [{ x: 0.3, y: 0.5 }] }] } } };
    const original = Buffer.concat([png.subarray(0, -12),
      chunk("tEXt", Buffer.from("Software\0NovelAI", "latin1")),
      chunk("tEXt", Buffer.from("Comment\0" + JSON.stringify(parameters), "latin1")),
      chunk("iTXt", Buffer.concat([Buffer.from("Description\0\0\0\0\0"), Buffer.from("保留原始说明")])),
      chunk("zTXt", Buffer.concat([Buffer.from("Other\0\0"), deflateSync("compressed metadata")])), png.subarray(-12)]);
    const before = parseNaiImageMetadata(original);
    expect(before?.parameters.seed).toBe(4177658580);
    const marked = await embedWatermark(`data:image/png;base64,${original.toString("base64")}`, "nai-1", 7, "nai-v5-full");
    const bytes = Buffer.from(marked.split(",")[1], "base64");
    expect(withoutLfnChunk(bytes)).toEqual(original);
    expect(parseNaiImageMetadata(bytes)).toEqual(before);
    expect(await sharp(bytes).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());
    expect(await verifyWatermark(marked)).toMatchObject({ valid: true, shaMatch: true });
  });
  it("preserves NAI JPEG comments when converting to a signed PNG", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-watermark-jpeg-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ watermarkEnabled: true });
    const jpeg = await sharp(Buffer.from(PNG.split(",")[1], "base64")).jpeg().toBuffer();
    const comment = Buffer.from(JSON.stringify({ Software: "NovelAI", prompt: "pose", seed: 321, steps: 28 }));
    const header = Buffer.alloc(4); header[0] = 0xff; header[1] = 0xfe; header.writeUInt16BE(comment.length + 2, 2);
    const original = Buffer.concat([jpeg.subarray(0, 2), header, comment, jpeg.subarray(2)]);
    const marked = await embedWatermark(`data:image/jpeg;base64,${original.toString("base64")}`, "jpg-1", 7, "nai-v5-full");
    const output = Buffer.from(marked.split(",")[1], "base64");
    expect(parseNaiImageMetadata(output)).toEqual(parseNaiImageMetadata(original));
    expect(await verifyWatermark(marked)).toMatchObject({ valid: true, shaMatch: true });
  });
  it("embeds a valid signature without changing decoded image pixels", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-watermark-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ watermarkEnabled: true, publicUrl: "https://love-for-nai.test" });
    const marked = await embedWatermark(PNG, "image-1", 7, "nai-v5-full", {
      requestId: "request-1",
      requestFingerprint: "fingerprint-1",
      parameters: { prompt: "hello", steps: 28, width: 64, height: 64, seed: 123 },
    });
    expect(marked).not.toBe(PNG);
    const result = await verifyWatermark(marked);
    expect(result.valid).toBe(true);
    expect(result.shaMatch).toBe(true);
    expect(result.payload).toMatchObject({ requestId: "request-1", imageId: "image-1", userId: 7, model: "nai-v5-full" });
    expect(result.payload?.parameters).toMatchObject({ steps: 28, seed: 123 });
  });

  it("does not embed when disabled", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-watermark-disabled-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ watermarkEnabled: false });
    expect(await embedWatermark(PNG, "image-1", 7, "nai-v5-full")).toBe(PNG);
  });
});
