import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listRedemptionHistory } from "@/lib/redeem-codes";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录", sessionExpired: true }, { status: 401 });
  return NextResponse.json({ items: await listRedemptionHistory(session.userId) });
}
