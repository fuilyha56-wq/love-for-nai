import { NextResponse } from "next/server";
import { toggleGalleryLike } from "@/lib/gallery";
import { getSession } from "@/lib/session";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后点赞" }, { status: 401 });
  try { return NextResponse.json(await toggleGalleryLike((await params).id, session.userId)); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "点赞失败" }, { status: 404 }); }
}