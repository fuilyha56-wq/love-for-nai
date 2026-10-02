import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { findLocalUserById } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import { listReferrals, referralInvitedCount, referralReward } from "@/lib/referral";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const items = await listReferrals();
  const local = (await resolvedAuthProviderId()) === "local";
  const enriched = await Promise.all(
    items.map(async (item) => {
      const inviter = local ? await findLocalUserById(item.inviterUserId) : null;
      return {
        ...item,
        invitedCount: referralInvitedCount(item),
        inviterName: inviter?.displayName || inviter?.username,
        reward: await referralReward(),
      };
    }),
  );
  return NextResponse.json({
    items: enriched.sort((a, b) => b.invitedCount - a.invitedCount),
    total: enriched.length,
    reward: await referralReward(),
  });
}
