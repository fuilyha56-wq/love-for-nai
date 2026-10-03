import { NextResponse } from "next/server";
import { getGalleryItem, publicGalleryItem } from "@/lib/gallery";
import { getSession } from "@/lib/session";

// 详情接口仅公开已审核投稿；投稿者仍可查看自己的待审/拒绝/撤回记录。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const item = await getGalleryItem((await params).id);
  const session = await getSession();
  if (!item || (item.status !== "approved" && session?.userId !== item.ownerId))
    return NextResponse.json({ message: "作品不存在" }, { status: 404 });
  return NextResponse.json({
    item: {
      ...publicGalleryItem(item),
      imageUrl: `/api/gallery/${item.id}/image`,
    },
  });
}
