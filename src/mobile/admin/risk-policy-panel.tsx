"use client";
import { LfnSelect } from "@/mobile/ui/lfn-select";
import { LfnSwitch } from "@/mobile/ui/lfn-switch";


import { useEffect, useState } from "react";
import { RefreshCw, Save, Undo2 } from "lucide-react";
import type { RiskPolicy, RiskRuleAction } from "@/lib/risk-control";

type NumericKey = { [Key in keyof RiskPolicy]: RiskPolicy[Key] extends number ? Key : never }[keyof RiskPolicy];
type Rule = {
  title: string;
  description: string;
  enabledKey: "duplicateEnabled" | "sameUserEnabled" | "highVolumeEnabled";
  actionKey: "duplicateAction" | "sameUserAction" | "highVolumeAction";
  scoreKey: "duplicateScore" | "sameUserScore" | "highVolumeScore";
  fields: Array<{ label: string; key: NumericKey; scale?: number; min: number; max: number }>;
};
const rules: Rule[] = [
  { title: "重复提示词", description: "时间窗内同一提示词同时达到请求数和用户数阈值。", enabledKey: "duplicateEnabled", actionKey: "duplicateAction", scoreKey: "duplicateScore", fields: [
    { label: "窗口（分钟）", key: "duplicateWindowMs", scale: 60_000, min: 1, max: 10_080 },
    { label: "请求数 ≥", key: "duplicateMinRequests", min: 2, max: 100_000 },
    { label: "用户数 ≥", key: "duplicateMinUsers", min: 2, max: 100_000 },
  ] },
  { title: "单用户高频", description: "同一用户在时间窗内的真实请求数达到阈值。", enabledKey: "sameUserEnabled", actionKey: "sameUserAction", scoreKey: "sameUserScore", fields: [
    { label: "窗口（分钟）", key: "sameUserWindowMs", scale: 60_000, min: 1, max: 10_080 },
    { label: "请求数 ≥", key: "sameUserMaxRequests", min: 2, max: 100_000 },
  ] },
  { title: "窗口调用量", description: "5 小时或 7 天的调用数达到任一阈值。", enabledKey: "highVolumeEnabled", actionKey: "highVolumeAction", scoreKey: "highVolumeScore", fields: [
    { label: "5 小时请求 ≥", key: "highVolume5hRequests", min: 1, max: 1_000_000 },
    { label: "7 天请求 ≥", key: "highVolume7dRequests", min: 1, max: 1_000_000 },
  ] },
];

