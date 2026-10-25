import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listUserNotifications, markUserNotificationRead } from "@/lib/notifications";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 100;
  return NextResponse.json(await listUserNotifications(session.userId, limit), { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: unknown; all?: unknown } | null;
  if (!body || (body.all !== true && typeof body.id !== "string"))
    return NextResponse.json({ message: "请指定要标记已读的消息" }, { status: 400 });
  const result = await markUserNotificationRead(session.userId, body.all === true ? undefined : body.id as string);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
