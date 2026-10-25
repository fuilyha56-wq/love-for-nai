import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody, optionalNumber, optionalString } from "@/lib/request";
import {
  manuallyGrantCreatorReward,
  settleWeeklyCreatorRewards,
  upsertCreatorRewardCampaign,
  creatorRewardAutomation,
  deleteCreatorRewardCampaign,
  restoreCreatorRewardCampaign,
  creatorRewardStore,
  type CreatorWeeklyMetric,
} from "@/lib/creator-rewards";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const store = await creatorRewardStore();
  const offset = Math.max(0, Math.floor(Number(query.get("offset")) || 0));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(query.get("limit")) || 50)));
  const campaignSpent: Record<string, number> = {};
  for (const grant of store.grants) if (grant.campaignId && grant.status === "granted") campaignSpent[grant.campaignId] = (campaignSpent[grant.campaignId] || 0) + grant.amount;
  return NextResponse.json({ campaigns: store.campaigns.filter((item) => query.get("deleted") === "1" || !item.deletedAt), grants: store.grants.slice(offset, offset + limit), grantTotal: store.grants.length, campaignSpent, automation: creatorRewardAutomation() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const action = optionalString(body.action) || "manual";
    if (action === "restore-campaign") {
      const id = optionalString(body.id);
      if (!id) throw new Error("缺少活动 ID");
      await restoreCreatorRewardCampaign(id);
      return NextResponse.json({ restored: true });
    }
    if (action === "settle-weekly") {
      const result = await settleWeeklyCreatorRewards(optionalString(body.week));
      return NextResponse.json(result);
    }
    if (action === "campaign") {
      if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new Error("活动启用状态必须是布尔值");
      if (body.weeklyRewards !== undefined && (!Array.isArray(body.weeklyRewards) || body.weeklyRewards.length < 1 || body.weeklyRewards.length > 20 || body.weeklyRewards.some((value) => typeof value !== "number")))
        throw new Error("周榜奖励必须填写 1 到 20 个整数");
      if (body.allowedRatings !== undefined && (!Array.isArray(body.allowedRatings) || body.allowedRatings.some((value) => !["general", "r13", "r17", "r18"].includes(String(value))))) throw new Error("作品评级配置无效");
      if (body.allowedSources !== undefined && (!Array.isArray(body.allowedSources) || body.allowedSources.some((value) => !["other", "lfn", "local"].includes(String(value))))) throw new Error("作品来源配置无效");
      for (const key of ["requiredTags", "excludedTags"] as const) {
        if (body[key] !== undefined && (!Array.isArray(body[key]) || body[key].some((value) => typeof value !== "string"))) throw new Error("活动标签配置必须是字符串数组");
      }
      if (body.weeklyMetric !== undefined && !["likes", "downloads", "uses"].includes(String(body.weeklyMetric))) throw new Error("周榜指标配置无效");
      for (const key of ["oneWinnerPerUser", "publicVisible", "featured"] as const) {
        if (body[key] !== undefined && typeof body[key] !== "boolean") throw new Error(`${key} 必须是布尔值`);
      }
      const campaign = await upsertCreatorRewardCampaign({
        id: optionalString(body.id), name: optionalString(body.name), enabled: body.enabled === undefined ? undefined : body.enabled,
        startsAt: optionalString(body.startsAt), endsAt: optionalString(body.endsAt), submissionReward: optionalNumber(body.submissionReward),
        weeklyRewards: Array.isArray(body.weeklyRewards) ? body.weeklyRewards.filter((value): value is number => typeof value === "number") as [number, number, number] : undefined,
        budget: optionalNumber(body.budget),
        summary: optionalString(body.summary), description: optionalString(body.description), rules: optionalString(body.rules), coverUrl: optionalString(body.coverUrl), requiredTag: optionalString(body.requiredTag),
        requiredTags: body.requiredTags as string[] | undefined, excludedTags: body.excludedTags as string[] | undefined,
        allowedRatings: body.allowedRatings as ("general" | "r13" | "r17" | "r18")[] | undefined,
        allowedSources: body.allowedSources as ("other" | "lfn" | "local")[] | undefined,
        weeklyMetric: optionalString(body.weeklyMetric) as CreatorWeeklyMetric | undefined,
        minWeeklyLikes: optionalNumber(body.minWeeklyLikes), minWeeklyMetric: optionalNumber(body.minWeeklyMetric),
        submissionLimitPerUser: optionalNumber(body.submissionLimitPerUser), submissionRewardLimit: optionalNumber(body.submissionRewardLimit),
        oneWinnerPerUser: body.oneWinnerPerUser as boolean | undefined, publicVisible: body.publicVisible as boolean | undefined, featured: body.featured as boolean | undefined,
        priority: optionalNumber(body.priority),
      });
      return NextResponse.json({ campaign });
    }
    if (action === "auto-settle") {
      const result = await settleWeeklyCreatorRewards();
      return NextResponse.json({ ...result, automation: creatorRewardAutomation() });
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

export async function DELETE(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const id = optionalString(body.id);
    if (!id) throw new Error("缺少活动 ID");
    await deleteCreatorRewardCampaign(id);
    return NextResponse.json({ deleted: true, id });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "删除活动失败" }, { status: 400 }); }
}
