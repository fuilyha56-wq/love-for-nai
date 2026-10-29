"use client";
import { useState } from "react";
import { MAX_GOAL_GENERATIONS } from "@/lib/assistant-limits";
import { summarizeAssistantUsage } from "@/lib/assistant-usage";
import { formatAff } from "@/lib/credit-pricing";
import type { useAssistantUsage } from "@/lib/client-assistant-usage";
import { WheelNumberInput } from "@/app/ui/wheel-number";
import "./assistant-usage.css";
export function GoalRoundControl({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="assistant-round-control">
    <label><span>自动生成轮次<small>1～{MAX_GOAL_GENERATIONS} 轮 · 每轮 1 张</small></span>
      <WheelNumberInput ariaLabel="自动生成轮次" className="field" value={value} setValue={next => { if (!disabled) onChange(next); }} min={1} max={MAX_GOAL_GENERATIONS} step={1} />
    </label>
  </fieldset>;
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

export { useAssistantUsage, useGoalRoundLimit } from "@/lib/client-assistant-usage";
