import { NextResponse } from "next/server";
import { getGalleryItem, publicGalleryItem } from "@/lib/gallery";
import { getSession } from "@/lib/session";
import { requireAdmin } from "@/lib/admin-auth";

// 详情接口仅公开已审核投稿；投稿者仍可查看自己的待审/拒绝/撤回记录。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const item = await getGalleryItem((await params).id);
  const session = await getSession();
  if (!item || (item.status !== "approved" && session?.userId !== item.ownerId && "error" in await requireAdmin()))
    return NextResponse.json({ message: "作品不存在" }, { status: 404 });
  return NextResponse.json({
    item: {
      ...publicGalleryItem(item, session?.userId),
      imageUrl: `/api/gallery/${item.id}/image`,
    },
  }, { headers: { "Cache-Control": item.status === "approved" && !session && !item.requireLikeForParameters ? "public, max-age=30, stale-while-revalidate=120" : "private, no-store", Vary: "Cookie" } });
}
