"use client";
import { useEffect, useState } from "react";
import type { RiskAccessRequest } from "@/lib/risk-access";
export default function RiskAccessForm() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<RiskAccessRequest[]>([]), [reason, setReason] = useState(""), [perMinute, setRate] = useState(30), [concurrency, setConcurrency] = useState(2), [hours, setHours] = useState(24), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { const c = new AbortController(); void fetch("/api/security/access", { cache: "no-store", signal: c.signal }).then(r => r.ok ? r.json() : null).then(r => {setEnabled(r != null && r.enabled !== false);setEntries(r?.requests || []);}).catch(() => undefined); return () => c.abort(); }, []);
  if (!enabled) return null;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const response = await fetch("/api/security/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, perMinute, concurrency, hours }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setEntries(v => [result.request, ...v]); setMessage(result.request.status === "approved" ? "正常观测历史已满足自动批准条件，高频权限限时生效" : "已提交审核，免费总额度保持不变"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "申请失败"); } finally { setBusy(false); }
  }
  return <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">合法高频使用申请</summary><form onSubmit={submit} className="mt-3 space-y-3"><p className="text-xs text-[var(--muted)]">说明用途，申请具体速率、并发与期限。批准不会增加免费总额度，也不能绕过余额、内容和有效限制。</p><div className="grid grid-cols-3 gap-2">{([["每分钟请求", perMinute, setRate], ["并发", concurrency, setConcurrency], ["小时", hours, setHours]] as const).map(([label, value, set]) => <label key={label} className="text-xs">{label}<input className="field mt-1 w-full px-2" type="number" min={1} value={value} onChange={e => set(Number(e.target.value))} /></label>)}</div><label className="block text-xs">用途说明<textarea required maxLength={500} className="field mt-1 min-h-20 w-full p-2" value={reason} onChange={e => setReason(e.target.value)} /></label><button type="submit" disabled={busy || !reason.trim()} className="rounded border px-3 py-2 text-xs disabled:opacity-40">{busy ? "提交中…" : "提交限时申请"}</button>{message && <p role="status" className="text-xs">{message}</p>}</form><ul className="mt-3 space-y-2 text-xs">{entries.slice(0, 5).map(e => <li key={e.id}>{e.perMinute}次/分钟 · 并发{e.concurrency} · {e.status === "approved" ? "已批准" : e.status === "pending" ? "待审核" : e.status === "revoked" ? "已撤销" : "未批准"}{e.expiresAt ? ` · 到期 ${new Date(e.expiresAt).toLocaleString()}` : ""}</li>)}</ul></details>;
}
