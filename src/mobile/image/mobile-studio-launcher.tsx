"use client";

import { ArrowLeft, Bell, Brush, ChevronDown, History, Images, Tags, MoreHorizontal, RefreshCw, SlidersHorizontal, Sparkles, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { usePanelHistory } from "@/app/ui/use-panel-history";
import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useDialogFocus } from "@/mobile/ui/use-dialog-focus";
import { useWorkspaceKeyboard } from "@/mobile/ui/use-workspace-keyboard";
import { PopupSelect, type SelectOption } from "@/mobile/ui/popup-select";
import { createPortal } from "react-dom";
import "./mobile-studio-launcher.css";

const subscribeToDocument = () => () => {};
const documentReady = () => true;
const serverDocumentReady = () => false;

export type MobileStudioSheet = "prompt" | "reference" | "size" | "parameters" | "tools" | "history" | "assistant" | "session";
type MobileStudioPage = "history" | "generate" | "more";
type WorkspacePane = "prompt" | "parameters" | "assistant";
const workspacePanes: WorkspacePane[] = ["prompt", "parameters", "assistant"];
function isWorkspacePane(value: MobileStudioSheet | null): value is WorkspacePane {
  return value === "prompt" || value === "parameters" || value === "assistant";
}

// Keep expensive editors mounted, with their own drafts, selection and scroll.
const WorkspaceContent = memo(function WorkspaceContent({ pane, active, children }: { pane: WorkspacePane; active: boolean; children: ReactNode }) {
  return <div className={`mobile-studio-workspace-content mobile-studio-${pane === "prompt" ? "prompt" : "sheet"}-content is-${pane}`} data-workspace-pane={pane} hidden={!active} inert={!active} aria-hidden={!active}>{children}</div>;
});

type Props = {
  promptSummary: string;
  model: string;
  operation: string;
  operationId?: string;
  generating?: boolean;
  isInpainting?: boolean;
  width: number;
  height: number;
  hasResults: boolean;
  hasSource?: boolean;
  resultContent?: ReactNode;
  sourcePreviewContent?: ReactNode;
  sourceStatusContent?: ReactNode;
  historyContent?: ReactNode | ((onReturnToGenerate: () => void) => ReactNode);
  historyToolbar?: ReactNode;
  moreContent?: ReactNode;
  promptContent?: ReactNode;
  parameterContent?: ReactNode;
  assistantContent?: ReactNode;
  onRefreshHistory?: () => void;
  operationOptions: SelectOption[];
  onSelectOperation: (operation: string) => void;
  onClearWorkspace?: () => void;
  onOpenSheet: (sheet: MobileStudioSheet) => void;
  sheet: MobileStudioSheet | null;
  sheetRequestId?: number;
  onCloseSheet: () => void;
  sheetRef?: RefObject<HTMLElement | null>;
  sheetContent?: ReactNode;
  footerContent?: ReactNode;
  referenceContent?: ReactNode;
  userName?: string;
  signedIn?: boolean;
  notice?: string;
  onDismissNotice?: () => void;
};

const sheetTitles: Record<MobileStudioSheet, string> = {
  prompt: "提示词与角色", reference: "参考图与编辑", size: "画布尺寸", parameters: "生成参数",
  tools: "更多工具", history: "历史记录", assistant: "标签助手", session: "账户与会话",
};

