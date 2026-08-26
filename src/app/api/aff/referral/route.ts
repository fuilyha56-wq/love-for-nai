import { NextResponse } from "next/server";
import { referralForInviter, referralReward } from "@/lib/referral";
import { getSession } from "@/lib/session";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看邀请链接", sessionExpired: true },
      { status: 401 },
    );
  const referral = await referralForInviter(session.userId);
  const configuredOrigin = process.env.LFN_PUBLIC_URL?.replace(/\/$/, "");
  const requestOrigin = new URL(request.url).origin;
  const origin = configuredOrigin || requestOrigin;
  return NextResponse.json({
    code: referral.code,
    link: `${origin}/sign-in?invite=${encodeURIComponent(referral.code)}`,
    invitedCount: referral.registeredUserIds.length,
    registrationReward: referralReward(),
  });
}