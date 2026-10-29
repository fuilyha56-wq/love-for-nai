"use client";

import { PopupSelect, type SelectOption } from "@/mobile/ui/popup-select";

export type AssistantModelControl = {
  value: string; options: SelectOption[]; pending: boolean; error: string; disabled?: boolean;
  onChange: (value: string) => void; onRefresh: () => void;
  compact?: boolean;
  providerId?: string; sourceName?: string; sources?: SelectOption[]; onSourceChange?: (id: string) => void;
  group?: string; groups?: SelectOption[]; onGroupChange?: (group: string) => void;
};
export function AssistantSourceControl(p: AssistantModelControl) {
  const sources = p.sources?.length ? p.sources : [{ value: "newapi", label: "NewAPI" }];
  const groups = p.groups?.length ? p.groups : [{ value: "", label: "自动（账号默认）" }];
  const isNewApi = !p.providerId || p.providerId === "newapi";
  return <div className="assistant-source-control">
    <label className="assistant-source-field"><span>模型来源</span><PopupSelect value={p.providerId || "newapi"} options={sources} onChange={id => p.onSourceChange?.(id)} ariaLabel="助手模型来源" disabled={p.disabled} menuClassName="mobile-assistant-model-menu" menuMinWidth={200} /></label>
    {isNewApi && <label className="assistant-source-field"><span>NewAPI 分组</span><PopupSelect value={p.group || ""} options={groups} onChange={group => p.onGroupChange?.(group)} ariaLabel="助手 NewAPI 分组" disabled={p.disabled} menuClassName="mobile-assistant-model-menu" menuMinWidth={160} /></label>}
  </div>;
}
export function AssistantModelPicker({ value, options, pending, error, disabled, onChange, onRefresh, compact = false, sourceName = "NewAPI" }: AssistantModelControl) {
  return <div className={compact ? "assistant-model-picker is-compact" : "mt-3"}>
    <div className="assistant-model-picker-heading mb-1.5 flex items-center justify-between text-[11px] text-[var(--muted)]">
      <span>助手模型 · {sourceName}</span>
      <button type="button" disabled={pending} onClick={onRefresh}>{pending ? "读取中…" : "刷新"}</button>
    </div>
    <PopupSelect value={value} options={options} onChange={onChange} ariaLabel="智能助手模型" searchable searchPlaceholder="搜索对话模型"
      triggerClassName={compact ? "assistant-model-trigger" : ""} menuClassName="mobile-assistant-model-menu"
      menuMinWidth={compact ? 240 : 0}
      disabled={!options.length || disabled} emptyText={pending ? "正在读取模型…" : "暂无可用对话模型"} />
    {error && <p role="status" className="mt-1 text-[11px] text-[var(--rose)]">{error}</p>}
    {!pending && !error && !options.length && <p role="status" className="mt-1 text-[11px] text-[var(--muted)]">上游暂无可用对话模型，请刷新重试。</p>}
  </div>;
}
