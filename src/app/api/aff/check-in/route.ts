import { NextResponse } from "next/server";
import { checkInAff } from "@/lib/aff";
import { getSession } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后签到", sessionExpired: true },
      { status: 401 },
    );
  const result = await checkInAff(session.userId);
  return NextResponse.json({ success: true, ...result });
}