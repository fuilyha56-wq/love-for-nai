import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  assertGalleryRating,
  deleteGalleryItem,
  updateGalleryItem,
} from "@/lib/gallery";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const { id } = await params;
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  try {
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : typeof raw.tags === "string"
        ? raw.tags.split(/[,，]/)
        : undefined;
    const item = await updateGalleryItem(id, {
      title: optionalString(raw.title),
      authorName: optionalString(raw.authorName),
      rating: raw.rating === undefined ? undefined : assertGalleryRating(raw.rating),
      tags,
    });
    return NextResponse.json({
      item: { ...item, imageUrl: `/api/gallery/${item.id}/image` },
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "保存失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const removed = await deleteGalleryItem((await params).id);
  if (!removed) return NextResponse.json({ message: "作品不存在" }, { status: 404 });
  return NextResponse.json({ success: true });
}
