import { NextResponse } from "next/server";
import { affLedger } from "@/lib/aff";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录", sessionExpired: true }, { status: 401 });
  return NextResponse.json(await affLedger(session.userId), { headers: { "Cache-Control": "no-store" } });
}
