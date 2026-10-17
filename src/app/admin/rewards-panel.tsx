"use client";


import { useCallback, useEffect, useState } from "react";

type Grant = {
  id: string;
  kind: string;
  userId: number;
  amount: number;
  description: string;
  status: string;
  createdAt: string;
  referenceId: string;
};
type Campaign = {
  id: string;
  name: string;
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  submissionReward: number;
  weeklyRewards: [number, number, number];
  budget?: number;
};
type Automation = { enabled: boolean; timezone: "UTC"; weekStartsOn: "monday"; lastCheckedWeek: string; previousWeek: string };

export default function RewardsPanel({ onManageActivities }: { onManageActivities: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [page, setPage] = useState(0);
  const [grantTotal, setGrantTotal] = useState(0);
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/creator-rewards?offset=${page * 50}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "奖励记录读取失败");
      setCampaigns(result.campaigns || []);
      setGrants(result.grants || []);
      setGrantTotal(result.grantTotal || 0);
      setAutomation(result.automation || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "奖励记录读取失败");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  async function action(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/creator-rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "奖励操作失败");
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "奖励操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5" aria-labelledby="rewards-panel-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="rewards-panel-title" className="text-base font-semibold">奖励与活动</h2><p className="mt-1 text-xs text-[var(--muted)]">手工发放、自动周榜结算与发放记录。活动信息和资格在管理中心的「活动管理」中配置。</p></div><button type="button" onClick={onManageActivities} className="lfn-button">管理活动</button></div>
      {message && <p className="rounded border border-[var(--line)] bg-white px-3 py-2 text-sm">{message}</p>}
      <div className="grid gap-3 rounded-lg border border-[var(--line)] bg-white p-4 sm:grid-cols-2">
        <label className="text-xs font-semibold">用户 ID<input className="mt-1 block h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={userId} onChange={(event) => setUserId(event.target.value)} inputMode="numeric" /></label>
        <label className="text-xs font-semibold">AFF 数量<input className="mt-1 block h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" /></label>
        <label className="text-xs font-semibold sm:col-span-2">说明<input className="mt-1 block h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="管理员手工发放创作者奖励" /></label>
        <button type="button" disabled={busy || !userId || !amount} onClick={() => void action({ userId: Number(userId), amount: Number(amount), description }, "奖励已发放")} className="h-9 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50">手工发放</button>
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 text-xs text-[var(--muted)]">自动结算：UTC 每周一开始，上周周期 {automation?.previousWeek || "读取中…"}</span><button type="button" disabled={busy} onClick={() => void action({ action: "auto-settle" }, "已检查并结算上一个完整 UTC 周")} className="h-9 rounded border border-[var(--line)] px-3 text-xs font-semibold disabled:opacity-50">立即检查上周</button></div>
      </div>
      <button type="button" onClick={onManageActivities} className="block w-full rounded-lg border border-[var(--line)] p-4 text-left text-sm text-[var(--rose)]">已配置 {campaigns.length} 个活动 · 进入活动管理 →</button>
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[#f5f3ed] text-[var(--muted)]"><tr><th className="px-3 py-2">时间</th><th className="px-3 py-2">用户</th><th className="px-3 py-2">类型</th><th className="px-3 py-2">金额</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">reference</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="px-3 py-5 text-center text-[var(--muted)]">加载中…</td></tr> : grants.slice(0, 50).map((grant) => <tr key={grant.id} className="border-t border-[var(--line)]"><td className="px-3 py-2">{new Date(grant.createdAt).toLocaleString("zh-CN")}</td><td className="px-3 py-2">{grant.userId}</td><td className="px-3 py-2">{grant.kind}</td><td className="px-3 py-2">{grant.amount}</td><td className="px-3 py-2">{grant.status}</td><td className="max-w-[220px] truncate px-3 py-2 font-mono">{grant.referenceId}</td></tr>)}</tbody></table></div>
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]"><span>共 {grantTotal} 条发放记录 · 第 {page + 1} 页</span><div className="flex gap-2"><button type="button" className="lfn-button" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>上一页</button><button type="button" className="lfn-button" disabled={(page + 1) * 50 >= grantTotal || loading} onClick={() => setPage(page + 1)}>下一页</button></div></div>
    </section>
  );
}
