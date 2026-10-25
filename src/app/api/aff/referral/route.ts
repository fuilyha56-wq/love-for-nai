import { NextResponse } from "next/server";
import {
  canonicalReferralLink,
  referralForInviter,
  referralInvitedCount,
  referralReward,
} from "@/lib/referral";
import { getSession } from "@/lib/session";
import { getRuntimeSettings } from "@/lib/runtime-config";
import { resolvedAuthProviderId } from "@/lib/platform";
import { prepareNewApiReferral } from "@/lib/newapi-registration";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看邀请链接", sessionExpired: true },
      { status: 401 },
    );
  const settings = await getRuntimeSettings();
  if (!settings.enableReferral)
    return NextResponse.json({
      enabled: false,
      disabled: true,
      link: null,
      registrationReward: 0,
    });
  if ((await resolvedAuthProviderId()) === "newapi") {
    try {
      await prepareNewApiReferral(session);
    } catch {
      return NextResponse.json(
        { message: "邀请链接暂时无法准备，请稍后重试" },
        { status: 503 },
      );
    }
  }
  const referral = await referralForInviter(session.userId);
  const configuredOrigin = settings.publicUrl.replace(/\/$/, "");
  const requestOrigin = new URL(request.url).origin;
  const origin = configuredOrigin || requestOrigin;
  return NextResponse.json({
    enabled: true,
    code: referral.code,
    link: canonicalReferralLink(origin, referral.code),
    invitedCount: referralInvitedCount(referral),
    registrationReward: await referralReward(),
  });
}
