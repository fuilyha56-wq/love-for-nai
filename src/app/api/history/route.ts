import { NextRequest, NextResponse } from "next/server";
import { deleteHistories, deleteHistory, listHistory } from "@/lib/history";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看图片历史" },
      { status: 401 },
    );
  const items = (await listHistory(session.userId)).map((item) => ({
    ...item,
    imageUrl: `/api/history/${item.id}/image`,
    thumbnailUrl: `/api/history/${item.id}/image?variant=thumbnail`,
  }));
  return NextResponse.json({ items });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const idsParam = request.nextUrl.searchParams.getAll("id");
  if (idsParam.length > 1) {
    if (idsParam.length > 100) return NextResponse.json({ message: "一次最多删除 100 张图片" }, { status: 413 });
    const count = await deleteHistories(session.userId, idsParam);
    return count ? NextResponse.json({ success: true, count }) : NextResponse.json({ message: "历史记录不存在" }, { status: 404 });
  }
  if (idsParam.length === 1) {
    const deleted = await deleteHistory(session.userId, idsParam[0]);
    return deleted ? NextResponse.json({ success: true, count: 1 }) : NextResponse.json({ message: "历史记录不存在" }, { status: 404 });
  }
  let body: { ids?: unknown } = {};
  try { body = await request.json() as { ids?: unknown }; } catch { /* support the original query-string API */ }
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100 || body.ids.some((id) => typeof id !== "string" || id.length > 100))
    return NextResponse.json({ message: "请选择 1–100 张图片" }, { status: 400 });
  const count = await deleteHistories(session.userId, body.ids as string[]);
  return count ? NextResponse.json({ success: true, count }) : NextResponse.json({ message: "历史记录不存在" }, { status: 404 });
}
