import "server-only";

import { createHash, sign, verify } from "node:crypto";
import { getRuntimeSettings } from "@/lib/runtime-config";
import { readWatermarkContainer, type WatermarkImageMime } from "./image-watermark-container";
import { legacyWatermarkVerificationKey, watermarkSigningKey, watermarkVerificationKey } from "./image-watermark-keys";

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
  required?: boolean;
  source?: "gateway";
  sampleOffset?: number;
};

const V2_TYPE = "lfn-image-provenance+jws";
const MAX_V2_PROOF_LENGTH = 16_384;

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

function legacyStableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyStableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${legacyStableJson(item)}`).join(",")}}`;
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
    (options.requestFingerprint === undefined || payload.requestFingerprint === options.requestFingerprint);
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
    const keys = await watermarkSigningKey();
    if (container.watermark && !container.duplicate) {
      const prior = await verifyEmbeddedWatermark(container);
      if (prior.valid && prior.payload && sameAttribution(prior.payload, imageId, userId, model, options)) {
        if (!prior.legacy) return { buffer, mime, status: "reused" };
        if (options.source === "gateway" && prior.payload.userId > 0 && prior.payload.source !== "gateway") {
          return { buffer: signWatermark(container, renewClaims(prior.payload, keys.keyId), keys), mime, status: "embedded" };
        }
      }
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
    };
    const signed = signWatermark(container, payload, keys);
    if (options.required) {
      const verified = await verifyEmbeddedWatermark(readWatermarkContainer(signed));
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
  } catch {
    return { valid: false, error: "无效的图片数据" };
  }
}

export async function verifyWatermarkBuffer(buffer: Buffer): Promise<WatermarkVerification> {
  try {
    const container = readWatermarkContainer(buffer);
    if (container.watermark === undefined) return { valid: false, error: "未找到 Love-for-NAI 图片签名" };
    return await verifyEmbeddedWatermark(container);
  } catch {
    return { valid: false, error: "图片签名无法验证" };
  }
}

type WatermarkContainer = ReturnType<typeof readWatermarkContainer>;

function jsonSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeSegment(value: string, encoding: "base64" | "base64url"): Buffer | null {
  const decoded = Buffer.from(value, encoding);
  return decoded.length && decoded.toString(encoding) === value ? decoded : null;
}

function isPayload(value: unknown): value is WatermarkPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (data.schema !== "lfn-watermark-v1" && data.schema !== "lfn-watermark-v2") return false;
  for (const field of ["keyId", "requestId", "model", "domain", "issuer", "label"]) {
    if (typeof data[field] !== "string" || !data[field]) return false;
  }
  if (typeof data.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(data.sha256) ||
      typeof data.timestamp !== "string" || !Number.isFinite(Date.parse(data.timestamp)) ||
      typeof data.userId !== "number" || !Number.isSafeInteger(data.userId) || data.userId < 0) return false;
  for (const field of ["imageId", "requestFingerprint", "note"]) {
    if (data[field] !== undefined && typeof data[field] !== "string") return false;
  }
  return (data.source === undefined || data.source === "gateway") &&
    (data.metadataStripped === undefined || data.metadataStripped === true) &&
    (data.sourceSha256 === undefined || typeof data.sourceSha256 === "string" && /^[0-9a-f]{64}$/.test(data.sourceSha256));
}

async function verifyV2(watermark: string): Promise<WatermarkPayload | null> {
  const segments = watermark.split(".");
  if (segments.length !== 3) return null;
  const [protectedHeader, claims, signature] = segments.map((part) => decodeSegment(part, "base64url"));
  if (!protectedHeader || !claims || signature?.length !== 64) return null;
  const header = JSON.parse(protectedHeader.toString("utf8"));
  if (!header || header.alg !== "Ed25519" || header.typ !== V2_TYPE ||
      typeof header.kid !== "string" || !/^[\w-]{43}$/.test(header.kid) || Object.keys(header).length !== 3) return null;
  const key = await watermarkVerificationKey();
  if (!key || key.keyId !== header.kid ||
      !verify(null, Buffer.from(`${segments[0]}.${segments[1]}`, "ascii"), key.publicKey, signature)) return null;
  const payload: unknown = JSON.parse(claims.toString("utf8"));
  return isPayload(payload) && payload.schema === "lfn-watermark-v2" && payload.keyId === key.keyId &&
    Boolean(payload.imageId) && payload.parameters === undefined ? payload : null;
}

