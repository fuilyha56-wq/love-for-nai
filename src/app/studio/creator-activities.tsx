import { publicCreatorRewardCampaigns } from "@/lib/creator-rewards";
import { MarkdownView } from "@/app/markdown";
export async function CreatorActivities() {
  const campaigns = await publicCreatorRewardCampaigns();
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
          <article
            key={campaign.id}
            id={campaign.id}
            className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-7"
          >
            {campaign.coverUrl && (
              <img
                src={campaign.coverUrl}
                alt={campaign.name}
                className="mb-5 max-h-72 w-full rounded-lg object-cover"
              />
            )}
            <div className="flex flex-wrap justify-between gap-3">
              <h2 className="text-2xl font-semibold">{campaign.name}</h2>
              <span className="text-xs text-[var(--rose)]">
                {campaign.phase}
              </span>
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
            <div className="mt-5 rounded-lg bg-[var(--surface-muted)] p-4 text-sm">
              <p>审核通过的投稿奖励：{campaign.submissionReward} AFF</p>
              <p className="mt-2">
                周榜奖励：
                {campaign.weeklyRewards
                  .map((amount, rank) => `第 ${rank + 1} 名 ${amount} AFF`)
                  .join(" · ")}
              </p>
              {Boolean(campaign.requiredTag) && (
                <p className="mt-2">指定标签：{campaign.requiredTag}</p>
              )}
              {Boolean(campaign.submissionLimitPerUser) && (
                <p className="mt-2">
                  每人最多领取 {campaign.submissionLimitPerUser} 次投稿奖励
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--muted)]">
                活动预算 {campaign.budget ? `${campaign.budget} AFF` : "不限"}
                。多个活动重叠时按优先级发放一份奖励。
              </p>
            </div>
          </article>
        ))}
        {!campaigns.length && (
          <p className="py-16 text-center text-[var(--muted)]">暂无公开活动</p>
        )}
      </div>
    </section>
  );
}
