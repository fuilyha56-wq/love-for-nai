import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MAX_IMAGE_BODY_BYTES } from "@/lib/image-request";
import { detectWatermarkImageMime, signImageWatermark, WatermarkSigningError } from "@/lib/image-watermark";
import { InvalidWatermarkImageError } from "@/lib/image-watermark-container";

export const runtime = "nodejs";

async function signerToken(): Promise<string | undefined> {
  const file = process.env.LFN_WATERMARK_SIGNER_TOKEN_FILE;
  const token = file ? (await readFile(file, "utf8").catch(() => "")).trim()
    : process.env.LFN_WATERMARK_SIGNER_TOKEN?.trim();
  return token && /^[\x21-\x7e]{1,512}$/.test(token) ? token : undefined;
}

function matchesToken(header: string | null, expected: string): boolean {
  const supplied = header?.match(/^Bearer (\S+)$/i)?.[1];
  if (!supplied) return false;
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
}

async function readImage(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts, size);
      size += value.length;
      if (size > MAX_IMAGE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(`x-lfn-watermark-${name}`);
  return value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : undefined;
}

function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const token = await signerToken();
  if (!token) return fail("Not found", 404);
  if (!matchesToken(request.headers.get("authorization"), token)) return fail("Unauthorized", 401);

  const requestId = headerValue(request, "request-id");
  const model = headerValue(request, "model");
  const imageId = request.headers.has("x-lfn-watermark-image-id") ? headerValue(request, "image-id") : requestId;
  if (!requestId || !model || !imageId) return fail("Invalid watermark attribution", 400);

  const type = request.headers.get("content-type")?.toLowerCase().split(";", 1)[0].trim();
  if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") return fail("Unsupported image type", 415);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_IMAGE_BODY_BYTES)) return fail("Image too large", 413);

  let bytes: Buffer | null;
  try {
    bytes = await readImage(request);
  } catch {
    return fail("Unable to read image", 400);
  }
  if (bytes === null) return fail("Image too large", 413);
  if (detectWatermarkImageMime(bytes) !== type) return fail("Image does not match content type", 415);

  try {
    const signed = await signImageWatermark(bytes, imageId, 0, model, { requestId, required: true, source: "gateway" });
    return new Response(new Uint8Array(signed.buffer), {
      headers: { "Content-Type": signed.mime, "Cache-Control": "no-store", "X-LFN-Watermark": signed.status },
    });
  } catch (error) {
    if (error instanceof WatermarkSigningError && error.cause instanceof InvalidWatermarkImageError) {
      return fail("Invalid image container", 415);
    }
    return fail("Image watermark unavailable", 503);
  }
}
