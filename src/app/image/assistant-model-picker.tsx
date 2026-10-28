"use client";

import { PopupSelect, type SelectOption } from "@/app/ui/popup-select";

export type AssistantModelControl = {
  value: string; options: SelectOption[]; pending: boolean; error: string; disabled?: boolean;
  onChange: (value: string) => void; onRefresh: () => void;
  compact?: boolean;
  providerId?: string; sourceName?: string; sources?: SelectOption[]; onSourceChange?: (id: string) => void;
  group?: string; groups?: SelectOption[]; onGroupChange?: (group: string) => void;
};
export function AssistantSourceControl(p: AssistantModelControl) {
  const custom = (p.sources || []).filter(source => source.value !== "newapi");
  return <div className="assistant-source-control">
    <div role="group" aria-label="助手模型来源"><button type="button" aria-pressed={!p.providerId || p.providerId === "newapi"} disabled={p.disabled} onClick={() => p.onSourceChange?.("newapi")}>NewAPI</button>
      {custom.length > 0 && <button type="button" aria-pressed={p.providerId !== "newapi"} disabled={p.disabled} onClick={() => p.onSourceChange?.(p.providerId !== "newapi" ? p.providerId! : custom[0].value)}>自定义模型</button>}</div>
    {p.providerId && p.providerId !== "newapi" ? <PopupSelect value={p.providerId} options={custom} onChange={id => p.onSourceChange?.(id)} ariaLabel="助手自定义模型源" disabled={p.disabled} menuClassName="assistant-model-menu" menuMinWidth={200} />
      : p.groups?.length ? <><span className="assistant-source-group-label">分组</span><PopupSelect value={p.group || ""} options={p.groups} onChange={group => p.onGroupChange?.(group)} ariaLabel="助手 NewAPI 分组" disabled={p.disabled} menuClassName="assistant-model-menu" menuMinWidth={160} /></> : <span className="assistant-source-group">分组由上游匹配</span>}
  </div>;
}
export function AssistantModelPicker({ value, options, pending, error, disabled, onChange, onRefresh, compact = false, sourceName = "NewAPI" }: AssistantModelControl) {
  return <div className={compact ? "assistant-model-picker is-compact" : "mt-3"}>
    <div className="assistant-model-picker-heading mb-1.5 flex items-center justify-between text-[11px] text-[var(--muted)]">
      <span>助手模型 · {sourceName}</span>
      <button type="button" disabled={pending} onClick={onRefresh}>{pending ? "读取中…" : "刷新"}</button>
    </div>
    <PopupSelect value={value} options={options} onChange={onChange} ariaLabel="智能助手模型" searchable searchPlaceholder="搜索对话模型"
      triggerClassName={compact ? "assistant-model-trigger" : ""} menuClassName="assistant-model-menu"
      menuMinWidth={compact ? 240 : 0}
      disabled={!options.length || disabled} emptyText={pending ? "正在读取模型…" : "暂无可用对话模型"} />
    {error && <p role="status" className="mt-1 text-[11px] text-[var(--rose)]">{error}</p>}
    {!pending && !error && !options.length && <p role="status" className="mt-1 text-[11px] text-[var(--muted)]">上游暂无可用对话模型，请刷新重试。</p>}
  </div>;
}
