import { createHash, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimeSettings } from "@/lib/runtime-config";

export type WatermarkPayload = {
  schema: "lfn-watermark-v2" | "lfn-watermark-v1";
  keyId: string;
  imageId?: string;
  requestId: string;
  requestFingerprint?: string;
  sha256: string;
  timestamp: string;
  userId: number;
  model: string;
  domain: string;
  issuer: string;
  label: string;
  note?: string;
  parameters?: Record<string, unknown>;
  metadataStripped?: true;
  sourceSha256?: string;
};

export class WatermarkPreservationError extends Error {}

export type WatermarkOptions = {
  imageId?: string;
  requestId?: string;
  requestFingerprint?: string;
  parameters?: Record<string, unknown>;
};

type StoredKeyPair = { publicKey: string; privateKey: string; keyId?: string };
type KeyPair = { publicKey: string; privateKey: string; keyId: string };
const keyRuntime = globalThis as typeof globalThis & { __lfnWatermarkKeys?: { file: string; pending: Promise<KeyPair> } };

async function getKeyPair(): Promise<KeyPair> {
  const keyPath = path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "watermark-keys.json");
  if (keyRuntime.__lfnWatermarkKeys?.file !== keyPath) {
    const pending = loadKeyPair(keyPath);
    keyRuntime.__lfnWatermarkKeys = { file: keyPath, pending };
    void pending.catch(() => { if (keyRuntime.__lfnWatermarkKeys?.pending === pending) keyRuntime.__lfnWatermarkKeys = undefined; });
  }
  return keyRuntime.__lfnWatermarkKeys!.pending;
}
async function loadKeyPair(keyPath: string): Promise<KeyPair> {
  try {
    const stored = JSON.parse(await readFile(keyPath, "utf8")) as StoredKeyPair | null;
    if (stored && stored.publicKey && stored.privateKey) {
      return {
        publicKey: stored.publicKey,
        privateKey: stored.privateKey,
        keyId: stored.keyId || createHash("sha256").update(stored.publicKey).digest("hex").slice(0, 16),
      };
    }
    throw new Error("Invalid watermark signing key file");
  } catch (error) {
    // Never silently rotate a damaged or unreadable key: old signatures must remain verifiable.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const keys = {
    publicKey,
    privateKey,
    keyId: createHash("sha256").update(publicKey).digest("hex").slice(0, 16),
  };
  await mkdir(path.dirname(keyPath), { recursive: true });
  try { await writeFile(keyPath, JSON.stringify(keys, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; return loadKeyPair(keyPath); }
  return keys;
}

function dataUrlParts(imageDataUrl: string): { mime: string; encoded: string; buffer: Buffer } {
  const match = imageDataUrl.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i);
  if (!match) throw new Error("Invalid data URL");
  return { mime: match[1].toLowerCase(), encoded: match[2], buffer: Buffer.from(match[2], "base64") };
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function calculateImageHash(buffer: Buffer): string {
  return createHash("sha256").update(isPng(buffer) ? removePngTextChunk(buffer, "LFN-Watermark") : buffer).digest("hex");
}

export function hasEmbeddedWatermark(buffer: Buffer): boolean {
  return isPng(buffer) && extractPngTextChunk(buffer, "LFN-Watermark") !== null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function watermarkImages(
  images: string[],
  userId: number,
  model: string,
  options: WatermarkOptions = {},
): Promise<{ images: string[]; status: "embedded" | "disabled" | "skipped" | "failed" }> {
  const settings = await getRuntimeSettings();
  if (!settings.watermarkEnabled) return { images, status: "disabled" };
  let changed = false;
  try {
    const next = await Promise.all(images.map((image, index) => embedWatermark(image, images.length === 1 && options.imageId ? options.imageId : `${options.requestId || "lfn"}-${index + 1}`, userId, model, options)));
    changed = next.some((image, index) => image !== images[index]);
    return { images: next, status: changed ? "embedded" : "skipped" };
  } catch {
    return { images, status: "failed" };
  }
}

export async function embedWatermark(
  imageDataUrl: string,
  imageId: string,
  userId: number,
  model: string,
  options: WatermarkOptions = {},
): Promise<string> {
  const { mime, buffer } = dataUrlParts(imageDataUrl);
  if (!isPng(buffer)) return imageDataUrl;
  const settings = await getRuntimeSettings();
  if (!settings.watermarkEnabled) return imageDataUrl;
  const keys = await getKeyPair();
  const payload: WatermarkPayload = {
    schema: "lfn-watermark-v2",
    keyId: keys.keyId,
    imageId,
    requestId: options.requestId || imageId,
    requestFingerprint: options.requestFingerprint,
    sha256: calculateImageHash(buffer),
    timestamp: new Date().toISOString(),
    userId,
    model,
    domain: settings.publicUrl || process.env.LFN_PUBLIC_URL || "love-for-nai",
    issuer: settings.watermarkIssuer,
    label: settings.watermarkLabel,
    note: settings.watermarkNote || undefined,
    parameters: options.parameters,
  };
  const watermarked = signWatermark(buffer, payload, keys);
  return `data:${mime};base64,${watermarked.toString("base64")}`;
}

type WatermarkVerification = {
  valid: boolean;
  legacy?: boolean;
  payload?: WatermarkPayload;
  shaMatch?: boolean;
  error?: string;
};

export async function verifyWatermark(imageDataUrl: string): Promise<WatermarkVerification> {
  try {
    const { buffer } = dataUrlParts(imageDataUrl);
    return await verifyWatermarkBuffer(buffer);
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "验证失败" };
  }
}

async function verifyWatermarkBuffer(buffer: Buffer): Promise<WatermarkVerification> {
  try {
    if (!isPng(buffer)) return { valid: false, error: "仅支持含 LFN 元数据的 PNG 图片" };
    const encoded = extractPngTextChunk(buffer, "LFN-Watermark");
    if (!encoded) return { valid: false, error: "未找到 Love-for-NAI 图片签名" };
    const data = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as { payload: WatermarkPayload; signature: string };
    const keys = await getKeyPair();
    const verifier = createVerify("RSA-SHA256");
    verifier.update(data.payload.schema === "lfn-watermark-v2" ? stableJson(data.payload) : JSON.stringify(data.payload));
    if (!verifier.verify(keys.publicKey, data.signature, "base64")) return { valid: false, error: "图片签名无效" };
    const shaMatch = calculateImageHash(buffer) === data.payload.sha256;
    return {
      valid: true,
      legacy: data.payload.schema !== "lfn-watermark-v2",
      payload: data.payload,
      shaMatch,
    };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "验证失败" };
  }
}

/** Retain authenticated provenance, without retaining generation parameters or blessing modified inputs. */
export async function preserveWatermarkAfterMetadataStrip(original: Buffer, cleaned: Buffer): Promise<Buffer> {
  if (!isPng(original) || !isPng(cleaned) || !extractPngTextChunk(original, "LFN-Watermark")) return cleaned;
  const verified = await verifyWatermarkBuffer(original);
  if (!verified.valid || !verified.shaMatch || !verified.payload) {
    throw new WatermarkPreservationError("原图的 LFN 水印无效或图片已被修改，无法保留有效溯源水印，请下载原图。");
  }
  const source = verified.payload;
  const keys = await getKeyPair();
  // Use an explicit allowlist: prompt/seed/reference data in the old signed
  // parameters must not survive the user's metadata-removal request.
  const payload: WatermarkPayload = {
    schema: "lfn-watermark-v2",
    keyId: keys.keyId,
    imageId: source.imageId,
    requestId: source.requestId,
    requestFingerprint: source.requestFingerprint,
    sha256: calculateImageHash(cleaned),
    timestamp: source.timestamp,
    userId: source.userId,
    model: source.model,
    domain: source.domain,
    issuer: source.issuer,
    label: source.label,
    note: source.note,
    metadataStripped: true,
    sourceSha256: source.sourceSha256 || source.sha256,
  };
  // Preserving an existing signature is independent of whether signing new
  // generations has since been disabled in settings.
  return signWatermark(cleaned, payload, keys);
}

function signWatermark(buffer: Buffer, payload: WatermarkPayload, keys: KeyPair): Buffer {
  const signer = createSign("RSA-SHA256");
  signer.update(stableJson(payload));
  const signature = signer.sign(keys.privateKey, "base64");
  const watermark = Buffer.from(JSON.stringify({ payload, signature }), "utf8").toString("base64");
  return injectPngTextChunk(buffer, "LFN-Watermark", watermark);
}

export async function getPublicKey(): Promise<string> {
  return (await getKeyPair()).publicKey;
}

function injectPngTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  if (!isPng(png)) throw new Error("Invalid PNG signature");
  const chunks: Buffer[] = [png.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > png.length) throw new Error("Invalid PNG chunk");
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type !== "tEXt" || png.toString("utf8", offset + 8, offset + 8 + length).split("\0", 1)[0] !== keyword) chunks.push(png.subarray(offset, chunkEnd));
    if (type === "IHDR" && !inserted) {
      chunks.push(createPngTextChunk(keyword, text));
      inserted = true;
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  if (!inserted) throw new Error("PNG is missing IHDR");
  return Buffer.concat(chunks);
}

function removePngTextChunk(png: Buffer, keyword: string): Buffer {
  if (!isPng(png)) return png;
  const chunks: Buffer[] = [png.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > png.length) return png;
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const keywordEnd = data.indexOf(0);
    const currentKeyword = type === "tEXt" && keywordEnd >= 0 ? data.toString("utf8", 0, keywordEnd) : "";
    if (!(type === "tEXt" && currentKeyword === keyword)) chunks.push(png.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  return Buffer.concat(chunks);
}

function extractPngTextChunk(png: Buffer, keyword: string): string | null {
  if (!isPng(png)) return null;
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > png.length) return null;
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "tEXt") {
      const data = png.subarray(offset + 8, offset + 8 + length);
      const separator = data.indexOf(0);
      if (separator >= 0 && data.toString("utf8", 0, separator) === keyword) return data.toString("utf8", separator + 1);
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  return null;
}

function createPngTextChunk(keyword: string, text: string): Buffer {
  const data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const type = Buffer.from("tEXt", "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
