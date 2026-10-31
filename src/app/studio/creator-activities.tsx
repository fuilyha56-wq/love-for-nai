import Link from "next/link";
import Image from "next/image";
import { publicCreatorRewardCampaigns } from "@/lib/creator-rewards";
import { MarkdownView } from "@/app/markdown";
import { getSession } from "@/lib/session";
import { dailyTaskStatus } from "@/lib/daily-tasks";
import { DailyTaskCard } from "./daily-task-card";
export async function CreatorActivities() {
  const campaigns = await publicCreatorRewardCampaigns();
  const session = await getSession();
  const dailyStatuses = new Map(await Promise.all(campaigns.filter(c => c.settlementMode === "daily" && c.dailyTasks).map(async c => [c.id, await dailyTaskStatus(c, session?.userId)] as const)));
  const format = (value?: string) =>
    value
      ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
      : "不限";
  return (
    <section
      id="activities"
      className="scroll-mt-6 rounded-lg border border-[var(--line)] bg-white p-5 sm:p-6"
    >
      <h2 className="mb-4 text-xl font-semibold">创作活动</h2>{" "}
      <div className="space-y-5">
        {campaigns.map((campaign) => (
          campaign.settlementMode === "daily" && dailyStatuses.has(campaign.id) ? <DailyTaskCard key={campaign.id} campaignId={campaign.id} name={campaign.name} initial={dailyStatuses.get(campaign.id)!} /> :
          <article
            key={campaign.id}
            id={campaign.id}
            className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-7"
          >
            {campaign.coverUrl && (
              <Image
                src={campaign.coverUrl}
                alt={campaign.name}
                width={1200}
                height={720}
                unoptimized
                className="mb-5 max-h-72 w-full rounded-lg object-cover"
              />
            )}
            <div className="flex flex-wrap justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold">{campaign.name}</h2>{campaign.featured && <span className="rounded-full bg-[var(--rose)] px-2.5 py-1 text-[10px] font-semibold text-white">精选</span>}</div>
              <span className="text-xs text-[var(--rose)]">{campaign.phase}</span>
            </div>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {campaign.summary}
            </p>
            <p className="my-4 text-xs text-[var(--muted)]">
              {format(campaign.startsAt)} → {format(campaign.endsAt)} · 北京时间
            </p>
            {campaign.description && (
              <MarkdownView content={campaign.description} />
            )}
            {campaign.rules && (
              <div className="mt-5">
                <h3 className="mb-2 font-semibold">参与规则</h3>
                <MarkdownView content={campaign.rules} />
              </div>
            )}
            {campaign.settlementMode === "deadline" ? <div className="mt-5 space-y-3 rounded-lg bg-[var(--surface-muted)] p-4 text-sm">
              <p>综合分 = 有效点赞 × {campaign.scoring?.likes} + 有效导入 × {campaign.scoring?.imports}</p>
              {campaign.boards?.map(board => <p key={board.id}><strong>{board.name}</strong>：{board.rewards.map((amount, rank) => `第 ${rank + 1} 名 ${amount} AFF`).join(" · ")} · 安慰奖 {board.consolationReward} AFF</p>)}
              <p>统一发奖：{format(campaign.settlesAt || campaign.endsAt)}（北京时间）</p>
              <Link href={`/gallery/activities?activity=${encodeURIComponent(campaign.id)}`} className="lfn-button">查看活动榜单与实时排名 →</Link>
            </div> : (<div className="mt-5 rounded-lg bg-[var(--surface-muted)] p-4 text-sm">
              <p>审核通过的投稿奖励：{campaign.submissionReward} AFF</p>
              <p className="mt-2">
                周榜奖励：
                {campaign.weeklyRewards
                  .map((amount, rank) => `第 ${rank + 1} 名 ${amount} AFF`)
                  .join(" · ")}
              </p>
              <p className="mt-2">周榜指标：{campaign.weeklyMetric === "downloads" ? "下载数" : campaign.weeklyMetric === "uses" ? "导入使用数" : "点赞数"}，最低 {campaign.minWeeklyMetric ?? campaign.minWeeklyLikes ?? 1}</p>
              {Boolean(campaign.requiredTags?.length || campaign.requiredTag) && (
                <p className="mt-2">必须包含全部标签：{(campaign.requiredTags?.length ? campaign.requiredTags : [campaign.requiredTag]).join("、")}</p>
              )}
              {Boolean(campaign.excludedTags?.length) && (
                <p className="mt-2">排除标签：{campaign.excludedTags?.join("、")}</p>
              )}
              {Boolean(campaign.allowedSources?.length && campaign.allowedSources.length < 3) && (
                <p className="mt-2">允许来源：{campaign.allowedSources?.map((source) => source === "local" ? "本地上传" : source === "lfn" ? "本站生成" : "其他来源").join("、")}</p>
              )}
              {Boolean(campaign.submissionLimitPerUser) && (
                <p className="mt-2">
                  每人最多领取 {campaign.submissionLimitPerUser} 次投稿奖励
                </p>
              )}
              {Boolean(campaign.submissionRewardLimit) && <p className="mt-2">活动投稿奖励总次数上限：{campaign.submissionRewardLimit}</p>}
              {campaign.oneWinnerPerUser && <p className="mt-2">周榜每位用户最多获得一个名次。</p>}
              <p className="mt-2 text-xs text-[var(--muted)]">
                活动预算 {campaign.budget ? `${campaign.budget} AFF` : "不限"}
                。多个活动重叠时按优先级发放一份奖励。
              </p>
            </div>)}

          </article>
        ))}
        {!campaigns.length && (
          <p className="py-16 text-center text-[var(--muted)]">暂无公开活动</p>
        )}
      </div>
    </section>
  );
}
