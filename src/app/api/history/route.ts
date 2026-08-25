import { NextRequest, NextResponse } from "next/server";
import { deleteHistory, listHistory } from "@/lib/history";
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
  }));
  return NextResponse.json({ items });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!(await deleteHistory(session.userId, id)))
    return NextResponse.json({ message: "历史记录不存在" }, { status: 404 });
  return NextResponse.json({ success: true });
}
