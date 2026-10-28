"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_GOAL_GENERATIONS, MAX_GOAL_GENERATIONS, validGoalGenerations } from "@/lib/assistant-limits";
import { summarizeAssistantUsage, type AssistantCallUsage, type AssistantImageReceipt } from "@/lib/assistant-usage";
import { formatAff } from "@/lib/credit-pricing";
import { WheelNumberInput } from "./wheel-number";
import "./assistant-usage.css";

const roundsKey = "lfn-goal-max-rounds-v1";
export function useGoalRoundLimit() {
  const [rounds, setRounds] = useState(DEFAULT_GOAL_GENERATIONS);
  useEffect(() => {
    try { const saved = Number(localStorage.getItem(roundsKey)); if (validGoalGenerations(saved)) void Promise.resolve().then(() => setRounds(saved)); } catch { /* storage is optional */ }
  }, []);
  return [rounds, (value: number) => {
    if (!validGoalGenerations(value)) return;
    setRounds(value);
    try { localStorage.setItem(roundsKey, String(value)); } catch { /* current selection remains usable */ }
  }] as const;
}

export function GoalRoundControl({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="assistant-round-control">
    <label><span>自动生成轮次<small>1～{MAX_GOAL_GENERATIONS} 轮 · 每轮 1 张</small></span>
      <WheelNumberInput ariaLabel="自动生成轮次" className="field" value={value} setValue={next => { if (!disabled) onChange(next); }} min={1} max={MAX_GOAL_GENERATIONS} step={1} />
    </label>
  </fieldset>;
}

type UsageState = { scope: string; jobs: Record<string, AssistantCallUsage[]>; openJobs: string[]; images: Record<string, AssistantImageReceipt> };
export function useAssistantUsage() {
  const [state, setState] = useState<UsageState>({ scope: "", jobs: {}, openJobs: [], images: {} });
  const current = useRef(state);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const commit = useCallback((next: UsageState) => { current.current = next; setState(next); }, []);
  const start = useCallback((scope: string) => { commit({ scope, jobs: {}, openJobs: [], images: {} }); setError(""); }, [commit]);
  const recordJob = useCallback((scope: string, id: string, calls: AssistantCallUsage[], status = "running") => {
    if (current.current.scope !== scope) return;
    const openJobs = status === "running" ? [...new Set([...current.current.openJobs, id])] : current.current.openJobs.filter(job => job !== id);
    commit({ ...current.current, openJobs, jobs: { ...current.current.jobs, [id]: calls } });
  }, [commit]);
  const recordImage = useCallback((scope: string, id: string | null) => {
    if (!id || current.current.scope !== scope || current.current.images[id]) return;
    commit({ ...current.current, images: { ...current.current.images, [id]: { id, aff: null, balanceCost: null, billing: "pending" } } });
  }, [commit]);
  const restore = useCallback((id: string, calls: AssistantCallUsage[] | undefined) => {
    if (!current.current.scope && calls?.length) commit({ scope: "history", jobs: { [id]: calls }, openJobs: [], images: {} });
  }, [commit]);
  const refresh = useCallback(async () => {
    const snapshot = current.current;
    const jobs = Object.entries(snapshot.jobs).filter(([id, calls]) => snapshot.openJobs.includes(id) || calls.some(call => call.billing !== "settled")).map(([id]) => id);
    const images = Object.values(snapshot.images).filter(image => image.billing !== "settled").map(image => image.id);
    if (!jobs.length && !images.length) return;
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/assistant/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobs, images }), cache: "no-store" });
      if (!response.ok) throw new Error("用量暂时无法刷新，请稍后重试。");
      const result = await response.json() as { jobs: Record<string, { status: string; usage: AssistantCallUsage[] }>; images: AssistantImageReceipt[] };
      if (current.current.scope !== snapshot.scope) return;
      // Keep newer polling snapshots; settled receipts can only improve their cost fields.
      const nextJobs = { ...current.current.jobs };
      for (const [id, { usage: calls }] of Object.entries(result.jobs)) {
        const updated = new Map(calls.map(call => [call.id, call]));
        const existing = new Map((nextJobs[id] ?? []).map(call => [call.id, call]));
        for (const call of calls) if (!existing.has(call.id) || call.billing === "settled") existing.set(call.id, updated.get(call.id)!);
        nextJobs[id] = [...existing.values()];
      }
      const openJobs = current.current.openJobs.filter(id => !result.jobs[id] || result.jobs[id].status === "running");
      commit({ ...current.current, openJobs, jobs: nextJobs, images: { ...current.current.images, ...Object.fromEntries(result.images.map(image => [image.id, image])) } });
    } catch (error) { if (current.current.scope === snapshot.scope) setError(error instanceof Error ? error.message : "用量刷新失败"); }
    finally { setRefreshing(false); }
  }, [commit]);
  // NewAPI logs can appear after the model response or streaming image completion.
  const pending = state.openJobs.length > 0 || Object.values(state.jobs).some(calls => calls.some(call => call.billing === "pending")) || Object.values(state.images).some(image => image.billing === "pending");
  useEffect(() => {
    if (!pending) return;
    let attempts = 0;
    const timer = window.setInterval(() => { if (++attempts > 6) { window.clearInterval(timer); return; } void refresh(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [pending, state.scope, refresh]);
  return { state, start, recordJob, recordImage, restore, refresh, refreshing, error };
}

const number = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
export function AssistantUsagePanel({ usage, goal, compact = false }: { usage: ReturnType<typeof useAssistantUsage>; goal: boolean; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeAssistantUsage(Object.values(usage.state.jobs).flat(), Object.values(usage.state.images));
  const active = Object.keys(usage.state.jobs).length > 0 || summary.images > 0;
  const imageReceipts = Object.values(usage.state.images);
  const hasBalance = summary.settledModels > 0 || imageReceipts.some(image => image.balanceCost !== null);
  return <section className={`assistant-usage-panel${compact ? " is-compact" : ""}`} aria-label="助手上下文与消耗" aria-live="polite">
    {compact && <button type="button" className="assistant-usage-toggle" aria-label={expanded ? "收起用量明细" : "展开用量明细"} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span>{summary.contextTokens === null ? "上下文 —" : `${number(summary.contextTokens)} tokens`}</span>
      <span title="已结算的模型与生图消耗；展开查看分项">{hasBalance ? `${number(summary.modelBalance + summary.imageBalance)} 余额` : summary.pending || usage.state.openJobs.length ? "待结算" : "消耗 —"}</span>
      {imageReceipts.some(image => image.aff !== null) && <span>{formatAff(summary.imageAff)} AFF</span>}<span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
    </button>}
    <div className="assistant-usage-detail" hidden={compact && !expanded}>
    <header><b>{goal ? "本次目标用量" : "最近任务用量"}</b><button type="button" disabled={usage.refreshing || !active} onClick={() => void usage.refresh()}>{usage.refreshing ? "刷新中…" : "刷新账单"}</button></header>
    {active ? <>
      <dl>
        <div><dt>最近调用上下文</dt><dd>{summary.contextTokens === null ? "上游未报告" : `${number(summary.contextTokens)} tokens`}</dd></div>
        <div><dt>模型调用已结算</dt><dd>{summary.settledModels ? `${number(summary.modelBalance)} 余额单位` : summary.pending ? "待结算" : "暂不可用"}</dd></div>
        {summary.images > 0 && <div><dt>生图已结算</dt><dd>{summary.settledImages ? [Object.values(usage.state.images).some(image => image.aff !== null) ? `${formatAff(summary.imageAff)} AFF` : "", Object.values(usage.state.images).some(image => image.balanceCost !== null) ? `${number(summary.imageBalance)} 余额单位` : ""].filter(Boolean).join(" + ") : summary.pending ? "待结算" : "暂不可用"}</dd></div>}
      </dl>
      <details><summary>累计明细 · {summary.calls} 次模型调用{summary.images ? ` · ${summary.images} 次生图请求` : ""}</summary>
        <p>输入 {number(summary.inputTokens)} / 输出 {number(summary.outputTokens)} / 合计 {number(summary.totalTokens)} tokens</p>
        <p>其中缓存输入 {number(summary.cachedInputTokens)}，推理输出 {number(summary.reasoningTokens)}（已包含在输入/输出中，未报告时不计入）。</p>
        <p>最近调用上下文为上游报告的输入 token，包含系统提示、保留的历史、图片及工具结果；累计输入会重复计算各次调用的上下文。</p>
        <p>余额单位为 NewAPI 显示余额；AFF 包含图包与个人额度，费用均取实际结算。</p>
      </details>
      {(summary.pending > 0 || summary.unavailable > 0 || summary.missingTokens > 0) && <p className="assistant-usage-note">{summary.pending > 0 ? `${summary.pending} 笔待结算。` : ""}{summary.unavailable > 0 ? `${summary.unavailable} 笔暂无法读取账单。` : ""}{summary.missingTokens > 0 ? "部分 token 用量未报告，累计值仅含已报告部分。" : ""}</p>}
      {usage.state.openJobs.length > 0 && <p className="assistant-usage-note">{usage.state.openJobs.length} 个模型任务处理中；停止自动迭代后，已发出的调用仍可能结算，可刷新账单查看。</p>}
      {summary.calls === 0 && usage.state.openJobs.length === 0 && <p className="assistant-usage-note">上游未返回可核对的模型用量，费用以 NewAPI 账单为准。</p>}
    </> : <p className="assistant-usage-note">任务开始后显示上下文 token、模型调用额度与生图费用。</p>}
    {usage.error && <p role="status" className="assistant-usage-note">{usage.error}</p>}
    </div>
  </section>;
}
