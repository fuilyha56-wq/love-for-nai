"use client";
import { useEffect, useState } from "react";
import RiskAccessPanel from "./risk-access-panel";
import { LfnSwitch } from "@/app/ui/lfn-switch";
import { LfnSelect } from "@/app/ui/lfn-select";
import type { RiskField, RiskSettings, RiskValue, RiskRuleConfig, RiskGrade } from "@/lib/risk-settings";

type Payload = { settings: RiskSettings; defaults: RiskSettings; fields: RiskField[]; history: string[]; draft: { settings: RiskSettings } | null; readiness: Record<string, unknown> };
type Snapshot = { userId: number; score: number; grade: string; evidence: Array<{ id: string; rule: string; points: number; at: number; details: Record<string, unknown> }>; restrictions: Array<{ id: string; reason: string; expiresAt: number }>; grant: unknown; counts: unknown; readiness: unknown };
const names: Record<string, string> = { global: "全局与分值", identity: "外部凭据核验与缓存", grant: "每日免费网络授权", rate: "调用速率与资源", prompt: "提示词摘要", device: "设备关联", quota: "额度与基线", behavior: "调用时间分布", content: "内容拒绝与退避", network: "网络情报", capacity: "内存容量", audit: "诊断写入", trust: "高频授权", extensions: "扩展依赖" };

