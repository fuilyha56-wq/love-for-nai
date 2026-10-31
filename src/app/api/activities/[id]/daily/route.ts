import { getSession } from "@/lib/session";
import { listCreatorRewardCampaigns } from "@/lib/creator-rewards";
import { dailyTaskStatus, enrollDailyTasks } from "@/lib/daily-tasks";

const headers = { "Cache-Control": "private, no-store" };
async function campaignFor(id: string) {
  return (await listCreatorRewardCampaigns()).find(
    (c) =>
      c.id === id &&
      c.settlementMode === "daily" &&
      c.enabled &&
      c.publicVisible !== false,
  );
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const campaign = await campaignFor((await params).id);
  if (!campaign)
    return Response.json(
      { message: "日常活动不存在" },
      { status: 404, headers },
    );
  const session = await getSession();
  return Response.json(await dailyTaskStatus(campaign, session?.userId), {
    headers,
  });
}
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return Response.json({ message: "请先登录" }, { status: 401, headers });
  const campaign = await campaignFor((await params).id);
  if (!campaign)
    return Response.json(
      { message: "日常活动不存在" },
      { status: 404, headers },
    );
  try {
    await enrollDailyTasks(campaign.id, session.userId);
    return Response.json(await dailyTaskStatus(campaign, session.userId), {
      headers,
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "报名失败" },
      { status: 400, headers },
    );
  }
}
