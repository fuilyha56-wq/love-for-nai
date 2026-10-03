import { NextResponse } from "next/server";
import {
  MAX_GALLERY_IMAGE_BYTES,
  listGallery,
  publishFromHistory,
  publishLocalImage,
  assertGalleryRating,
  GallerySource,
} from "@/lib/gallery";
import { getSession } from "@/lib/session";

export async function GET() {
  return NextResponse.json({ items: (await listGallery()).map((item) => ({ ...item, imageUrl: `/api/gallery/${item.id}/image` })) });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  try {
    const contentType = request.headers.get("content-type") || "";
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_GALLERY_IMAGE_BYTES + 2 * 1024 * 1024)
      return NextResponse.json({ message: "投稿请求体过大，图片不能超过 20 MB" }, { status: 413 });
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("请选择图片文件");
      if (file.size > MAX_GALLERY_IMAGE_BYTES) return NextResponse.json({ message: "图片不能超过 20 MB" }, { status: 413 });
      const source = String(form.get("source") || "local");
      const parameters = JSON.parse(String(form.get("parameters") || "{}")) as Record<string, unknown>;
      const item = await publishLocalImage(session.userId, session.displayName || session.username, Buffer.from(await file.arrayBuffer()), file.name, {
        title: String(form.get("title") || ""), authorName: String(form.get("authorName") || ""), rating: assertGalleryRating(form.get("rating")),
        source: source === "other" ? "other" : "local", tags: String(form.get("tags") || "").split(","),
        prompt: String(form.get("prompt") || ""), negativePrompt: String(form.get("negativePrompt") || ""), parameters,
      });
      return NextResponse.json({ item: { ...item, imageUrl: `/api/gallery/${item.id}/image` } });
    }
    if (declaredLength > 256 * 1024) return NextResponse.json({ message: "投稿请求体过大" }, { status: 413 });
    const body = (await request.json()) as Record<string, unknown>;
    const item = await publishFromHistory(session.userId, session.displayName || session.username, String(body.historyId || ""), {
      title: String(body.title || ""), authorName: String(body.authorName || ""), rating: assertGalleryRating(body.rating),
      source: ["other", "lfn", "local"].includes(body.source as string) ? body.source as GallerySource : "lfn",
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
      exposeParameters: body.exposeParameters !== false,
    });
    return NextResponse.json({ item: { ...item, imageUrl: `/api/gallery/${item.id}/image` } });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "发布失败" }, { status: 400 }); }
}
