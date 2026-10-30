import { NextResponse } from "next/server";
import { getGalleryItem, publicGalleryItem, updateGalleryPublication } from "@/lib/gallery";
import { getSession } from "@/lib/session";
import { requireAdmin } from "@/lib/admin-auth";
import type { GalleryPublicationInput } from "@/lib/gallery-publication";
import { parseJsonBody } from "@/lib/request";

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
  }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ message: "请先登录" }, { status: 401 });
  try {
    const body = await parseJsonBody<GalleryPublicationInput & { requireLikeForParameters?: boolean }>(request);
    const item = await updateGalleryPublication(session.userId, (await params).id, body);
    return Response.json({ item: { ...publicGalleryItem(item, session.userId), imageUrl: `/api/gallery/${item.id}/image` }, message: "公开方式已更新，作品重新进入审核；本活动旧成绩不带入新榜单。" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "修改失败" }, { status: 400 }); }
}