export default function LightRiskPanel() {
  const [data, setData] = useState<Payload | null>(null), [settings, setSettings] = useState<RiskSettings | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [reason, setReason] = useState(""), [query, setQuery] = useState("");
  const [history, setHistory] = useState(""), [overrides, setOverrides] = useState("[]"), [userId, setUserId] = useState(""), [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [proofRule, setProofRule] = useState("R01"), [proofRef, setProofRef] = useState(""), [confirmed, setConfirmed] = useState(false);
  const dirty = Boolean(data && settings && JSON.stringify(data.settings) !== JSON.stringify(settings));
  async function load() {
    const response = await fetch("/api/admin/risk/settings", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.message || "策略读取失败");
    setData(result); setSettings(structuredClone(result.settings)); setOverrides(JSON.stringify(result.settings.overrides, null, 2));
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/risk/settings", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.message || "策略读取失败"); return result as Payload;
    }).then(result => { setData(result); setSettings(structuredClone(result.settings)); setOverrides(JSON.stringify(result.settings.overrides, null, 2)); }).catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, []);
  function value(key: string, next: RiskValue) { setSettings(s => s ? { ...s, values: { ...s.values, [key]: next } } : s); }
  function rule(id: string, patch: Partial<RiskRuleConfig>) { setSettings(s => s ? { ...s, rules: s.rules.map(r => r.id === id ? { ...r, ...patch } : r) } : s); }
  function level(id: string, patch: Partial<RiskGrade>) { setSettings(s => s ? { ...s, levels: s.levels.map(l => l.id === id ? { ...l, ...patch } : l) } : s); }
  async function save(action: string) {
    if (!data || !settings) return; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/risk/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, settings, expectedVersion: data.settings.version, reason, history }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message || "操作失败");
      if (result.settings) await load();
      setMessage(action === "validate" ? "配置校验通过，尚未发布" : action === "draft" ? "草稿已保存，尚未生效" : "新策略已发布；既有处置不会被隐式解除");
    } catch (e) { setMessage(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
  }
  async function inspectUser() {
    try { const response = await fetch(`/api/admin/risk/users/${Number(userId)}/controls`, { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setSnapshot(result); }
    catch (e) { setMessage(e instanceof Error ? e.message : "读取失败"); }
  }
  async function release(id: string) {
    if (!reason.trim() || !snapshot) { setMessage("请在上方填写解除原因"); return; }
    setBusy(true);
    try { const response = await fetch(`/api/admin/risk/users/${snapshot.userId}/controls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restrictionId: id, reason }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setSnapshot(result); setMessage("仅已选处置已解除，其余限制保持有效"); }
    catch (e) { setMessage(e instanceof Error ? e.message : "解除失败"); } finally { setBusy(false); }
  }
  async function confirmEvidence() {
    if (!snapshot || !confirmed || !proofRef.trim() || !reason.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/risk/users/${snapshot.userId}/controls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm-evidence", confirmed, rule: proofRule, reference: proofRef, reason }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message); setSnapshot(result); setConfirmed(false); setProofRef(""); setMessage("人工核验已审计；按该规则当前配置记分或执行固定期限动作");
    } catch (e) { setMessage(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  }
  if (!data || !settings) return <section className="border-t border-[var(--line)] py-5"><p role="status">{message || "正在读取轻量风控策略…"}</p></section>;
  const groups = [...new Set(data.fields.map(f => f.group))];
  const changedFields = data.fields.filter(f => data.settings.values[f.key] !== settings.values[f.key]);
  return <section className="min-w-0 border-t border-[var(--line)] py-5" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">轻量风控 · 七级风险与可配置规则</h2><span className="break-all text-xs text-[var(--muted)]">{data.settings.version}{dirty ? " · 有未发布修改" : " · 当前生效"}</span></div>
    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">观察不执行自动处罚。弱信号不能通过改分变成强证据；关闭检测不会解除已生效处置。当前准入为单进程模式，外部信誉、语义模型及人机验证尚未接入。</p>
    <details className="mt-3 text-xs"><summary>查看实际依赖状态</summary><pre className="overflow-auto p-2">{JSON.stringify(data.readiness, null, 2)}</pre></details>
    <label className="mt-3 block text-xs">操作原因<input className="field mt-1 w-full px-3" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="发布、回滚或解除处置的具体原因" /></label>
    <div className="my-3 flex flex-wrap gap-2 text-xs">
      <button type="button" disabled={busy} onClick={() => void save("validate")} className="rounded border px-3 py-2">校验</button>
      <button type="button" disabled={busy} onClick={() => void save("draft")} className="rounded border px-3 py-2">保存草稿</button>
      <button type="button" disabled={busy || !dirty || !reason.trim()} onClick={() => void save("publish")} className="rounded bg-[var(--rose)] px-3 py-2 text-white disabled:opacity-40">发布策略</button>
      <button type="button" disabled={busy} onClick={() => { setSettings(structuredClone(data.settings)); setOverrides(JSON.stringify(data.settings.overrides, null, 2)); }} className="rounded border px-3 py-2">撤销未发布修改</button>
      <button type="button" disabled={busy || !data.draft} onClick={() => { if (data.draft) setSettings(structuredClone(data.draft.settings)); }} className="rounded border px-3 py-2">加载草稿</button>
      <button type="button" disabled={busy} onClick={() => setSettings(structuredClone(data.defaults))} className="rounded border px-3 py-2">预览默认值</button>
      <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "lfn-risk-policy.json"; a.click(); URL.revokeObjectURL(url); }} className="rounded border px-3 py-2">导出配置</button>
      <label className="cursor-pointer rounded border px-3 py-2">导入待校验配置<input className="hidden" type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 200000) { setMessage("配置文件过大"); return; } try { const parsed = JSON.parse(await file.text()); const response = await fetch("/api/admin/risk/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "validate", settings: parsed }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setSettings(parsed); setOverrides(JSON.stringify(parsed.overrides, null, 2)); setMessage("导入校验通过，尚未发布"); } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); } }} /></label>
    </div>
    {message && <p role="status" className="my-3 text-sm">{message}</p>}
    <details className="my-3 text-xs"><summary>预览差异（{changedFields.length} 项参数，另比较规则/等级/例外）</summary>{changedFields.map(f => <p key={f.key}>{f.label}：{String(data.settings.values[f.key])} → {String(settings.values[f.key])}</p>)}{JSON.stringify(data.settings.rules) !== JSON.stringify(settings.rules) && <pre className="overflow-auto">{JSON.stringify({ before: data.settings.rules, after: settings.rules }, null, 2)}</pre>}{JSON.stringify(data.settings.levels) !== JSON.stringify(settings.levels) && <pre className="overflow-auto">{JSON.stringify({ before: data.settings.levels, after: settings.levels }, null, 2)}</pre>}</details>
    <input className="field my-3 w-full px-3" aria-label="搜索配置项" placeholder="搜索配置名、字段或说明" value={query} onChange={e => setQuery(e.target.value)} />
    <fieldset disabled={busy}>
      {groups.map(group => { const matches = data.fields.filter(f => f.group === group && `${f.key} ${f.label} ${f.description}`.toLowerCase().includes(query.toLowerCase())); if (!matches.length) return null; return <details key={group} open={Boolean(query)} className="border-b border-[var(--line)] py-3"><summary className="cursor-pointer text-sm font-semibold">{names[group] || group} · {matches.length} 项</summary><div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{matches.map(f => <div key={f.key} className="min-w-0 text-xs">{typeof f.value === "boolean" ? <LfnSwitch checked={settings.values[f.key] === true} label={f.label} disabled={Boolean(f.description.includes("未接入"))} onChange={v => value(f.key, v)} /> : <label className="block">{f.label}{f.options ? <LfnSelect className="field mt-1 w-full px-2" value={String(settings.values[f.key])} onChange={e => value(f.key, e.target.value)}>{f.options.map(v => <option key={v}>{v}</option>)}</LfnSelect> : <input className="field mt-1 w-full px-2" type={typeof f.value === "number" ? "number" : "text"} min={f.min} max={f.max} step={1} value={String(settings.values[f.key])} onChange={e => value(f.key, typeof f.value === "number" ? Number(e.target.value) : e.target.value)} />}</label>}<p className="mt-1 break-all text-[10px] text-[var(--muted)]">{f.key} · 默认 {String(f.value)}{f.min != null ? ` · 范围 ${f.min}–${f.max}` : ""}</p>{f.description && <p className="mt-1 leading-5 text-[var(--muted)]">{f.description}</p>}</div>)}</div></details>; })}
      <details className="border-b border-[var(--line)] py-3"><summary className="cursor-pointer text-sm font-semibold">逐条规则：条件命中后的分值与动作</summary><div className="mt-3 space-y-4">{settings.rules.map(r => <div key={r.id} className="rounded border border-[var(--line)] p-3 text-xs"><p className="mb-2 font-semibold">{r.id} · {r.label} · {r.strong ? "服务端明确证据" : "辅助观察证据"}</p><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><label>模式<LfnSelect className="field mt-1 w-full" value={r.mode} onChange={e => rule(r.id, { mode: e.target.value as RiskRuleConfig["mode"] })}><option value="disabled">关闭</option><option value="observe">仅观察</option><option value="enforce">执行配置动作</option></LfnSelect></label>{([['points','单次加分'],['maxPoints','窗口最高分'],['cooldownSeconds','加分冷却秒数'],['expiresSeconds','证据有效秒数'],['durationSeconds','处置持续秒数']] as const).map(([key,label]) => <label key={key}>{label}<input type="number" min={0} className="field mt-1 w-full px-2" value={r[key]} onChange={e => rule(r.id, { [key]: Number(e.target.value) })} /></label>)}<label>命中动作<LfnSelect disabled={!r.strong} className="field mt-1 w-full" value={r.action} onChange={e => rule(r.id, { action: e.target.value as RiskRuleConfig["action"] })}><option value="observe">观察</option><option value="rate-limit">限流429</option><option value="deny">能力暂停403</option></LfnSelect></label></div></div>)}</div></details>
      <details className="border-b border-[var(--line)] py-3"><summary className="cursor-pointer text-sm font-semibold">七级风险与等级动作</summary><div className="mt-3 space-y-3">{settings.levels.map(l => <div key={l.id} className="grid grid-cols-2 gap-3 text-xs md:grid-cols-5"><label>名称<input className="field mt-1 w-full px-2" value={l.name} onChange={e => level(l.id, { name: e.target.value })} /></label><label>最低分<input className="field mt-1 w-full px-2" type="number" value={l.minimum} onChange={e => level(l.id, { minimum: Number(e.target.value) })} /></label><label>显示颜色<input className="mt-1 block h-9 w-full" type="color" value={l.color} onChange={e => level(l.id, { color: e.target.value })} /></label><label>动作<LfnSelect className="field mt-1 w-full" value={l.action} onChange={e => level(l.id, { action: e.target.value as RiskGrade["action"] })}><option value="observe">观察</option><option value="rate-limit">限流</option><option value="deny">暂停相关能力</option></LfnSelect></label><label>持续秒数<input type="number" className="field mt-1 w-full px-2" value={l.durationSeconds} onChange={e => level(l.id, { durationSeconds: Number(e.target.value) })} /></label></div>)}</div><p className="mt-2 text-xs text-[var(--muted)]">等级自动动作总开关默认关闭；启用仍需独立强证据条件，不能因修改分数把弱证据自动升级为事实。</p></details>
      <details className="border-b border-[var(--line)] py-3"><summary className="cursor-pointer text-sm font-semibold">证据族贡献上限</summary><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(settings.familyCaps).map(([family, cap]) => <label key={family} className="text-xs">{family}<input type="number" className="field mt-1 w-full px-2" value={cap} onChange={e => setSettings({ ...settings, familyCaps: { ...settings.familyCaps, [family]: Number(e.target.value) } })} /></label>)}</div></details>
      <details className="border-b border-[var(--line)] py-3"><summary className="cursor-pointer text-sm font-semibold">限时账号例外/高频批准</summary><p className="my-2 text-xs">仅允许账号速率、并发和换绑覆盖。格式：userId、expiresAt、reason、values；不能绕过余额、撤销凭据和内容规则。</p><textarea className="field min-h-40 w-full p-2 font-mono text-xs" value={overrides} onChange={e => setOverrides(e.target.value)} /><button type="button" className="mt-2 rounded border px-3 py-2 text-xs" onClick={() => { try { const parsed = JSON.parse(overrides); if (!Array.isArray(parsed)) throw new Error("例外须为数组"); setSettings({ ...settings, overrides: parsed }); setMessage("例外已载入待发布配置，请校验并发布"); } catch (e) { setMessage(e instanceof Error ? e.message : "格式错误"); } }}>载入待发布例外</button></details>
    </fieldset>
    <div className="my-4 flex flex-wrap gap-2 text-xs"><LfnSelect className="field max-w-full px-2" value={history} onChange={e => setHistory(e.target.value)}><option value="">选择历史变更记录</option>{data.history.map(h => <option key={h}>{h}</option>)}</LfnSelect><button type="button" disabled={!history || !reason.trim() || busy} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => void save("rollback")}>回滚到此记录变更前的版本</button></div>
    <div className="border-t border-[var(--line)] pt-4"><h3 className="text-sm font-semibold">账号证据、免费授权与处置复核</h3><div className="my-3 flex gap-2"><input type="number" min={1} className="field w-40 px-2" placeholder="账号ID" value={userId} onChange={e => setUserId(e.target.value)} /><button type="button" onClick={() => void inspectUser()} className="rounded border px-3 py-2 text-xs">读取</button></div>{snapshot && <div className="text-xs"><p>{snapshot.grade} · {snapshot.score} 分 · 账号 #{snapshot.userId}</p>{snapshot.restrictions.map(r => <div key={r.id} className="my-2 flex flex-wrap items-center gap-2"><span>{r.reason} · {new Date(r.expiresAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={() => void release(r.id)} className="rounded border px-2 py-1">解除此项</button></div>)}<details className="mt-2"><summary>特征覆盖、计数与授权</summary><pre className="max-h-80 overflow-auto">{JSON.stringify({ counts: snapshot.counts, grant: snapshot.grant, readiness: snapshot.readiness }, null, 2)}</pre></details><details className="mt-2"><summary>当前活动证据</summary><pre className="max-h-96 overflow-auto">{JSON.stringify(snapshot.evidence, null, 2)}</pre></details></div>}</div>
    {snapshot && <details className="my-4 rounded border border-[var(--line)] p-3 text-xs"><summary>人工核验强证据（不能仅凭 IP、VPN、提示词或邀请关系认定）</summary><p className="my-2">证据编号仅保存带密钥摘要。请在独立案件记录保存核验依据；规则默认为观察，可按审核后的配置执行有期限动作。</p><LfnSelect className="field w-full" value={proofRule} onChange={e => setProofRule(e.target.value)}><option value="N05">N05 已确认恶意网络活动</option><option value="R01">R01 已确认规避平台限制</option><option value="G01">G01 已确认协同奖励套利</option></LfnSelect><input className="field my-2 w-full px-2" value={proofRef} maxLength={200} onChange={e => setProofRef(e.target.value)} placeholder="内部证据编号；不粘贴提示词、密钥或私人信息" /><LfnSwitch checked={confirmed} onChange={setConfirmed} label={`已独立核验账号 #${snapshot.userId} 的事实及上方操作原因`} /><button type="button" className="mt-2 rounded border px-3 py-2 disabled:opacity-40" disabled={busy || !confirmed || !proofRef.trim() || !reason.trim()} onClick={() => void confirmEvidence()}>记录此项人工核验证据</button></details>}
    <RiskAccessPanel />
  </section>;
}
