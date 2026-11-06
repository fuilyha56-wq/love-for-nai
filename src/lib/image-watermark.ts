import { createHash, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimeSettings } from "@/lib/runtime-config";
import { readWatermarkContainer, type WatermarkImageMime } from "./image-watermark-container";

export { detectWatermarkImageMime } from "./image-watermark-container";

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
  source?: "gateway";
  parameters?: Record<string, unknown>;
  metadataStripped?: true;
  sourceSha256?: string;
};

export class WatermarkPreservationError extends Error {}
export class WatermarkSigningError extends Error {
  constructor(message = "LFN 图片签名失败", options?: ErrorOptions) {
    super(message, options);
    this.name = "WatermarkSigningError";
  }
}

export type WatermarkOptions = {
  imageId?: string;
  requestId?: string;
  requestFingerprint?: string;
  parameters?: Record<string, unknown>;
  required?: boolean;
  source?: "gateway";
  sampleOffset?: number;
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

function dataUrlBuffer(imageDataUrl: string): Buffer {
  const match = imageDataUrl.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i);
  if (!match) throw new Error("Invalid data URL");
  return Buffer.from(match[2], "base64");
}

function calculateImageHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hasEmbeddedWatermark(buffer: Buffer): boolean {
  try {
    return readWatermarkContainer(buffer).watermark !== undefined;
  } catch {
    return false;
  }
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
  if (!options.required && !(await getRuntimeSettings()).watermarkEnabled) return { images, status: "disabled" };
  const mark = (image: string, index: number) => {
    const imageId = images.length === 1 && options.imageId ? options.imageId : `${options.requestId || "lfn"}-${(options.sampleOffset ?? 0) + index + 1}`;
    return embedWatermarkDataUrl(image, imageId, userId, model, options, options.required === true);
  };
  try {
    const next = await Promise.all(images.map(mark));
    const embedded = options.required ? next.length > 0 : next.some((image, index) => image !== images[index]);
    return { images: next, status: embedded ? "embedded" : "skipped" };
  } catch (error) {
    if (options.required) throw error instanceof WatermarkSigningError ? error : new WatermarkSigningError(undefined, { cause: error });
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
  return embedWatermarkDataUrl(imageDataUrl, imageId, userId, model, options, false);
}

async function embedWatermarkDataUrl(
  imageDataUrl: string,
  imageId: string,
  userId: number,
  model: string,
  options: WatermarkOptions,
  retry: boolean,
): Promise<string> {
  try {
    if (!options.required && !(await getRuntimeSettings()).watermarkEnabled) return imageDataUrl;
    const inline = imageDataUrl.startsWith("data:") ? imageDataUrl
      : await (await import("@/lib/provider/http")).downloadProviderImage(imageDataUrl);
    const bytes = dataUrlBuffer(inline);
    const sign = () => signImageWatermark(bytes, imageId, userId, model, options);
    const signed = await sign().catch((error: unknown) => {
      if (!retry) throw error;
      return sign();
    });
    if (signed.status === "disabled") return imageDataUrl;
    return `data:${signed.mime};base64,${signed.buffer.toString("base64")}`;
  } catch (error) {
    if (options.required && !(error instanceof WatermarkSigningError)) throw new WatermarkSigningError(undefined, { cause: error });
    throw error;
  }
}

function sameAttribution(payload: WatermarkPayload, imageId: string, userId: number, model: string, options: WatermarkOptions): boolean {
  if (options.source === "gateway" && payload.userId > 0 && payload.source !== "gateway") return true;
  return payload.source === options.source && payload.userId === userId && payload.model === model &&
    payload.imageId === imageId && payload.requestId === (options.requestId || imageId) &&
    (options.requestFingerprint === undefined || payload.requestFingerprint === options.requestFingerprint) &&
    (options.parameters === undefined || stableJson(payload.parameters) === stableJson(options.parameters));
}

export async function signImageWatermark(
  buffer: Buffer,
  imageId: string,
  userId: number,
  model: string,
  options: WatermarkOptions = {},
): Promise<{ buffer: Buffer; mime: WatermarkImageMime; status: "embedded" | "reused" | "disabled" }> {
  try {
    const settings = await getRuntimeSettings();
    const container = readWatermarkContainer(buffer);
    const { mime } = container;
    if (!settings.watermarkEnabled && !options.required) return { buffer, mime, status: "disabled" };
    const keys = await getKeyPair();
    if (container.watermark && !container.duplicate) {
      const prior = verifyEmbeddedWatermark(container, keys);
      if (prior.valid && prior.shaMatch && prior.payload && sameAttribution(prior.payload, imageId, userId, model, options))
        return { buffer, mime, status: "reused" };
    }
    const payload: WatermarkPayload = {
      schema: "lfn-watermark-v2",
      keyId: keys.keyId,
      imageId,
      requestId: options.requestId || imageId,
      requestFingerprint: options.requestFingerprint,
      sha256: calculateImageHash(container.unsigned),
      timestamp: new Date().toISOString(),
      userId,
      model,
      domain: settings.publicUrl || process.env.LFN_PUBLIC_URL || "love-for-nai",
      issuer: settings.watermarkIssuer,
      label: settings.watermarkLabel,
      note: settings.watermarkNote || undefined,
      source: options.source,
      parameters: options.parameters,
    };
    const signed = signWatermark(container, payload, keys);
    if (options.required) {
      const verified = verifyEmbeddedWatermark(readWatermarkContainer(signed), keys);
      if (!verified.valid || !verified.shaMatch) throw new Error("LFN signing output could not be verified");
    }
    return { buffer: signed, mime, status: "embedded" };
  } catch (error) {
    if (options.required) throw new WatermarkSigningError(undefined, { cause: error });
    throw error;
  }
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
    return await verifyWatermarkBuffer(dataUrlBuffer(imageDataUrl));
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "验证失败" };
  }
}

