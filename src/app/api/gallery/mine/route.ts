import { NextResponse } from "next/server";
import { listGalleryMine, resubmitGalleryItem, withdrawGalleryItem } from "@/lib/gallery";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const items = (await listGalleryMine(session.userId)).map((item) => ({ ...item, imageUrl: `/api/gallery/${item.id}/image` }));
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  try {
    const body = (await request.json()) as { id?: unknown; action?: unknown; note?: unknown };
    const id = String(body.id || "");
    const action = body.action === "withdraw" ? "withdraw" : "resubmit";
    const item = action === "withdraw"
      ? await withdrawGalleryItem(session.userId, id)
      : await resubmitGalleryItem(session.userId, id, typeof body.note === "string" ? body.note : undefined);
    return NextResponse.json({ item: { ...item, imageUrl: `/api/gallery/${item.id}/image` } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "操作失败" }, { status: 400 });
  }
}
