import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { userDisplayNames } from "@/lib/user-display";
import { listReferrals, referralInvitedCount, referralReward } from "@/lib/referral";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const items = await listReferrals();
  const names = await userDisplayNames(items.map((item) => item.inviterUserId));
  const reward = await referralReward();
  const enriched = items.map((item) => {
      return {
        code: item.code, inviterUserId: item.inviterUserId, createdAt: item.createdAt,
        invitedCount: referralInvitedCount(item),
        inviterName: names.get(item.inviterUserId)?.name || `账号 #${item.inviterUserId}`,
      };
    });
  return NextResponse.json({
    items: enriched.sort((a, b) => b.invitedCount - a.invitedCount),
    total: enriched.length,
    reward,
  });
}
