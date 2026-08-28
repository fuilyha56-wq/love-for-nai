import { NextResponse } from "next/server";
import { getGalleryItem } from "@/lib/gallery";

// 详情接口公开访问，分享链接无需登录即可查看。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const item = await getGalleryItem((await params).id);
  if (!item)
    return NextResponse.json({ message: "作品不存在" }, { status: 404 });
  return NextResponse.json({
    item: {
      ...item,
      likedBy: [],
      weeklyLikes: undefined,
      imageUrl: `/api/gallery/${item.id}/image`,
      ...(Object.keys(item.parameters).length
        ? {}
        : { prompt: "", negativePrompt: "" }),
    },
  });
}
