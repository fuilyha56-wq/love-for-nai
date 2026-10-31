"use client";
import type { CreatorRewardCampaign } from "@/lib/creator-rewards";
import { defaultDailyTasks } from "@/lib/activity-config";
import { DailyTaskCard } from "@/app/studio/daily-task-card";

export function DailyTaskPreview({
  campaign,
}: {
  campaign: CreatorRewardCampaign;
}) {
  const daily = campaign.dailyTasks || defaultDailyTasks;
  return (
    <DailyTaskCard
      key={JSON.stringify([campaign.name, daily])}
      campaignId={campaign.id}
      name={campaign.name}
      preview
      initial={{
        day: "",
        resetsAt: "",
        active: true,
        authenticated: true,
        enrolled: false,
        enrollmentGranted: false,
        enrollmentAmount: daily.enrollmentReward,
        count: 0,
        target: daily.generationTarget,
        generationAmount: daily.generationReward,
        generationGranted: false,
        rankingRewards: daily.rankingRewards,
        rank: null,
        likes: 0,
        rankingAmount: 0,
        yesterday: null,
      }}
    />
  );
}
export function DailyControls({
  campaign,
  onChange,
}: {
  campaign: CreatorRewardCampaign;
  onChange: (patch: Partial<CreatorRewardCampaign>) => void;
}) {
  const daily = campaign.dailyTasks || defaultDailyTasks;
  const edit = (patch: Partial<typeof daily>) =>
    onChange({ dailyTasks: { ...daily, ...patch } });
  return (
    <section className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <h3 className="font-semibold">日常任务奖励</h3>
      <p className="text-xs leading-6 text-[var(--muted)]">
        北京时间每日 00:00
        刷新。报名奖每账号一次，生成达标自动发放，日榜每位作者以当日获赞最多的作品参榜。与投稿奖、周榜和限时活动分别结算。
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ["enrollmentReward", "初始奖励（AFF）"],
            ["generationTarget", "每日成功生成目标（张）"],
            ["generationReward", "每日生成奖励（AFF）"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-xs font-semibold">
            {label}
            <input
              type="number"
              min={key === "generationTarget" ? 1 : 0}
              max={key === "generationTarget" ? 1000 : 10_000_000}
              step={1}
              className="field mt-1.5 w-full p-2.5"
              value={daily[key]}
              onChange={(event) => edit({ [key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Gallery 每日排名奖励</h4>
        <button
          type="button"
          className="lfn-button"
          disabled={daily.rankingRewards.length >= 20}
          onClick={() => edit({ rankingRewards: [...daily.rankingRewards, 0] })}
        >
          添加名次
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {daily.rankingRewards.map((amount, index) => (
          <label key={index} className="text-xs font-semibold">
            第 {index + 1} 名（AFF）
            <input
              type="number"
              min={0}
              max={10_000_000}
              step={1}
              value={amount}
              className="field mt-1.5 w-full p-2.5"
              onChange={(event) =>
                edit({
                  rankingRewards: daily.rankingRewards.map((value, rank) =>
                    rank === index ? Number(event.target.value) : value,
                  ),
                })
              }
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="lfn-button"
        disabled={daily.rankingRewards.length <= 1}
        onClick={() =>
          edit({ rankingRewards: daily.rankingRewards.slice(0, -1) })
        }
      >
        移除最后一个名次
      </button>
      <p className="text-xs leading-6 text-[var(--muted)]">
        报名与生成奖励金额在报名、当日首次生成时固定，日榜奖励在结榜时固定。已入账的奖励不会因配置修改重复发放；失败会自动重试。自赞不计，同赞按作品投稿时间较早、作品
        ID 排序。
      </p>
    </section>
  );
}
