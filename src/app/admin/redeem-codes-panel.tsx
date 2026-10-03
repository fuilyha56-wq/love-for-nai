"use client";

import { useCallback, useEffect, useState } from "react";

type RedeemCode = { id: string; code: string; amount: number; maxUses: number; usedCount: number; expiresAt?: string; enabled: boolean; createdAt: string };
export default function RedeemCodesPanel() {
  const [items, setItems] = useState<RedeemCode[]>([]);
  const [count, setCount] = useState("1");
  const [amount, setAmount] = useState("100");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [code, setCode] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [history, setHistory] = useState<{ code: string; amount: number; redeemedAt: string }[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/redeem-codes", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "兑换码读取失败");
      setItems(result.items || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "兑换码读取失败"); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  async function create() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/redeem-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: Number(count), amount: Number(amount), maxUses: Number(maxUses), expiresAt: expiresAt || undefined, code: code || undefined }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "创建失败");
      setMessage(`已创建 ${result.items?.length || 0} 个兑换码`); setCode(""); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "创建失败"); } finally { setBusy(false); }
  }
  async function toggle(item: RedeemCode) {
    const response = await fetch("/api/admin/redeem-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, enabled: !item.enabled }) });
    const result = await response.json(); if (!response.ok) setMessage(result.message || "更新失败"); else await load();
  }
  async function redeem() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: redeemCode }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message || "兑换失败");
      setMessage(result.message || "兑换成功"); setRedeemCode("");
      const historyResponse = await fetch("/api/redeem/history", { cache: "no-store" }); const historyResult = await historyResponse.json(); setHistory(historyResult.items || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "兑换失败"); } finally { setBusy(false); }
  }
  return (
    <section className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5" aria-labelledby="redeem-codes-panel-title">
      <div><h2 id="redeem-codes-panel-title" className="text-base font-semibold">兑换码</h2><p className="mt-1 text-xs text-[var(--muted)]">批量生成、停用和查看兑换码；公开列表不展示用户兑换历史。</p></div>
      {message && <p className="rounded border border-[var(--line)] bg-white px-3 py-2 text-sm">{message}</p>}
      <div className="grid gap-3 rounded-lg border border-[var(--line)] bg-white p-4 sm:grid-cols-4"><label className="text-xs font-semibold">数量<input className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={count} onChange={(event) => setCount(event.target.value)} inputMode="numeric" /></label><label className="text-xs font-semibold">每码 AFF<input className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" /></label><label className="text-xs font-semibold">每码次数<input className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} inputMode="numeric" /></label><label className="text-xs font-semibold">自定义码<input className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={code} onChange={(event) => setCode(event.target.value)} placeholder="可选" /></label><label className="text-xs font-semibold sm:col-span-3">过期时间<input type="datetime-local" className="mt-1 h-9 w-full rounded border border-[var(--line)] px-2 text-sm font-normal" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><button type="button" disabled={busy} onClick={() => void create()} className="h-9 self-end rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50">生成兑换码</button></div>
      <div className="flex gap-2 rounded-lg border border-[var(--line)] bg-white p-4"><input className="h-9 min-w-0 flex-1 rounded border border-[var(--line)] px-2 text-sm" value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} placeholder="用户兑换测试 / 兑换码" /><button type="button" disabled={busy || !redeemCode} onClick={() => void redeem()} className="h-9 rounded border border-[var(--line)] px-3 text-xs font-semibold">兑换</button></div>
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white"><table className="w-full min-w-[640px] text-left text-xs"><thead className="bg-[#f5f3ed] text-[var(--muted)]"><tr><th className="px-3 py-2">兑换码</th><th className="px-3 py-2">奖励</th><th className="px-3 py-2">使用</th><th className="px-3 py-2">过期</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-[var(--line)]"><td className="px-3 py-2 font-mono">{item.code.slice(0, 4)}••••</td><td className="px-3 py-2">{item.amount} AFF</td><td className="px-3 py-2">{item.usedCount}/{item.maxUses}</td><td className="px-3 py-2">{item.expiresAt ? new Date(item.expiresAt).toLocaleString("zh-CN") : "永不过期"}</td><td className="px-3 py-2">{item.enabled ? "启用" : "停用"}</td><td className="px-3 py-2"><button type="button" onClick={() => void toggle(item)} className="font-semibold text-[var(--rose)]">{item.enabled ? "停用" : "启用"}</button></td></tr>)}</tbody></table></div>
      {history.length > 0 && <div className="rounded-lg border border-[var(--line)] bg-white p-3 text-xs"><b>兑换历史</b>{history.map((item) => <p key={`${item.code}-${item.redeemedAt}`} className="mt-2 text-[var(--muted)]">{item.code} · {item.amount} AFF · {new Date(item.redeemedAt).toLocaleString("zh-CN")}</p>)}</div>}
    </section>
  );
}
