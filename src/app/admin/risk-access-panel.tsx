"use client";
import { useEffect, useState } from "react";
import type { RiskAccessRequest } from "@/lib/risk-access";
export default function RiskAccessPanel() {
  const [entries, setEntries] = useState<RiskAccessRequest[]>([]), [reason, setReason] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  async function load() { const response = await fetch("/api/admin/risk/access", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setEntries(result.requests); }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/risk/access", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.message || "申请读取失败"); return result;
    }).then(result => setEntries(result.requests)).catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, []);
  async function decide(id: string, action: string) {
    setBusy(true);
    try { const response = await fetch("/api/admin/risk/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, reason }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); await load(); setMessage("审批已记录；仅变更对应的限时调用权限"); }
    catch (e) { setMessage(e instanceof Error ? e.message : "审批失败"); } finally { setBusy(false); }
  }
  return <details className="border-t border-[var(--line)] py-4"><summary className="cursor-pointer text-sm font-semibold">高频申请与限时批准（{entries.filter(e => e.status === "pending").length}项待审）</summary><input className="field my-3 w-full px-3 text-xs" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="批准、拒绝或撤销的具体原因" /><div className="space-y-3">{entries.map(e => <div key={e.id} className="rounded border border-[var(--line)] p-3 text-xs"><p>账号 #{e.userId} · {e.perMinute}次/分钟 · 并发{e.concurrency} · {e.hours}小时 · {e.status}</p><p className="my-2 whitespace-pre-wrap break-words">{e.reason}</p>{e.expiresAt && <p>到期：{new Date(e.expiresAt).toLocaleString()}</p>}<div className="mt-2 flex gap-2">{(e.status === "pending" ? ["approve", "decline"] : e.status === "approved" ? ["revoke"] : []).map(action => <button type="button" key={action} disabled={busy || !reason.trim()} onClick={() => void decide(e.id, action)} className="rounded border px-3 py-1 disabled:opacity-40">{action === "approve" ? "限时批准" : action === "decline" ? "不予批准" : "撤销此申请对应权限"}</button>)}</div></div>)}</div>{message && <p role="status" className="mt-2 text-xs">{message}</p>}</details>;
}
