import { NextResponse } from "next/server";
import {
  MAX_GALLERY_IMAGE_BYTES,
  queryGallery,
  publishFromHistory,
  publishLocalImage,
  assertGalleryRating,
  GallerySource,
} from "@/lib/gallery";
import { getSession } from "@/lib/session";
import type { GalleryPromptMode, PublicCharacterText } from "@/lib/gallery-publication";
import { listCreatorRewardCampaigns } from "@/lib/creator-rewards";
import { gallerySubmissionOptions, submissionActivityAllows } from "@/lib/gallery-submission-options";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const tags = [...query.getAll("tag"), ...(query.get("tags") || "").split(",")]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
  const numberParam = (value: string | null) => value && /^\d+$/.test(value) ? Number(value) : undefined;
  const result = await queryGallery({
    category: query.get("category") || undefined,
    q: query.get("q") || "",
    tags,
    rating: query.get("rating") || "all",
    sort: query.get("sort") as "newest" | "likes" | "downloads" | "uses" | null || "newest",
    page: numberParam(query.get("page")),
    pageSize: numberParam(query.get("pageSize") || query.get("limit")),
  });
  return NextResponse.json(
    {
      ...result,
      items: result.items.map((item) => ({ ...item, imageUrl: `/api/gallery/${item.id}/image`, thumbnailUrl: `/api/gallery/${item.id}/image?variant=thumbnail` })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  try {
    const contentType = request.headers.get("content-type") || "";
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 2 * MAX_GALLERY_IMAGE_BYTES + 2 * 1024 * 1024)
      return NextResponse.json({ message: "投稿请求体过大，图片不能超过 20 MB" }, { status: 413 });
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const original = form.get("originalFile");
      const historyId = String(form.get("historyId") || "").trim();
      if (!historyId && !(file instanceof File)) throw new Error("请选择修改后的参赛图片");
      if ((file instanceof File && file.size > MAX_GALLERY_IMAGE_BYTES) || (original instanceof File && original.size > MAX_GALLERY_IMAGE_BYTES)) return NextResponse.json({ message: "参赛图和校验原图各不能超过 20 MB" }, { status: 413 });
      const source = String(form.get("source") || "local");
      const input = {
        title: String(form.get("title") || ""), authorName: String(form.get("authorName") || ""), rating: assertGalleryRating(form.get("rating")),
        source: (historyId ? "lfn" : source === "other" ? "other" : "local") as GallerySource, tags: String(form.get("tags") || "").split(/[,，]/),
        prompt: "", negativePrompt: "", parameters: {}, exposeParameters: form.get("exposeParameters") !== "false",
        requireLikeForParameters: form.get("requireLikeForParameters") === "true",
        promptMode: form.get("promptMode") as GalleryPromptMode || undefined,
        partialPrompt: String(form.get("partialPrompt") || ""), partialNegativePrompt: String(form.get("partialNegativePrompt") || ""),
        partialCharacters: JSON.parse(String(form.get("partialCharacters") || "[]")) as PublicCharacterText[], upscaled: form.get("upscaled") === "true",
        originalProofUpload: original instanceof File && original.size ? { data: Buffer.from(await original.arrayBuffer()), fileName: original.name } : undefined,
      };
      if (input.originalProofUpload && !gallerySubmissionOptions(await listCreatorRewardCampaigns()).activities.some(activity => activity.proofBoard && submissionActivityAllows(activity, { ...input, tags: input.tags.join(",") })))
        throw new Error("当前作品未匹配开放原图校验的活动，请移除校验原图或调整活动标签后重新提交。");
      const item = historyId ? await publishFromHistory(session.userId, session.displayName || session.username, historyId, input)
        : await publishLocalImage(session.userId, session.displayName || session.username, Buffer.from(await (file as File).arrayBuffer()), (file as File).name, input);
      return NextResponse.json({ item: { ...item, imageUrl: `/api/gallery/${item.id}/image` } });
    }
    if (declaredLength > 256 * 1024) return NextResponse.json({ message: "投稿请求体过大" }, { status: 413 });
    const body = (await request.json()) as Record<string, unknown>;
    const item = await publishFromHistory(session.userId, session.displayName || session.username, String(body.historyId || ""), {
      title: String(body.title || ""), authorName: String(body.authorName || ""), rating: assertGalleryRating(body.rating),
      source: ["other", "lfn", "local"].includes(body.source as string) ? body.source as GallerySource : "lfn",
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
      exposeParameters: body.exposeParameters !== false,
      requireLikeForParameters: body.requireLikeForParameters === true,
      promptMode: body.promptMode as GalleryPromptMode | undefined,
      partialPrompt: typeof body.partialPrompt === "string" ? body.partialPrompt : "", partialNegativePrompt: typeof body.partialNegativePrompt === "string" ? body.partialNegativePrompt : "",
      partialCharacters: body.partialCharacters as PublicCharacterText[] | undefined, upscaled: body.upscaled === true,
    });
    return NextResponse.json({ item: { ...item, imageUrl: `/api/gallery/${item.id}/image` } });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "发布失败" }, { status: 400 }); }
}
