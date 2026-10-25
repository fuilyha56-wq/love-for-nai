import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { stripImageMetadata } from "@/lib/image-processing";
import { MAX_IMAGE_BODY_BYTES } from "@/lib/image-request";
import { getSession } from "@/lib/session";
import { hasEmbeddedWatermark, WatermarkPreservationError } from "@/lib/image-watermark";
import { findWatermarkedHistorySource } from "@/lib/history";

const formats: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BODY_BYTES)
    return NextResponse.json({ message: "图片超过 25 MiB，无法清理元数据" }, { status: 413 });
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const extension = formats[contentType];
  if (!extension) return NextResponse.json({ message: "只支持 PNG、JPEG 或 WebP 图片" }, { status: 415 });
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BODY_BYTES)
      return NextResponse.json({ message: "图片为空或超过 25 MiB" }, { status: bytes.length ? 413 : 400 });
    const signedOriginal = hasEmbeddedWatermark(bytes) ? null : await findWatermarkedHistorySource(
      session.userId, createHash("sha256").update(bytes).digest("hex"),
    );
    const cleaned = await stripImageMetadata(signedOriginal || bytes, `image.${extension}`);
    return new NextResponse(new Uint8Array(cleaned.data), {
      headers: {
        "Content-Type": cleaned.extension === "jpg" ? "image/jpeg" : `image/${cleaned.extension}`,
        "Cache-Control": "private, no-store",
        "X-LFN-Image-Metadata": "stripped",
      },
    });
  } catch (error) {
    if (error instanceof WatermarkPreservationError)
      return NextResponse.json({ message: error.message }, { status: 422 });
    return NextResponse.json({ message: "图片无法解码，元数据清理失败" }, { status: 400 });
  }
}
