"use client";

import { Check, Circle, Trophy } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DailyTaskStatus } from "@/lib/daily-tasks";
import { AffAmount } from "@/app/ui/aff-amount";

export function dailyRewardTiers(rewards: number[]) {
  return rewards.reduce<Array<{ from: number; to: number; amount: number }>>(
    (groups, amount, index) => {
      const previous = groups.at(-1);
      if (previous?.amount === amount) previous.to = index + 1;
      else groups.push({ from: index + 1, to: index + 1, amount });
      return groups;
    },
    [],
  );
}
function TaskState({ complete }: { complete: boolean }) {
  return complete ? (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-emerald-600 text-emerald-600">
      <Check size={12} strokeWidth={2.5} />
    </span>
  ) : (
    <Circle
      size={18}
      className="shrink-0 text-[var(--muted)]"
      aria-hidden="true"
    />
  );
}
export function DailyTaskCard({
  campaignId,
  name,
  initial,
  preview = false,
}: {
  campaignId: string;
  name: string;
  initial: DailyTaskStatus;
  preview?: boolean;
}) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = `/api/activities/${encodeURIComponent(campaignId)}/daily`;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) throw new Error("日常任务更新失败，请刷新后重试。");
      setStatus(await response.json());
    },
    [endpoint],
  );
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const update = () => {
      if (!document.hidden) void refresh(controller.signal).catch(() => {});
    };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [refresh, preview]);
  async function enroll() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "报名失败");
      setStatus(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "报名失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      id={campaignId}
      className="overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--panel)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-6 sm:px-7">
        <h3 className="flex items-center gap-3 text-lg font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-muted)]">
            <Trophy size={17} />
          </span>
          {name} · 规则与奖励
        </h3>
        <span className="text-[11px] text-[var(--muted)]">
          每日 00:00 刷新 · 北京时间
        </span>
      </div>
      <div className="divide-y divide-[var(--line)]">
        <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-5 py-5 sm:px-7">
          <TaskState complete={status.enrollmentGranted} />
          <div>
            <h4 className="text-sm font-medium">初始 AFF</h4>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              报名参与 · 每个账号领取一次
            </p>
          </div>
          <AffAmount
            amount={status.enrollmentAmount}
            className="self-start text-sm font-semibold"
          />
          <div className="col-span-2 col-start-2 mt-1">
            {status.enrollmentGranted ? (
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700">
                已发放 {status.enrollmentAmount} AFF
              </span>
            ) : !status.authenticated ? (
              <Link
                href="/sign-in?next=%2Fstudio%23activities"
                className="lfn-button"
              >
                登录参与
              </Link>
            ) : (
              <button
                type="button"
                disabled={preview || busy || !status.active}
                onClick={() => void enroll()}
                className="lfn-button is-primary"
              >
                {!status.active
                  ? "活动尚未开始或已结束"
                  : busy
                    ? "领取中…"
                    : status.enrolled
                      ? "重试领取"
                      : "报名并领取"}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-5 py-5 sm:px-7">
          <TaskState complete={status.generationGranted} />
          <div>
            <h4 className="text-sm font-medium">日常生成</h4>
            <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
              成功生成 ≥ {status.target} 张 · 每日刷新
            </p>
          </div>
          <AffAmount
            amount={status.generationAmount}
            className="self-start text-sm font-semibold"
          />
          <div className="col-span-2 col-start-2 mt-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
              <span className="tabular-nums">
                {status.count} / {status.target}
              </span>
              <span>
                {status.generationGranted
                  ? "奖励已到账"
                  : status.count >= status.target
                    ? "已达标，奖励发放中"
                    : !status.enrolled
                      ? "报名后开始计数"
                      : "达标自动发放"}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="日常生成进度"
              aria-valuenow={status.count}
              aria-valuemin={0}
              aria-valuemax={status.target}
              className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${status.generationGranted ? "bg-emerald-500" : "bg-[var(--rose)]"}`}
                style={{
                  width: `${Math.min(100, (status.count / status.target) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 gap-y-2 px-5 py-5 sm:grid-cols-[18px_minmax(0,1fr)_auto] sm:px-7">
          <TaskState complete={status.rank !== null} />
          <div>
            <h4 className="text-sm font-medium">排名奖</h4>
            <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
              Gallery 作品当日有效获赞排名 · 每日结算
            </p>
          </div>
          <div className="col-start-2 space-y-1 text-xs sm:col-start-3 sm:row-span-2 sm:row-start-1">
            {dailyRewardTiers(status.rankingRewards).map((tier) => (
              <div
                key={tier.from}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-[var(--muted)]">
                  第 {tier.from}
                  {tier.to !== tier.from ? `–${tier.to}` : ""} 名
                </span>
                <AffAmount amount={tier.amount} />
              </div>
            ))}
          </div>
          <div className="col-start-2 mt-2 text-xs text-[var(--muted)]">
            <p>
              {status.rank
                ? `当前第 ${status.rank} 名 · ${status.likes} 赞 · 预计 ${status.rankingAmount} AFF`
                : "暂未上榜"}
            </p>
            {status.yesterday && (
              <p className="mt-1 text-emerald-700">
                昨日第 {status.yesterday.rank} 名 · {status.yesterday.amount}{" "}
                AFF{status.yesterday.granted ? " 已到账" : " 发放中"}
              </p>
            )}
            <p className="mt-2 leading-5">
              每位作者以当日获赞最多的作品参榜，每日最多获奖一次；零点结榜后自动发放。
            </p>
          </div>
        </div>
      </div>
      {message && (
        <p role="alert" className="px-5 pb-5 text-sm text-red-600 sm:px-7">
          {message}
        </p>
      )}
    </article>
  );
}
