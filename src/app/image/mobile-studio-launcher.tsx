"use client";

import { ChevronDown, History, MoreHorizontal, RefreshCw, Sparkles, WandSparkles, X } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";
import "./mobile-studio-launcher.css";

export type MobileStudioSheet = "prompt" | "reference" | "size" | "parameters" | "tools" | "history" | "assistant" | "session";
type MobileStudioPage = "history" | "generate" | "more";

type Props = {
  promptSummary: string;
  model: string;
  operation: string;
  isInpainting?: boolean;
  width: number;
  height: number;
  hasResults: boolean;
  resultContent?: ReactNode;
  historyContent?: ReactNode;
  moreContent?: ReactNode;
  promptContent?: ReactNode;
  onRefreshHistory?: () => void;
  onSelectOperation?: (operation: "generate" | "inpainting") => void;
  onOpenSheet: (sheet: MobileStudioSheet) => void;
  sheet: MobileStudioSheet | null;
  onCloseSheet: () => void;
  sheetRef?: RefObject<HTMLElement | null>;
  sheetContent?: ReactNode;
  footerContent?: ReactNode;
  referenceContent?: ReactNode;
  userName?: string;
  signedIn?: boolean;
};

const sheetTitles: Record<MobileStudioSheet, string> = {
  prompt: "提示词与角色", reference: "参考图与编辑", size: "画布尺寸", parameters: "生成参数",
  tools: "更多工具", history: "历史记录", assistant: "标签助手", session: "账户与会话",
};

export function MobileStudioLauncher({ promptSummary, model, operation, isInpainting = false, width, height, hasResults, resultContent, historyContent, moreContent, promptContent, onRefreshHistory, onSelectOperation, onOpenSheet, sheet, onCloseSheet, sheetRef, sheetContent, footerContent, referenceContent }: Props) {
  const [page, setPage] = useState<MobileStudioPage>("generate");
  const [promptOpen, setPromptOpen] = useState(false);
  const status = hasResults ? `最近结果 · ${width}×${height}` : "准备开始创作";
  const sheetFromLeft = sheet === "reference" || sheet === "size" || sheet === "tools" || sheet === "assistant";
  const generatePage = <>
    <header className="mobile-studio-workbar">
      <div className="mobile-studio-workbar-title"><b>创作</b><small>{operation} · {model || "选择模型"}</small></div>
      <button type="button" className="mobile-studio-assistant-button" aria-label="打开标签助手" onClick={() => onOpenSheet("assistant")}><WandSparkles size={20} /></button>
    </header>
    <div className="mobile-studio-mode-tabs" role="tablist" aria-label="生成模式">
      <button type="button" role="tab" aria-selected={!isInpainting} onClick={() => onSelectOperation?.("generate")}>文生图</button>
      <button type="button" role="tab" aria-selected={isInpainting} onClick={() => onSelectOperation?.("inpainting")}>局部重绘</button>
    </div>
    <div className={`mobile-studio-generate-scroll${isInpainting ? " is-inpainting" : ""}`}>
      <section className="mobile-studio-preview-section" aria-label="生成结果预览">
        {hasResults ? resultContent : <div className="mobile-studio-empty-preview"><Sparkles size={30} /><b>画布等待你的想象</b><span>{status}</span></div>}
      </section>
      <section className={`mobile-studio-prompt-section${promptOpen ? " is-open" : " is-compact"}`} aria-label="提示词区域">
        {promptOpen && <div className="mobile-studio-prompt-content">{promptContent}</div>}
        <button className="mobile-studio-prompt-entry" type="button" aria-expanded={promptOpen} onClick={() => setPromptOpen((open) => !open)}>
          <span><b>{isInpainting ? "局部重绘提示词" : "提示词"}</b><small>{promptSummary || "输入提示词开始创作"}</small></span>
          <ChevronDown className={promptOpen ? "is-open" : undefined} size={17} aria-hidden="true" />
        </button>
      </section>
      <section className="mobile-studio-reference-panel" aria-label="参考图与编辑工具">{referenceContent}</section>
    </div>
  </>;
  const historyPage = <>
    <header className="mobile-studio-page-heading is-history"><span className="mobile-studio-heading-icon" aria-hidden="true"><History size={21} /></span><b>历史画廊</b><button type="button" aria-label="刷新历史" onClick={() => { setPage("history"); onRefreshHistory?.(); }}><RefreshCw size={18} /></button></header>
    <div className="mobile-studio-history-scroll">{historyContent || <div className="mobile-studio-empty-page"><History size={36} /><b>暂无历史记录</b><span>生成图片后会显示在这里</span></div>}</div>
  </>;
  const morePage = <>
    <header className="mobile-studio-page-heading is-more"><b>更多</b></header>
    <div className="mobile-studio-more-scroll">{moreContent}</div>
  </>;
  return <div className="mobile-studio-launcher" data-mobile-studio-launcher="true">
    <main className="mobile-studio-page">{page === "generate" ? generatePage : page === "history" ? historyPage : morePage}</main>
    {page === "generate" && footerContent}
    <nav className="mobile-studio-bottom-nav" aria-label="移动工作台导航">
      <button type="button" aria-current={page === "history" ? "page" : undefined} onClick={() => setPage("history")}><History size={21} /><span>历史</span></button>
      <button type="button" aria-current={page === "generate" ? "page" : undefined} onClick={() => setPage("generate")}><Sparkles size={21} /><span>生成</span></button>
      <button type="button" aria-current={page === "more" ? "page" : undefined} onClick={() => setPage("more")}><MoreHorizontal size={21} /><span>更多</span></button>
    </nav>
    {sheet && <div className={`mobile-studio-sheet-backdrop${sheetFromLeft ? " is-from-left" : ""}`} role="presentation" onClick={onCloseSheet}>
      <section ref={sheetRef} tabIndex={-1} className={`mobile-studio-sheet${sheetFromLeft ? " is-from-left" : ""}`} role="dialog" aria-modal="true" aria-label={sheetTitles[sheet]} onClick={(event) => event.stopPropagation()}>
        <div className="mobile-studio-sheet-handle" aria-hidden="true" />
        <header className="mobile-studio-sheet-header"><b>{sheetTitles[sheet]}</b><button type="button" aria-label={`关闭${sheetTitles[sheet]}`} onClick={onCloseSheet}><X size={19} /></button></header>
        <div className="mobile-studio-sheet-content">{sheet === "reference" ? referenceContent : sheetContent}</div>
      </section>
    </div>}
  </div>;
}
