import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody, optionalNumber, optionalString } from "@/lib/request";
import {
  listCreatorRewardCampaigns,
  listCreatorRewardGrants,
  manuallyGrantCreatorReward,
  settleWeeklyCreatorRewards,
  upsertCreatorRewardCampaign,
} from "@/lib/creator-rewards";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  return NextResponse.json({ campaigns: await listCreatorRewardCampaigns(), grants: await listCreatorRewardGrants() });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const action = optionalString(body.action) || "manual";
    if (action === "settle-weekly") {
      const result = await settleWeeklyCreatorRewards(optionalString(body.week));
      return NextResponse.json(result);
    }
    if (action === "campaign") {
      const campaign = await upsertCreatorRewardCampaign({
        id: optionalString(body.id), name: optionalString(body.name), enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
        startsAt: optionalString(body.startsAt), endsAt: optionalString(body.endsAt), submissionReward: optionalNumber(body.submissionReward),
        weeklyRewards: Array.isArray(body.weeklyRewards) ? body.weeklyRewards.filter((value): value is number => typeof value === "number") as [number, number, number] : undefined,
        budget: optionalNumber(body.budget),
      });
      return NextResponse.json({ campaign });
    }
    const userId = optionalNumber(body.userId);
    const amount = optionalNumber(body.amount);
    if (!userId || amount === undefined) return NextResponse.json({ message: "缺少 userId 或 amount" }, { status: 400 });
    const grant = await manuallyGrantCreatorReward({
      userId, amount, description: optionalString(body.description), referenceId: optionalString(body.referenceId), actorId: gate.session.userId,
    });
    return NextResponse.json({ grant });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "奖励操作失败" }, { status: 400 });
  }
}