export async function verifyWatermarkBuffer(buffer: Buffer): Promise<WatermarkVerification> {
  try {
    const container = readWatermarkContainer(buffer);
    if (container.watermark === undefined) return { valid: false, error: "未找到 Love-for-NAI 图片签名" };
    return verifyEmbeddedWatermark(container, await getKeyPair());
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "验证失败" };
  }
}

type WatermarkContainer = ReturnType<typeof readWatermarkContainer>;

function verifyEmbeddedWatermark(container: WatermarkContainer, keys: KeyPair): WatermarkVerification {
  try {
    if (container.duplicate || !container.watermark || !/^[A-Za-z0-9+/]+={0,2}$/.test(container.watermark)) {
      return { valid: false, error: "图片签名无效" };
    }
    const data = JSON.parse(Buffer.from(container.watermark, "base64").toString("utf8")) as { payload: WatermarkPayload; signature: string };
    if (data.payload.schema !== "lfn-watermark-v2" && data.payload.schema !== "lfn-watermark-v1") {
      return { valid: false, error: "图片签名版本无效" };
    }
    const verifier = createVerify("RSA-SHA256");
    verifier.update(data.payload.schema === "lfn-watermark-v2" ? stableJson(data.payload) : JSON.stringify(data.payload));
    if (!verifier.verify(keys.publicKey, data.signature, "base64")) return { valid: false, error: "图片签名无效" };
    const shaMatch = calculateImageHash(container.unsigned) === data.payload.sha256;
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
  if (!hasEmbeddedWatermark(original)) return cleaned;
  const verified = await verifyWatermarkBuffer(original);
  if (!verified.valid || !verified.shaMatch || !verified.payload) {
    throw new WatermarkPreservationError("原图的 LFN 水印无效或图片已被修改，无法保留有效溯源水印，请下载原图。");
  }
  const source = verified.payload;
  const keys = await getKeyPair();
  const container = readWatermarkContainer(cleaned);
  // Use an explicit allowlist: prompt/seed/reference data in the old signed
  // parameters must not survive the user's metadata-removal request.
  const payload: WatermarkPayload = {
    schema: "lfn-watermark-v2",
    keyId: keys.keyId,
    imageId: source.imageId,
    requestId: source.requestId,
    requestFingerprint: source.requestFingerprint,
    sha256: calculateImageHash(container.unsigned),
    timestamp: source.timestamp,
    userId: source.userId,
    model: source.model,
    domain: source.domain,
    issuer: source.issuer,
    label: source.label,
    note: source.note,
    source: source.source,
    metadataStripped: true,
    sourceSha256: source.sourceSha256 || source.sha256,
  };
  // Preserving an existing signature is independent of whether signing new
  // generations has since been disabled in settings.
  return signWatermark(container, payload, keys);
}

function signWatermark(container: WatermarkContainer, payload: WatermarkPayload, keys: KeyPair): Buffer {
  const signer = createSign("RSA-SHA256");
  signer.update(stableJson(payload));
  const signature = signer.sign(keys.privateKey, "base64");
  const watermark = Buffer.from(JSON.stringify({ payload, signature }), "utf8").toString("base64");
  return container.embed(watermark);
}

export async function getPublicKey(): Promise<string> {
  return (await getKeyPair()).publicKey;
}
