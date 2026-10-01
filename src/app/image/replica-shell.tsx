"use client";

import Link from "next/link";
import { Aperture, BookOpen, Bot, Brush, ChevronRight, Dice5, Diamond, Folder, ImageIcon, Scan, Settings, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import "./replica-shell.css";

export function ReplicaNavigation({ onMenu, onAssistant }: { onMenu: () => void; onAssistant: () => void }) {
  return <nav className="replica-navigation" aria-label="工作台导航">
    <Link href="/" className="replica-brand" title="Love for NAI"><Aperture size={24} /></Link>
    <button type="button" className="is-active" aria-label="画布" title="画布" onClick={onMenu}><Brush size={23} /></button>
    <Link href="/settings#prompts" title="词库" aria-label="词库"><Folder size={23} /></Link>
    <Link href="/gallery" title="图片库" aria-label="图片库"><ImageIcon size={23} /></Link>
    <Link href="/settings#appearance" title="外观设置" aria-label="外观设置"><Sparkles size={23} /></Link>
    <Link href="/image/editor" title="图像编辑器" aria-label="图像编辑器"><Scan size={23} /></Link>
    <Link href="/settings#prompts" title="提示词收藏" aria-label="提示词收藏"><BookOpen size={22} /></Link>
    <Link href="/history" title="历史记录" aria-label="历史记录"><Dice5 size={23} /></Link>
    <span className="replica-navigation-spacer" />
    <Link href="/account" title="账户" aria-label="账户"><Users size={22} /></Link>
    <button type="button" title="聊天助手" aria-label="聊天助手" onClick={onAssistant}><Bot size={23} /></button>
    <Link href="/settings" title="设置" aria-label="设置"><Settings size={23} /></Link>
    <button type="button" title="站内菜单" aria-label="站内菜单" onClick={onMenu}><ChevronRight size={21} /></button>
  </nav>;
}

export function ReplicaGenerationFooter({ variant, settings, generating, disabled, progress, operationLabel, balance, cost, count, batchMode, onBatchModeChange, onRun }: {
  variant: "nai" | "nlw"; settings: ReactNode; generating: boolean; disabled: boolean;
  progress: string; operationLabel: string; balance: string; cost: string; count: number;
  batchMode: "once" | "sequential"; onBatchModeChange: (value: "once" | "sequential") => void; onRun: () => void;
}) {
  return <footer className="replica-generation-footer" data-replica-footer={variant} data-layout-module="generate">
    {settings}
    {variant === "nlw" && <div className="replica-generation-meta"><span title="账户可用额度"><Diamond size={14} />{balance}</span><span className="replica-generation-meta-spacer" /><span>{count}</span><button type="button" onClick={() => onBatchModeChange(batchMode === "once" ? "sequential" : "once")} title={batchMode === "once" ? "单次请求生成全部图片，点击切换分批" : "每张独立请求，点击切换一次性生成"}>×{count}</button><span className="replica-batch-label">{batchMode === "once" ? "一次性" : "分批"}</span></div>}
    <button type="button" className="replica-run-button" disabled={disabled || generating} onClick={onRun}><Sparkles size={22} /><span>{generating ? progress || "生成中…" : operationLabel}</span>{!generating && cost && <small title="预估费用，以实际账单为准">{cost}</small>}</button>
  </footer>;
}
