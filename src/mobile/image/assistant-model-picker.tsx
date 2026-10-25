"use client";

import { PopupSelect, type SelectOption } from "@/mobile/ui/popup-select";

export function AssistantModelPicker({ value, options, pending, error, disabled, onChange, onRefresh }: {
  value: string; options: SelectOption[]; pending: boolean; error: string; disabled?: boolean;
  onChange: (value: string) => void; onRefresh: () => void;
}) {
  return <div className="mobile-assistant-model mt-3">
    <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--muted)]">
      <span>助手模型 · NewAPI</span>
      <button type="button" disabled={pending} onClick={onRefresh}>{pending ? "读取中…" : "刷新"}</button>
    </div>
    <PopupSelect appearance="filled" value={value} options={options} onChange={onChange} ariaLabel="智能助手模型" searchable searchPlaceholder="搜索对话模型"
      disabled={!options.length || disabled} emptyText={pending ? "正在读取 NewAPI 模型…" : "上游暂无可用对话模型"} />
    {error && <p role="status" className="mt-1 text-[11px] text-[var(--rose)]">{error}</p>}
    {!pending && !error && !options.length && <p role="status" className="mt-1 text-[11px] text-[var(--muted)]">上游暂无可用对话模型，请刷新重试。</p>}
  </div>;
}