export function MobileStudioLauncher({ promptSummary, model, operation, operationId = "generate", operationOptions, generating = false, isInpainting = false, width, height, hasResults, hasSource = false, resultContent, sourcePreviewContent, sourceStatusContent, historyContent, historyToolbar, moreContent, promptContent, parameterContent, assistantContent, onRefreshHistory, onSelectOperation, onClearWorkspace, onOpenSheet, sheet, sheetRequestId = 0, onCloseSheet, sheetRef, sheetContent, footerContent, referenceContent, notice, onDismissNotice }: Props) {
  const [page, setPage] = useState<MobileStudioPage>("generate");
  const [workspace, setWorkspace] = useState<{ requestId: number; pane: WorkspacePane | null; visited: WorkspacePane[]; backToPrompt: boolean }>({ requestId: sheetRequestId, pane: isWorkspacePane(sheet) ? sheet : null, visited: isWorkspacePane(sheet) ? [sheet] : [], backToPrompt: false });
  // External actions (for example the prompt editor's assistant shortcut) may
  // request the same panel repeatedly. Reconcile that event once; tab clicks
  // remain local and do not rerender the entire generation studio.
  if (workspace.requestId !== sheetRequestId) {
    const next = isWorkspacePane(sheet) ? sheet : null;
    setWorkspace({ requestId: sheetRequestId, pane: next ?? workspace.pane,
      visited: next && !workspace.visited.includes(next) ? [...workspace.visited, next] : workspace.visited,
      backToPrompt: next === "prompt" ? false : next ? workspace.pane === "prompt" || workspace.backToPrompt : workspace.backToPrompt });
  }
  const legacySheet = sheet && !isWorkspacePane(sheet) ? sheet : null;
  const activePane = legacySheet ? null : workspace.pane;
  const activeSheet = legacySheet ?? activePane;
  usePanelHistory("lfnStudioPage", page === "generate" ? null : page, (next) => setPage(next === "history" || next === "more" ? next : "generate"));
  usePanelHistory("lfnStudioPanel", activeSheet, (next) => {
    const pane = isWorkspacePane(next as MobileStudioSheet) ? next as WorkspacePane : null;
    setWorkspace(previous => ({ ...previous, pane, backToPrompt: false,
      visited: pane && !previous.visited.includes(pane) ? [...previous.visited, pane] : previous.visited }));
    if (next && !pane) onOpenSheet(next as MobileStudioSheet);
    else if (sheet) onCloseSheet();
  });
  const dialogOpen = Boolean(activeSheet);
  useWorkspaceKeyboard(dialogOpen);
  const promptOpen = activePane === "prompt";
  const generateScrollRef = useRef<HTMLDivElement>(null);
  const inlinePromptToggleRef = useRef<HTMLButtonElement>(null);
  const ownSheetRef = useRef<HTMLElement>(null);
  const activeSheetRef = sheetRef ?? ownSheetRef;
  useDialogFocus(dialogOpen, activeSheetRef);
  const status = hasResults ? `最近结果 · ${width}×${height}` : "准备开始创作";
  useLayoutEffect(() => {
    if (generateScrollRef.current) generateScrollRef.current.scrollTop = 0;
  }, [hasSource, hasResults, operationId]);

  useLayoutEffect(() => {
    if (!dialogOpen || !(document.activeElement instanceof HTMLElement) || !document.activeElement.closest("[hidden], [inert]")) return;
    activeSheetRef.current?.querySelector<HTMLButtonElement>('.mobile-studio-workspace-switch [aria-current="page"], .mobile-studio-sheet-header button')?.focus({ preventScroll: true });
  }, [activeSheet, dialogOpen, activeSheetRef]);

  function openWorkspace(next: WorkspacePane) {
    setWorkspace((previous) => ({ ...previous, pane: next,
      visited: previous.visited.includes(next) ? previous.visited : [...previous.visited, next],
      backToPrompt: next === "prompt" ? false : previous.pane === "prompt" || previous.backToPrompt }));
  }

  function openSheet(next: MobileStudioSheet) {
    if (isWorkspacePane(next)) openWorkspace(next);
    else onOpenSheet(next);
  }

  function closeWorkspace() {
    setWorkspace((previous) => ({ ...previous, pane: null, backToPrompt: false }));
    if (sheet) onCloseSheet();
  }

  function goBack() {
    if (legacySheet) onCloseSheet();
    else if (activePane !== "prompt" && workspace.backToPrompt) openWorkspace("prompt");
    else closeWorkspace();
  }

  function workspaceSwitch(active: "prompt" | "parameters" | "assistant") {
    return <nav className="mobile-studio-workspace-switch" aria-label="工作面板">
      <button type="button" aria-current={active === "prompt" ? "page" : undefined} onClick={() => openWorkspace("prompt")}><Sparkles size={17} />提示词</button>
      <button type="button" aria-current={active === "parameters" ? "page" : undefined} onClick={() => openWorkspace("parameters")}><SlidersHorizontal size={17} />参数</button>
      <button type="button" aria-current={active === "assistant" ? "page" : undefined} onClick={() => openWorkspace("assistant")}><WandSparkles size={17} />助手</button>
    </nav>;
  }

  function renderPromptEntry(toggleRef: RefObject<HTMLButtonElement | null>) {
    return <div className="mobile-studio-prompt-entry">
      <button ref={toggleRef} className="mobile-studio-prompt-toggle" type="button" aria-expanded={promptOpen} aria-haspopup="dialog" onClick={() => openWorkspace("prompt")}>
        <span><b>{isInpainting ? "局部重绘提示词" : "提示词"}</b><small>{promptSummary || "输入提示词开始创作"}</small></span>
        <ChevronDown className={promptOpen ? "is-open" : undefined} size={17} aria-hidden="true" />
      </button>
    </div>;
  }

  const generatePage = <>
    <header className="mobile-studio-workbar">
      <div className="mobile-studio-workbar-title"><Brush size={20} aria-hidden="true" /><div><b>画布</b><small>{model || "选择模型"}</small></div></div>
      <div className="mobile-studio-workbar-actions">
        <button type="button" aria-label="打开生成参数" title="生成参数" onClick={() => openSheet("parameters")}><SlidersHorizontal size={20} /><span>参数</span></button>
        <button type="button" aria-label="打开标签助手" title="标签助手" onClick={() => openSheet("assistant")}><WandSparkles size={20} /><span>助手</span></button>
        <button type="button" aria-label="打开历史记录" title="历史记录" onClick={() => openSheet("history")}><History size={20} /><span>历史</span></button>
        <Link href="/notifications" aria-label="查看消息" title="消息"><Bell size={20} /><span>消息</span></Link>
      </div>
    </header>
    <div className="mobile-studio-mode-selector" data-current-operation={operationId}>
      <span>生成模式</span><PopupSelect ariaLabel="生成模式" value={operationId} options={operationOptions} disabled={generating} onChange={onSelectOperation} />
      <span className="sr-only" role="status">当前：{operation}</span>
    </div>
    <div ref={generateScrollRef} className={`mobile-studio-generate-scroll${isInpainting ? " is-inpainting" : ""}`}>
      <section className={`mobile-studio-preview-section${!hasResults && sourcePreviewContent ? " has-source-preview" : ""}`} aria-label={hasResults ? "生成结果预览" : sourcePreviewContent ? "当前参考图片" : "生成结果预览"}>
        {(hasResults || hasSource) && onClearWorkspace && <div className="mobile-studio-preview-toolbar"><span>{hasResults ? "生成结果" : "参考图片"}</span><button type="button" disabled={generating} onClick={onClearWorkspace} title="清空当前预览与参考图片，保留历史记录"><X size={16} aria-hidden="true" />清空工作区</button></div>}
        {hasResults ? resultContent : sourcePreviewContent || <div className="mobile-studio-empty-preview"><Sparkles size={30} /><b>画布等待你的想象</b><span>{status}</span></div>}
      </section>
      <section className="mobile-studio-reference-panel" aria-label="参考图与编辑工具">
        {hasResults && sourceStatusContent && <div className="mobile-studio-source-status">{sourceStatusContent}</div>}
        {referenceContent}
      </section>
    </div>
    <section className={`mobile-studio-prompt-section is-compact${promptOpen ? " is-placeholder" : ""}`} aria-label="提示词区域" aria-hidden={promptOpen}>{renderPromptEntry(inlinePromptToggleRef)}</section>
  </>;
  const historyPage = <>
    <header className="mobile-studio-page-heading is-history"><span className="mobile-studio-heading-icon" aria-hidden="true"><History size={21} /></span><b>历史画廊</b><button type="button" aria-label="刷新历史" onClick={() => { setPage("history"); onRefreshHistory?.(); }}><RefreshCw size={18} /></button></header>
    {historyToolbar && <div className="mobile-studio-history-toolbar">{historyToolbar}</div>}
    <div className="mobile-studio-history-scroll">{(typeof historyContent === "function" ? historyContent(() => setPage("generate")) : historyContent) || <div className="mobile-studio-empty-page"><History size={36} /><b>暂无历史记录</b><span>生成图片后会显示在这里</span></div>}</div>
  </>;
  const morePage = <>
    <header className="mobile-studio-page-heading is-more"><b>更多</b></header>
    <div className="mobile-studio-more-scroll">{moreContent}</div>
  </>;
  const clientReady = useSyncExternalStore(subscribeToDocument, documentReady, serverDocumentReady);
  const portalTarget = clientReady ? document.body : null;
  return <div className="mobile-studio-launcher" data-mobile-studio-launcher="true" data-dialog-open={dialogOpen ? "true" : undefined} aria-hidden={dialogOpen || undefined} inert={dialogOpen}>
    <main className={`mobile-studio-page is-${page}`} inert={dialogOpen}>
      <div className="mobile-studio-page-panel" hidden={page !== "generate"}>{generatePage}</div>
      <div className="mobile-studio-page-panel" hidden={page !== "history"}>{historyPage}</div>
      <div className="mobile-studio-page-panel" hidden={page !== "more"}>{morePage}</div>
    </main>
    {notice && <div className="mobile-studio-notice" role="status" inert={dialogOpen}><span>{notice}</span><button type="button" aria-label="关闭工作台提示" onClick={onDismissNotice}><X size={18} /></button></div>}
    <div className="mobile-studio-footer" hidden={page !== "generate"} inert={dialogOpen}>{footerContent}</div>
    <nav className="mobile-studio-bottom-nav" aria-label="移动工作台导航" inert={dialogOpen}>
      <button type="button" aria-current={page === "generate" ? "page" : undefined} onClick={() => setPage("generate")}><Sparkles size={21} /><span>生成</span></button>
      <button type="button" aria-current={page === "history" ? "page" : undefined} onClick={() => setPage("history")}><History size={21} /><span>历史</span></button>
      <Link href="/gallery"><Images size={21} /><span>广场</span></Link>
      <Link href="/tags"><Tags size={21} /><span>词库</span></Link>
      <button type="button" aria-current={page === "more" ? "page" : undefined} onClick={() => setPage("more")}><MoreHorizontal size={21} /><span>更多</span></button>
    </nav>
    {portalTarget && (workspace.visited.length > 0 || legacySheet) && createPortal(<div className="mobile-studio-prompt-backdrop" role="presentation" hidden={!dialogOpen} inert={!dialogOpen} onClick={goBack}>
      <section ref={activeSheetRef} tabIndex={-1} className="mobile-studio-prompt-dialog mobile-studio-workspace-dialog" data-active-pane={activePane || undefined} role="dialog" aria-modal={dialogOpen ? "true" : undefined} aria-label={activeSheet === "prompt" ? "提示词区域" : activeSheet ? sheetTitles[activeSheet] : undefined} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); goBack(); } }}>
        <header className="mobile-studio-sheet-header"><button type="button" aria-label={activePane === "prompt" ? "收起提示词" : `关闭${activeSheet ? sheetTitles[activeSheet] : "工作面板"}`} onClick={goBack}><ArrowLeft size={20} /></button><b>{activeSheet ? sheetTitles[activeSheet] : "工作面板"}{activePane === "parameters" && <small className="mobile-studio-workspace-dimensions">{width}×{height}</small>}</b>{activePane && <button type="button" className="mobile-studio-workspace-done" onClick={closeWorkspace}>完成</button>}</header>
        {activePane && workspaceSwitch(activePane)}
        {workspacePanes.map((pane) => workspace.visited.includes(pane) && <WorkspaceContent key={pane} pane={pane} active={activePane === pane}>{pane === "prompt" ? promptContent : pane === "parameters" ? parameterContent : assistantContent}</WorkspaceContent>)}
        {legacySheet && <div className="mobile-studio-sheet-content">{legacySheet === "reference" ? <>{referenceContent}{sheetContent}</> : sheetContent}</div>}
      </section>
    </div>, portalTarget)}
  </div>;
}