export default function RiskPolicyPanel() {
  const [policy, setPolicy] = useState<RiskPolicy | null>(null);
  const [saved, setSaved] = useState<RiskPolicy | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(policy) !== JSON.stringify(saved);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/risk/policy", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "条例读取失败");
      if (!controller.signal.aborted) { setPolicy(result.policy); setSaved(result.policy); setReady(result.readiness?.promptFingerprint === true); setError(""); }
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "条例读取失败"); });
    return () => controller.abort();
  }, [revision]);
  function update<Key extends keyof RiskPolicy>(key: Key, value: RiskPolicy[Key]) {
    setPolicy((current) => current ? { ...current, [key]: value } : current);
    setMessage("");
  }
  async function save() {
    if (!policy) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/risk/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "条例保存失败");
      setPolicy(result.policy);
      setSaved(result.policy);
      setMessage("已保存，后续请求立即使用新条例");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "条例保存失败");
    } finally { setSaving(false); }
  }
  function numeric(label: string, key: NumericKey, min: number, max: number, scale = 1) {
    return <label key={key} className="min-w-0 text-xs text-[var(--muted)]">{label}<input type="number" min={min} max={max} step={scale === 60_000 ? 1 / 6 : 1} value={policy ? policy[key] / scale : ""} disabled={saving} onChange={(event) => update(key, Math.round(Number(event.target.value) * scale))} className="field mt-1 h-9 w-full min-w-0 px-2 font-semibold text-[var(--ink)]" /></label>;
  }
  return (
    <section className="min-w-0 border-t border-[var(--line)] pt-5" aria-busy={saving}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3"><h2 className="text-base font-semibold">封控条例与执行策略</h2>{dirty && <span className="text-xs text-amber-700">有未保存修改</span>}</div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="重新读取条例" title="重新读取条例" disabled={dirty || saving} onClick={() => setRevision((value) => value + 1)} className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] disabled:opacity-40"><RefreshCw size={15} /></button>
          <button type="button" aria-label="撤销未保存修改" title="撤销未保存修改" disabled={!dirty || saving} onClick={() => { setPolicy(saved); setMessage(""); setError(""); }} className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] disabled:opacity-40"><Undo2 size={15} /></button>
          <button type="button" disabled={!dirty || !policy || saving} onClick={() => void save()} className="inline-flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-40"><Save size={15} />{saving ? "保存中…" : "保存条例"}</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-3 text-xs text-emerald-700">{message}</p>}
      {!policy && !error && <p role="status" className="py-8 text-sm text-[var(--muted)]">正在读取条例…</p>}
      {policy && <fieldset disabled={saving} className="mt-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
          <LfnSwitch checked={policy.enabled} disabled={saving} label="启用自动风控" onChange={(checked) => update("enabled", checked)} />
          <span className="break-all text-[11px] text-[var(--muted)]">版本 {policy.policyVersion}</span>
        </div>
        {rules.map((rule) => <div key={rule.enabledKey} className="border-b border-[var(--line)] py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LfnSwitch checked={policy[rule.enabledKey]} disabled={saving} label={rule.title} onChange={(checked) => update(rule.enabledKey, checked)} />
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">触发动作<LfnSelect disabled value={policy[rule.actionKey]} onChange={(event) => update(rule.actionKey, event.target.value as RiskRuleAction)} className="field h-9 px-2 text-xs"><option value="observe">仅记录</option><option value="rate-limit">限流 · 429</option><option value="deny">拒绝 · 403</option></LfnSelect></label>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{rule.description}</p>
          {rule.enabledKey === "duplicateEnabled" && !ready && <p className="mt-1 text-xs text-amber-700">未配置提示词指纹密钥，此条暂不检测。</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {rule.fields.map((field) => numeric(field.label, field.key, field.min, field.max, field.scale))}
            {numeric("增加风险分值", rule.scoreKey, 0, 100)}
          </div>
        </div>)}
        <div className="grid grid-cols-2 gap-3 border-b border-[var(--line)] py-4 sm:grid-cols-4">
          {numeric("Watch 分数线", "watchScore", 1, 100)}
          {numeric("Risk 分数线", "riskScore", 1, 100)}
          {numeric("Critical 分数线", "criticalScore", 1, 100)}
          {numeric("限流重试（秒）", "retryAfterSeconds", 1, 86_400)}
        </div>
        <div className="space-y-3 border-b border-[var(--line)] py-4 text-xs">
          <LfnSwitch checked={false} disabled label="旧版按分数限流已停用" onChange={(checked) => update("autoRateLimitCritical", checked)} />
          <p className="leading-5 text-[var(--muted)]">旧版条例仅保留观察与历史查询。实际令牌桶、七级分值、独立证据条件与固定到期处置请使用上方轻量风控配置。</p>
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_180px]"><LfnSwitch checked={policy.referralRiskEnabled} disabled={saving} label="允许管理员邀请链封禁" onChange={(checked) => update("referralRiskEnabled", checked)} />{numeric("邀请链最大深度", "referralMaxDepth", 1, 100)}</div>
        </div>
        <dl className="space-y-3 py-4 text-xs leading-5">
          <div><dt className="font-semibold">手动账号封禁</dt><dd className="text-[var(--muted)]">持续拒绝平台图像请求，直到管理员解封；关闭自动风控仍然生效。</dd></div>
          <div><dt className="font-semibold">邀请链处理</dt><dd className="text-[var(--muted)]">按配置深度预览关联账号，管理员确认后可批量封禁或解封；不会自动封禁整条邀请链，也不修改 NewAPI 账号状态。</dd></div>
          <div><dt className="font-semibold">风险记录与复核</dt><dd className="text-[var(--muted)]">相同窗口信号去重；IP、重复提示词和邀请关系仅作辅助证据。自动处置由上方轻量引擎统一执行，手动封禁独立保留。</dd></div>
        </dl>
      </fieldset>}
    </section>
  );
}
