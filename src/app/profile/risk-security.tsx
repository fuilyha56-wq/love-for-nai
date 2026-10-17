"use client";
import { useEffect, useState } from "react";
import RiskAccessForm from "./risk-access-form";
export default function RiskSecurity() {
  const [info, setInfo] = useState<{ grade: string; grant: { day: string; exits: number; rebinds: number } | null; restrictions: Array<{ id: string; reason: string; expiresAt: number }> } | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { const c = new AbortController(); void fetch("/api/security/grant", { cache: "no-store", signal: c.signal }).then(r => r.ok ? r.json() : null).then(setInfo).catch(() => undefined); return () => c.abort(); }, []);
  async function rebind() {
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/security/grant", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const result = await response.json(); if (!response.ok) throw new Error(result.message || "换绑失败"); setMessage("已绑定当前网络；旧出口授权已失效，额度和计费累计保持不变。"); const current = await fetch("/api/security/grant", { cache: "no-store" }); if (current.ok) setInfo(await current.json()); }
    catch (e) { setMessage(e instanceof Error ? e.message : "请求失败"); } finally { setBusy(false); }
  }
  return <section id="account-security" className="rounded-xl border border-[var(--line)] p-4"><h2 className="font-semibold">免费额度与账号安全</h2><p className="mt-2 text-sm text-[var(--muted)]">{info?.grant ? `${info.grant.day} 已有免费网络授权，今日已换绑 ${info.grant.rebinds} 次。` : "当天首次使用个人奖励 AFF 时自动建立网络授权。购买图包按独立规则使用。"}</p>{info?.restrictions.map(r => <p key={r.id} className="mt-2 text-sm">{r.reason} · 到期 {new Date(r.expiresAt).toLocaleString()}</p>)}<p className="mt-2 text-xs text-[var(--muted)]">换网后可在重新登录后确认，换绑受次数和冷却限制。帮助和账号读取不受生成冷却影响。</p><button type="button" disabled={busy || !info?.grant} onClick={() => void rebind()} className="mt-3 rounded border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-40">{busy ? "正在确认…" : "确认将免费授权换绑到当前网络"}</button>{message && <p role="status" className="mt-2 text-sm">{message}</p>}<RiskAccessForm /></section>;
}
