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
  submissionReward: number;
  weeklyRewards: [number, number, number];
};

export default function RewardsPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [week, setWeek] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/creator-rewards", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "奖励记录读取失败");
      setCampaigns(result.campaigns || []);
      setGrants(result.grants || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "奖励记录读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

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
      <div><h2 id="rewards-panel-title" className="text-base font-semibold">奖励与活动</h2><p className="mt-1 text-xs text-[var(--muted)]">显式结算投稿奖励、图库周榜，并保留 AFF ledger reference。</p></div>
      {message && <p className="rounded border border-[var(--line)] bg-white px-3 py-2 text-sm">{message}</p>}
      <div className="grid gap-3 rounded-lg border border-[var(--line)] bg-white p-4 sm:grid-cols-2">
        <label className="text-xs font-semibold">用户 ID<input className="mt-1 block h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={userId} onChange={(event) => setUserId(event.target.value)} inputMode="numeric" /></label>
        <label className="text-xs font-semibold">AFF 数量<input className="mt-1 block h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" /></label>
        <label className="text-xs font-semibold sm:col-span-2">说明<input className="mt-1 block h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="管理员手工发放创作者奖励" /></label>
        <button type="button" disabled={busy || !userId || !amount} onClick={() => void action({ userId: Number(userId), amount: Number(amount), description }, "奖励已发放")} className="h-9 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50">手工发放</button>
        <div className="flex gap-2"><input className="h-9 min-w-0 flex-1 rounded border border-[var(--line)] px-2 text-xs" value={week} onChange={(event) => setWeek(event.target.value)} placeholder="周一日期，可留空" /><button type="button" disabled={busy} onClick={() => void action({ action: "settle-weekly", ...(week ? { week } : {}) }, "周榜已显式结算")} className="h-9 rounded border border-[var(--line)] px-3 text-xs font-semibold disabled:opacity-50">结算周榜</button></div>
      </div>
      {campaigns.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{campaigns.map((campaign) => <div key={campaign.id} className="rounded-lg border border-[var(--line)] bg-white p-3 text-xs"><div className="flex justify-between gap-3"><b>{campaign.name}</b><span className="text-[var(--muted)]">{campaign.enabled ? "进行中" : "已停用"}</span></div><p className="mt-1 text-[var(--muted)]">投稿 {campaign.submissionReward} AFF · 周榜 {campaign.weeklyRewards.join(" / ")} AFF</p></div>)}</div>}
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[#f5f3ed] text-[var(--muted)]"><tr><th className="px-3 py-2">时间</th><th className="px-3 py-2">用户</th><th className="px-3 py-2">类型</th><th className="px-3 py-2">金额</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">reference</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="px-3 py-5 text-center text-[var(--muted)]">加载中…</td></tr> : grants.slice(0, 50).map((grant) => <tr key={grant.id} className="border-t border-[var(--line)]"><td className="px-3 py-2">{new Date(grant.createdAt).toLocaleString("zh-CN")}</td><td className="px-3 py-2">{grant.userId}</td><td className="px-3 py-2">{grant.kind}</td><td className="px-3 py-2">{grant.amount}</td><td className="px-3 py-2">{grant.status}</td><td className="max-w-[220px] truncate px-3 py-2 font-mono">{grant.referenceId}</td></tr>)}</tbody></table></div>
    </section>
  );
}
