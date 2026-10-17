import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { parseJsonBody, optionalString } from "@/lib/request";
import { redeemCode, hasLfnRedeemCode } from "@/lib/redeem-codes";
import { redeemNewApiCode } from "@/lib/newapi-redemptions";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录", sessionExpired: true },
      { status: 401 },
    );
  try {
    const body = await parseJsonBody<{ code?: unknown }>(request);
    const code = optionalString(body.code) || "";
    if (!(await hasLfnRedeemCode(code)))
      return NextResponse.json(await redeemNewApiCode(code, session));
    const result = await redeemCode(code, session.userId);
    return NextResponse.json({
      ...result,
      source: "lfn",
      message: result.alreadyRedeemed
        ? "你已经兑换过该兑换码"
        : "兑换成功，奖励已进入个人 AFF",
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "兑换失败" },
      { status: 400 },
    );
  }
}
