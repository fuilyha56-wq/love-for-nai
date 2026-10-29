"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, RotateCcw, X } from "lucide-react";
import { useDialogFocus } from "@/mobile/ui/use-dialog-focus";
import { type PromptVersionTarget } from "@/lib/prompt-versions";
import { usePromptVersionContext } from "@/lib/client-prompt-version-context";
import "./prompt-versions.css";

export function PromptHistoryButton({ target, className }: { target: PromptVersionTarget; className?: string }) {
  const context = usePromptVersionContext();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(open, dialog);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  if (!context) return null;
  const versions = context.versions.filter((item) => item.target === target);
  const choices = versions.filter((item) => selected.includes(item.id));
  const title = target === "prompt" ? "提示词版本" : "排除内容版本";
  const time = (value: number) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
  return <>
    <button type="button" className={className || "prompt-history-trigger"} aria-label={title} title={title} aria-haspopup="dialog" onClick={() => {
      setSelected(versions[0] ? [versions[0].id] : []); setOpen(true);
    }}><History size={14} /></button>
    {open && createPortal(<div className="prompt-versions-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="prompt-versions-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }}>
        <header><div><h2>{title}</h2><p>自动保留最近 60 秒的每次修改，最新版本在前。可选择最多 4 个版本对比。</p></div><button type="button" aria-label="关闭版本记录" onClick={() => setOpen(false)}><X size={20} /></button></header>
        <div className="prompt-versions-body">
          <div className="prompt-versions-list" role="group" aria-label="选择要查看或对比的版本">
            {!versions.length && <p className="prompt-versions-empty">最近一分钟内没有记录。修改提示词后会自动保存。</p>}
            {versions.map((version, index) => <label className={selected.includes(version.id) ? "is-selected" : ""} key={version.id}>
              <input type="checkbox" checked={selected.includes(version.id)} disabled={!selected.includes(version.id) && choices.length >= 4} onChange={(event) => setSelected((current) => event.target.checked ? [...current, version.id] : current.filter((id) => id !== version.id))} />
              <span><b>{time(version.createdAt)}{index === 0 ? " · 最新" : ""}</b><small>{version.text.length} 字符</small><span className="prompt-version-summary">{version.text || "（空内容）"}</span></span>
            </label>)}
          </div>
          <div className="prompt-versions-details" aria-live="polite">
            {!choices.length && <p className="prompt-versions-empty">选择左侧版本查看完整内容；选择多个版本可逐一对比。</p>}
            {choices.map((version) => <article key={version.id}>
              <div><b>{time(version.createdAt)}</b><span>{version.text.length} 字符</span></div>
              <textarea aria-label={`${time(version.createdAt)} 的完整${target === "prompt" ? "提示词" : "排除内容"}`} value={version.text} readOnly placeholder="（空内容）" />
              <button type="button" className="prompt-version-restore" onClick={() => { context.restore(target, version.text); setOpen(false); }}><RotateCcw size={15} />恢复此版本</button>
            </article>)}
          </div>
        </div>
        <footer>记录仅保存在当前浏览器标签页；恢复操作也会产生新版本，方便再次回溯。</footer>
      </div>
    </div>, document.body)}
  </>;
}

export { PromptVersionProvider } from "@/lib/client-prompt-version-context";
