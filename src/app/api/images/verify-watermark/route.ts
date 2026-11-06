import { MAX_IMAGE_BODY_BYTES } from "@/lib/image-request";
import { detectWatermarkImageMime, verifyWatermarkBuffer } from "@/lib/image-watermark";
import { readWatermarkUpload } from "@/lib/image-watermark-upload";
import { findHistory, findHistoryByRequestId } from "@/lib/history";
import { findRequestAudit } from "@/lib/request-audit";

export const runtime = "nodejs";

const JSON_UPLOAD_LIMIT = 4 * Math.ceil(MAX_IMAGE_BODY_BYTES / 3) + 4096;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function json(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const legacyJson = contentType === "application/json";
  if (!legacyJson && (!contentType || !IMAGE_TYPES.has(contentType)))
    return json({ valid: false, error: "请选择 PNG、JPEG 或 WebP 图片" }, 415);

  let bytes: Buffer | null;
  let imageType = contentType;
  try {
    bytes = await readWatermarkUpload(request, legacyJson ? JSON_UPLOAD_LIMIT : MAX_IMAGE_BODY_BYTES);
    if (bytes && legacyJson) {
      const { image } = JSON.parse(bytes.toString("utf8"));
      const data = typeof image === "string" && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
      if (!data) return json({ valid: false, error: "无效的图片数据" }, 400);
      imageType = data[1].toLowerCase();
      bytes = Buffer.from(data[2], "base64");
    }
  } catch {
    return json({ valid: false, error: "无法读取图片" }, 400);
  }
  if (!bytes || bytes.length > MAX_IMAGE_BODY_BYTES)
    return json({ valid: false, error: "图片超过 25 MiB" }, 413);
  if (!bytes.length || detectWatermarkImageMime(bytes) !== imageType)
    return json({ valid: false, error: "无效的图片数据" }, 400);

  const result = await verifyWatermarkBuffer(bytes);
  if (!result.valid || !result.shaMatch || !result.payload) return json({ valid: false, shaMatch: result.shaMatch, error: result.error });

  const { schema, requestId, sha256, timestamp, model, domain, issuer, label, source, metadataStripped, userId, imageId } = result.payload;
  const recordFound = await Promise.all([
    findRequestAudit(requestId),
    userId ? (imageId ? findHistory(userId, imageId) : findHistoryByRequestId(userId, requestId)) : null,
  ]).then(([audit, history]) => Boolean(audit || history), () => undefined);

  return json({
    valid: true,
    shaMatch: true,
    legacy: result.legacy,
    recordFound,
    payload: { schema, requestId, sha256, timestamp, model, domain, issuer, label, source, metadataStripped },
  });
}