async function verifyLegacy(watermark: string): Promise<WatermarkPayload | null> {
  const envelope = decodeSegment(watermark, "base64");
  if (!envelope) return null;
  const data = JSON.parse(envelope.toString("utf8"));
  if (!isPayload(data?.payload) || typeof data.signature !== "string") return null;
  const key = await legacyWatermarkVerificationKey();
  const signature = decodeSegment(data.signature, "base64");
  if (!key || key.keyId !== data.payload.keyId || !signature) return null;
  const json = data.payload.schema === "lfn-watermark-v2" ? legacyStableJson(data.payload) : JSON.stringify(data.payload);
  return verify("RSA-SHA256", Buffer.from(json), key.publicKey, signature) ? data.payload : null;
}

async function verifyEmbeddedWatermark(container: WatermarkContainer): Promise<WatermarkVerification> {
  try {
    const { watermark, duplicate } = container;
    if (watermark && !duplicate) {
      const legacy = !watermark.includes(".");
      const payload = legacy ? await verifyLegacy(watermark)
        : watermark.length <= MAX_V2_PROOF_LENGTH && container.canonicalCarrier && await verifyV2(watermark);
      if (payload) {
        if (calculateImageHash(container.unsigned) !== payload.sha256)
          return { valid: false, shaMatch: false, error: "图片内容或元数据已被修改" };
        return { valid: true, legacy, shaMatch: true, payload };
      }
    }
  } catch { /* Untrusted files and unavailable keys never produce a valid verdict. */ }
  return { valid: false, error: "图片签名无效" };
}

function renewClaims(source: WatermarkPayload, keyId: string): WatermarkPayload {
  // Never copy arbitrary fields from a historical signature into a new one.
  return {
    schema: "lfn-watermark-v2",
    keyId,
    imageId: source.imageId || source.requestId,
    requestId: source.requestId,
    requestFingerprint: source.requestFingerprint,
    sha256: source.sha256,
    timestamp: source.timestamp,
    userId: source.userId,
    model: source.model,
    domain: source.domain,
    issuer: source.issuer,
    label: source.label,
    note: source.note,
    source: source.source,
    metadataStripped: source.metadataStripped,
    sourceSha256: source.sourceSha256,
  };
}

/** Retain authenticated provenance, without retaining generation parameters or blessing modified inputs. */
export async function preserveWatermarkAfterMetadataStrip(original: Buffer, cleaned: Buffer): Promise<Buffer> {
  if (!hasEmbeddedWatermark(original)) return cleaned;
  const verified = await verifyWatermarkBuffer(original);
  if (!verified.valid || !verified.shaMatch || !verified.payload) {
    throw new WatermarkPreservationError("原图的 LFN 水印无效或图片已被修改，无法保留有效溯源水印，请下载原图。");
  }
  const source = verified.payload;
  const keys = await watermarkSigningKey();
  const container = readWatermarkContainer(cleaned);
  const payload: WatermarkPayload = {
    ...renewClaims(source, keys.keyId),
    sha256: calculateImageHash(container.unsigned),
    metadataStripped: true,
    sourceSha256: source.sourceSha256 || source.sha256,
  };
  // Preserving an existing signature is independent of whether signing new
  // generations has since been disabled in settings.
  return signWatermark(container, payload, keys);
}

function signWatermark(container: WatermarkContainer, payload: WatermarkPayload, key: Awaited<ReturnType<typeof watermarkSigningKey>>): Buffer {
  const header = { alg: "Ed25519", typ: V2_TYPE, kid: key.keyId };
  const input = `${jsonSegment(header)}.${jsonSegment(payload)}`;
  const signature = sign(null, Buffer.from(input, "ascii"), key.privateKey).toString("base64url");
  const proof = `${input}.${signature}`;
  if (!isPayload(payload) || !payload.imageId || proof.length > MAX_V2_PROOF_LENGTH) throw new Error("Invalid V2 watermark claims");
  return container.embed(proof);
}
