import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { parseJsonBody, optionalString } from "@/lib/request";
import { redeemCode } from "@/lib/redeem-codes";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录", sessionExpired: true }, { status: 401 });
  try {
    const body = await parseJsonBody<{ code?: unknown }>(request);
    const code = optionalString(body.code) || "";
    const result = await redeemCode(code, session.userId);
    return NextResponse.json({ ...result, message: result.alreadyRedeemed ? "你已经兑换过该兑换码" : "兑换成功" });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "兑换失败" }, { status: 400 });
  }
}
