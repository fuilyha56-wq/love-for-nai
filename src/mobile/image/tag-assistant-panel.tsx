"use client";
import { AssistantResourcePicker } from "./assistant-resource-picker";
import { assistantDropFiles, hasAssistantImageDrag, type AssistantImageResource, type AssistantImageSource } from "@/lib/assistant-image-resource";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Expand, Minimize2, Plus, RefreshCw, Settings2, Sparkles, Square, Trash2, X } from "lucide-react";
import { AssistantModelPicker, AssistantSourceControl, type AssistantModelControl } from "./assistant-model-picker";
import { AssistantReasoningControl } from "./assistant-reasoning-control";
import { type useAssistantUsage } from "@/lib/client-assistant-usage";
import { AssistantUsagePanel, GoalRoundControl } from "@/mobile/image/assistant-usage-controls";
import { ASSISTANT_INPUT_MAX_LENGTH } from "@/lib/assistant-input";
import { MAX_ASSISTANT_IMAGES } from "@/lib/assistant-limits";
import { copyTextToClipboard } from "@/lib/client-clipboard";
import { AssistantMemoryEditor } from "./assistant-memory-editor";
import { MarkdownView } from "@/mobile/markdown";
import { AssistantSessionManager } from "./assistant-session-manager";
import type { AssistantConversationControl } from "@/app/ui/use-assistant-conversations";
import type { OperationSnapshot } from "@/lib/client-operation-queue";
import { AssistantWebControl } from "./assistant-web-control";
import { assistantShortcuts, type AssistantShortcut } from "@/lib/assistant-shortcuts";
import "./tag-assistant-panel.css";

type Tag = { name: string; displayName: string; categoryName: string; postCount: number };
type Suggestion = {
  imageModel?: string; modelProtocol?: string; goalComplete?: boolean; message?: string; englishDescription?: string;
  prompt: string; negativePrompt: string; tags: Tag[]; parameters: Record<string, unknown>;
  characters?: Array<{ prompt: string; centerX: number; centerY: number }>;
};
type Turn = { id: string; request: string; createdAt: string; message?: string; prompt: string; negativePrompt: string; tags: Tag[]; goalMode?: boolean };
type GoalRun = { id: string; goal: string; accessMode: "approval" | "full"; completedGenerations: number; maxGenerations: number; status: "running" | "complete" | "stopped" | "limit" | "needs-attention" };
type Step = { tool: string; query: string; ok: boolean; summary?: string };
type Props = {
  signedIn: boolean; natural: boolean; imageModel: string; style?: CSSProperties; tools?: ReactNode;
  mode: "tags" | "goal"; onModeChange: (mode: "tags" | "goal") => void;
  autonomy: "approval" | "full"; onAutonomyChange: (mode: "approval" | "full") => void;
  rounds: number; onRoundsChange: (rounds: number) => void; goal: GoalRun | null; onStopGoal: () => void; onClearGoal: () => void;
  modelControl: AssistantModelControl;
  sessionControl?: AssistantConversationControl;
  queueRunning?: boolean; messageQueue?: OperationSnapshot[];
  onQueue?: (input: string) => boolean | void; onRemoveQueued?: (id: string) => void; onClearQueued?: () => void; onClearQueueHistory?: () => void;
  usage: ReturnType<typeof useAssistantUsage>;
  input: string; onInputChange: (input: string) => void; onSubmit: (input?: string) => void | boolean | Promise<void>; onCancel: () => void;
  loading: boolean; searching: boolean; error: string;
  resourceScope?: string; imageResources?: AssistantImageResource[]; onAddImageSources?: (sources: AssistantImageSource[]) => void; onCancelImageImport?: () => void;
  images: string[]; imagesLoading: boolean; onAddImages: (files: File[]) => void; onRemoveImage: (index: number) => void; onClearImages: () => void; onPreviewImage: (image: string) => void;
  conversation: { turns: Turn[]; tagPool: Tag[] }; onClearConversation: () => void;
  steps: Step[]; results: Tag[]; suggestion: Suggestion | null;
  onAppendTag: (tag: string) => void; onReplacePrompt: () => void; onReplaceNegative: () => void; onApplyParameters: () => void; onApplyAll: () => void; onDismissSuggestion: () => void;
};

const toolLabels: Record<string, string> = {
  search_tag_catalog: "检索本地标签库", read_tag_catalog: "读取本地词条", tag_catalog_status: "核对标签库",
  search_danbooru_tags: "检索 Danbooru", verify_danbooru_tag: "校验 Danbooru", read_danbooru_wiki: "读取 Danbooru 词条",
  list_quicktagcloud_codexes: "读取 QuickTagCloud 目录", search_quicktagcloud_tags: "检索 QuickTagCloud", read_quicktagcloud_entry: "读取 QuickTagCloud 词条", web_search: "概念检索",
};

function PromptPreview({ label, value }: { label: string; value: string }) {
  const [expanded, setExpanded] = useState(false), [copied, setCopied] = useState(false);
  return <div className="assistant-prompt-preview">
    <div><b>{label}</b><button type="button" onClick={async () => {
      try { await copyTextToClipboard(value); setCopied(true); } catch { setCopied(false); }
    }} aria-label={`复制${label}`} title={`复制${label}`}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "展开"}</button></div>
    <p className={expanded ? "is-expanded" : ""}>{value}</p>
  </div>;
}

function MessageActions({ text, onEdit, onRetry, disabled }: { text: string; onEdit?: () => void; onRetry?: () => void; disabled?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null), [error, setError] = useState(false);
  return <div className="assistant-message-actions"><button type="button" aria-label="复制消息" onClick={async () => { try { await copyTextToClipboard(text); setCopied(text); setError(false); } catch { setError(true); } }}>{copied === text ? <Check size={13} /> : <Copy size={13} />}{error ? "复制失败，请选择文本复制" : copied === text ? "已复制" : "复制"}</button>{onEdit && <button type="button" disabled={disabled} onClick={onEdit}>编辑重发</button>}{onRetry && <button type="button" disabled={disabled} onClick={onRetry}><RefreshCw size={12} />重试</button>}</div>;
}

export function TagAssistantPanel(p: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false), [expandedInput, setExpandedInput] = useState(false), [allTurns, setAllTurns] = useState(false);
  const [referencesExpanded, setReferencesExpanded] = useState(true);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [shortcutIndex, setShortcutIndex] = useState(0), [shortcutsDismissed, setShortcutsDismissed] = useState(false);
  const sessionRef = useRef<HTMLDivElement>(null), sessionButtonRef = useRef<HTMLButtonElement>(null);
  const [submitted, setSubmitted] = useState("");
  const [follow, setFollow] = useState(true);
  const rootRef = useRef<HTMLElement>(null), composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null), settingsRef = useRef<HTMLDivElement>(null), settingsButtonRef = useRef<HTMLButtonElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  const followingRef = useRef(true), uploadRef = useRef<HTMLInputElement>(null);
  const countId = useId(), settingsId = useId(), shortcutId = useId();
  const busy = p.loading || p.searching || p.queueRunning || p.goal?.status === "running";
  const shortcuts = shortcutsDismissed ? [] : assistantShortcuts(p.input).filter((item) => (!(item.action === "sessions" || item.action === "new") || Boolean(p.signedIn && p.sessionControl)) && (item.action !== "new" || !busy) && (item.command !== "/negative" || !p.natural));
  const activeShortcut = Math.min(shortcutIndex, Math.max(0, shortcuts.length - 1));
  const sendLabel = p.searching ? "检索中…" : p.loading ? "模型分析中…" : p.mode === "goal" ? p.autonomy === "full" ? "开始自动迭代" : "请求目标建议" : "让助手处理";
  const latest = p.conversation.turns[0];
  const currentJobId = Object.keys(p.usage.state.jobs).at(-1);
  const turns = p.conversation.turns.filter((turn, index) => !(index === 0 && p.suggestion && turn.id === currentJobId));
  const visibleTurns = (allTurns ? turns : turns.slice(0, 6)).toReversed();
  const hasCurrent = Boolean(p.suggestion || p.loading || p.steps.length || p.results.length || p.error);
  const jumpToLatest = () => { const node = scrollRef.current; if (node) node.scrollTop = node.scrollHeight; followingRef.current = true; setFollow(true); };
  useEffect(() => {
    const node = composerRef.current; if (!node) return;
    const measure = () => {
      rootRef.current?.style.setProperty("--assistant-composer-height", `${node.getBoundingClientRect().height}px`);
      const transcript = scrollRef.current;
      if (followingRef.current && transcript) transcript.scrollTop = transcript.scrollHeight;
    };
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!followingRef.current) return;
    const frame = requestAnimationFrame(() => { const node = scrollRef.current; if (node) node.scrollTop = node.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [latest?.id, p.suggestion, p.loading, p.steps.length, p.error, p.results.length]);
  useEffect(() => {
    if (!settingsOpen) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Element && event.target.closest(".mobile-assistant-model-menu, .mobile-assistant-reasoning-menu")) return; if (!settingsRef.current?.contains(event.target as Node) && !settingsButtonRef.current?.contains(event.target as Node)) setSettingsOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); };
  }, [settingsOpen]);
  useEffect(() => {
    if (!sessionsOpen) return;
    const dismiss = (event: PointerEvent) => { if (!sessionRef.current?.contains(event.target as Node) && !sessionButtonRef.current?.contains(event.target as Node)) setSessionsOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [sessionsOpen]);
  function chooseShortcut(item: AssistantShortcut) {
    if (item.action === "new" && (busy || !p.sessionControl || p.sessionControl.pending)) return;
    if (item.action === "image" && (p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES)) return;
    setShortcutsDismissed(true); setShortcutIndex(0);
    if (item.input) p.onInputChange(item.input);
    else {
      p.onInputChange("");
      if (item.action === "sessions") { setSettingsOpen(false); setSessionsOpen(true); }
      else if (item.action === "new") void p.sessionControl?.create("新会话").catch(() => setSessionsOpen(true));
      else if (item.action === "image") uploadRef.current?.click();
    }
    if (!item.action) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }
  function submit() {
    const input = p.input.trim();
    if (p.imagesLoading || !input) return;
    if (busy) {
      if (p.mode === "tags" && p.onQueue && p.onQueue(input) !== false) { p.onInputChange(""); setInputCollapsed(true); inputRef.current?.blur(); }
      return;
    }
    const accepted = p.onSubmit(input);
    if (accepted === false) return;
    setSubmitted(input); setReferencesExpanded(false); jumpToLatest(); p.onInputChange("");
    inputRef.current?.blur(); setInputCollapsed(true);
  }
  function editMessage(text: string) { p.onInputChange(text); setInputCollapsed(false); requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); }
  function retryMessage(text: string) { if (busy) return; if (p.onSubmit(text) === false) return; setSubmitted(text); setInputCollapsed(true); }
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [imageDragActive, setImageDragActive] = useState(false);
  function addImages(files: File[]) { setReferencesExpanded(true); p.onAddImages(files); }
  return <section ref={rootRef} className={`mobile-tag-assistant-panel${inputCollapsed ? " is-input-collapsed" : ""}`} data-assistant-layout="aaalice-mobile" data-layout-module="agent" style={p.style} aria-label="创作助手" onKeyDownCapture={event => {
    if (event.key === "Escape" && sessionsOpen) { event.preventDefault(); event.stopPropagation(); setSessionsOpen(false); sessionButtonRef.current?.focus(); }
    if (event.key === "Escape" && settingsOpen && !document.querySelector(".mobile-assistant-model-menu, .mobile-assistant-reasoning-menu")) { event.preventDefault(); event.stopPropagation(); setSettingsOpen(false); settingsButtonRef.current?.focus(); }
  }}>
    {p.tools && <div className="assistant-layout-tools">{p.tools}</div>}
    <div className="assistant-panel-heading">
      <div className="assistant-panel-modes" role="group" aria-label="标签助手模式"><Sparkles size={16} />
        <button type="button" aria-pressed={p.mode === "tags"} disabled={busy} onClick={() => p.onModeChange("tags")}>标签助手</button>
        <button type="button" aria-pressed={p.mode === "goal"} disabled={busy} onClick={() => p.onModeChange("goal")}>目标 Agent</button>
      </div>
      {p.signedIn && p.sessionControl && <button ref={sessionButtonRef} type="button" className="assistant-session-trigger" aria-label="管理助手会话" aria-expanded={sessionsOpen} title={p.sessionControl.sessions.find((item) => item.id === p.sessionControl?.activeId)?.title || "助手会话"} onClick={() => { setSettingsOpen(false); setSessionsOpen(!sessionsOpen); }}>会话</button>}
      <button type="button" aria-label="清空助手对话" title="清空助手对话" disabled={busy || !p.conversation.turns.length && !p.conversation.tagPool.length} onClick={p.onClearConversation}><Trash2 size={15} /></button>
      <button ref={settingsButtonRef} type="button" aria-label="助手设置" title="助手设置" aria-expanded={settingsOpen} aria-controls={settingsId} onClick={() => { setSessionsOpen(false); setSettingsOpen(!settingsOpen); }}><Settings2 size={16} /></button>
    </div>
    {settingsOpen && <div ref={settingsRef} id={settingsId} className="assistant-panel-settings" role="region" aria-label="助手设置">
      <div className="assistant-settings-heading"><b>助手设置</b><button type="button" onClick={() => { setSettingsOpen(false); settingsButtonRef.current?.focus(); }} aria-label="关闭助手设置"><X size={16} /></button></div>
      <section className="assistant-settings-section"><h3>模型与思考</h3>
        <AssistantSourceControl {...p.modelControl} disabled={busy || !p.signedIn} />
        <div className="assistant-composer-models"><div className="assistant-settings-field"><span>对话模型</span><AssistantModelPicker {...p.modelControl} compact disabled={busy || !p.signedIn} /></div><div className="assistant-settings-field"><span>思考强度</span><AssistantReasoningControl model={p.modelControl.value} compact disabled={busy || !p.signedIn} /></div></div>
        <button type="button" className="assistant-settings-refresh" disabled={busy || p.modelControl.pending || !p.signedIn} onClick={p.modelControl.onRefresh}><RefreshCw size={14} />{p.modelControl.pending ? "刷新中…" : "刷新可用模型"}</button>
        <p>{p.modelControl.providerId && p.modelControl.providerId !== "newapi" ? "模型调用由所选自定义模型源计费。" : "模型调用使用当前账号的 NewAPI 额度。"}生图使用工作台当前参数和计价。</p>
      </section>
      <section className="assistant-settings-section"><h3>运行方式</h3>
        <div className="assistant-settings-segments" role="group" aria-label="助手运行方式"><button type="button" aria-pressed={p.mode === "tags"} disabled={busy} onClick={() => p.onModeChange("tags")}>标签助手</button><button type="button" aria-pressed={p.mode === "goal"} disabled={busy} onClick={() => p.onModeChange("goal")}>目标 Agent</button></div>
        {p.mode === "goal" && <div className="assistant-goal-settings">
        <div role="group" aria-label="Agent 执行权限"><button type="button" aria-pressed={p.autonomy === "approval"} disabled={busy} onClick={() => p.onAutonomyChange("approval")}>请求批准（默认）</button><button type="button" aria-pressed={p.autonomy === "full"} disabled={busy} onClick={() => p.onAutonomyChange("full")}>完全访问</button></div>
        {p.autonomy === "full" ? <><GoalRoundControl value={p.rounds} onChange={p.onRoundsChange} disabled={busy} /><p>最多 {p.rounds} 轮，每轮 1 张；自动应用调整，费用由当前账号承担。</p></> : <p>每轮提出调整建议，由你决定应用和生成。</p>}
      </div>}
        {p.mode === "tags" && <p>{p.natural ? `为 ${p.imageModel || "当前模型"} 整理场景描述与参考图修改。` : "按需查阅本地标签库、Danbooru 或 QuickTagCloud，校验并整理提示词。"}</p>}
      </section>
      <section className="assistant-settings-section"><h3>检索与创作记忆</h3><AssistantWebControl disabled={busy} /><p>此开关控制维基百科检索。标签来源可在消息中指定，已校验标签会保留在会话中。</p><AssistantMemoryEditor disabled={busy} /></section>
      {p.sessionControl && <section className="assistant-settings-section"><h3>会话与上下文</h3><button type="button" className="assistant-settings-session" disabled={busy} onClick={() => { setSettingsOpen(false); setSessionsOpen(true); }}>管理会话<ChevronDown size={14} /></button><p>新建、切换、重命名与删除会话；每个会话独立保留上下文。</p></section>}
      <details className="assistant-settings-help"><summary>输入与参考图说明</summary><p>Enter 发送，Shift + Enter 换行。可上传、粘贴或从资源库选择最多 10 张参考图；目标复核使用前 9 张与最新结果。</p></details>
    </div>}
    {sessionsOpen && p.sessionControl && <div ref={sessionRef} className="assistant-session-popover"><AssistantSessionManager control={p.sessionControl} disabled={busy} onClose={() => { setSessionsOpen(false); sessionButtonRef.current?.focus(); }} /></div>}
    <div className="assistant-transcript" ref={scrollRef} onScroll={() => {
      const node = scrollRef.current; if (!node) return;
      const near = node.scrollHeight - node.scrollTop - node.clientHeight < 72; followingRef.current = near; setFollow(near);
    }} role="log" aria-label="助手对话" aria-live="polite">
      
      {p.goal && <div className="assistant-goal-progress" role="status">
        <div><b>目标 Agent · 已生成 {p.goal.completedGenerations}{p.goal.accessMode === "full" ? ` / ${p.goal.maxGenerations}` : ""} 轮</b>{p.goal.status === "running" ? <button type="button" onClick={p.onStopGoal}>停止</button> : <button type="button" onClick={p.onClearGoal}>清除</button>}</div>
        <p>{p.goal.status === "running" ? p.goal.accessMode === "full" ? "Agent 正在迭代，生成后的图片会自动送回模型评估。" : "等待建议或下一张结果；所有改动都需要你手动应用。" : p.goal.status === "complete" ? "Agent 判断图像已达到目标。" : p.goal.status === "limit" ? "已达到完全访问轮数上限，最后建议仍可手动应用。" : p.goal.status === "stopped" ? "Agent 已停止。" : "Agent 暂停，请检查当前设置或重新发起目标。"}</p>
      </div>}
      {!visibleTurns.length && !hasCurrent && <div className="assistant-welcome">
        <div><Sparkles size={26} /></div><h3>{p.mode === "goal" ? "让想法逐步成形" : "从一个想法开始"}</h3>
        <p>{p.mode === "goal" ? "描述最终目标，助手会评估每轮结果并提出调整。" : "描述画面或添加参考图，整理成适合当前模型的提示词。"}</p>
        <button type="button" onClick={() => { p.onInputChange("请整理当前提示词，保留主体与画面意图，优化描述和结构。"); inputRef.current?.focus(); }}>整理当前提示词<ArrowUp size={13} /></button>
        <button type="button" disabled={p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES} onClick={() => uploadRef.current?.click()}>添加参考图<Plus size={13} /></button>
      </div>}
      {!allTurns && turns.length > visibleTurns.length && <button className="assistant-older-turns" type="button" onClick={() => { followingRef.current = false; setFollow(false); setAllTurns(true); }}>查看更早的 {turns.length - visibleTurns.length} 轮对话</button>}
      {visibleTurns.map(turn => <article className="assistant-conversation-turn" key={turn.id}>
        <div className="assistant-user-message">{turn.goalMode ? "目标 Agent · 结果评估" : turn.request}</div>
        <MessageActions text={turn.request} onEdit={() => editMessage(turn.request)} onRetry={() => retryMessage(turn.request)} disabled={busy} />
        <time>{new Date(turn.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
        {turn.message && <div className="assistant-message-markdown"><MarkdownView content={turn.message} /></div>}
        {turn.message && <MessageActions text={turn.message} />}
        {turn.prompt && <PromptPreview label="正向提示词" value={turn.prompt} />}
        {turn.negativePrompt && <PromptPreview label="负向提示词" value={turn.negativePrompt} />}
        {!!turn.tags.length && <div className="assistant-tag-list">{turn.tags.map(tag => <button type="button" key={tag.name} onClick={() => p.onAppendTag(tag.name)} title="追加到提示词">{tag.displayName}</button>)}</div>}
      </article>)}
      {hasCurrent && <div className="assistant-current-turn">
        {submitted && (p.loading || p.suggestion || p.error || latest?.request !== submitted) && <div className="assistant-user-message">{submitted}</div>}
        {(p.loading || p.steps.length > 0) && <details className="assistant-tool-activity" open={p.loading || undefined}><summary><span className={p.loading ? "assistant-working-dot" : ""} />{p.loading ? "正在处理" : "检索过程"}<span>{p.steps.length} 步</span><ChevronDown size={13} /></summary>
          <ol>{p.steps.map((step, index) => <li key={`${step.tool}-${index}`}><span className={step.ok ? "is-success" : "is-error"}>{step.ok ? "✓" : "✕"}</span><div><b>{toolLabels[step.tool] || step.tool}</b>{step.query && <p>{step.query}</p>}{step.summary && <small>{step.summary}</small>}</div></li>)}{p.loading && <li>模型思考中…</li>}</ol>
        </details>}
        {p.error && <p role="alert" className="assistant-error-message">{p.error}</p>}
        {p.suggestion && <div className="assistant-suggestion" aria-label="助手建议">
          {p.suggestion.message && <div className="assistant-message-markdown"><MarkdownView content={p.suggestion.message} /></div>}
          <MessageActions text={[p.suggestion.message, p.suggestion.prompt, p.suggestion.negativePrompt].filter(Boolean).join("\n\n")} onRetry={submitted || latest?.request ? () => retryMessage(submitted || latest?.request || "") : undefined} disabled={busy} />
          {p.suggestion.goalComplete !== undefined && p.mode === "goal" && <p className="assistant-result-status">{p.suggestion.goalComplete ? "当前图片已达到目标。" : "本轮仍需调整，建议如下。"}</p>}
          {p.suggestion.englishDescription && <PromptPreview label="英文画面描述" value={p.suggestion.englishDescription} />}
          {p.suggestion.prompt && <PromptPreview label="正向提示词" value={p.suggestion.prompt} />}
          {p.suggestion.negativePrompt && <PromptPreview label="负向提示词" value={p.suggestion.negativePrompt} />}
          {!!p.suggestion.tags.length && <PromptPreview label="已校验标签" value={p.suggestion.tags.map(tag => tag.name).join(", ")} />}
          {!!p.suggestion.characters?.length && <PromptPreview label={`多角色 · ${p.suggestion.characters.length} 个`} value={p.suggestion.characters.map((character, i) => `角色${i + 1}: ${character.prompt}（x ${character.centerX.toFixed(2)} / y ${character.centerY.toFixed(2)}）`).join("\n")} />}
          {!!Object.keys(p.suggestion.parameters).length && <PromptPreview label="推荐参数" value={JSON.stringify(p.suggestion.parameters)} />}
          <div className="assistant-suggestion-actions"><button type="button" className="is-primary" onClick={p.onApplyAll}>应用全部</button><button type="button" onClick={p.onReplacePrompt}>替换提示词</button>{!p.natural && <><button type="button" onClick={() => p.suggestion?.tags.forEach(tag => p.onAppendTag(tag.name))}>追加标签</button><button type="button" onClick={p.onReplaceNegative}>替换负向词</button></>}<button type="button" onClick={p.onApplyParameters}>应用参数</button><button type="button" onClick={p.onDismissSuggestion}>放弃建议</button></div>
        </div>}
        {!!p.results.length && <div className="assistant-tag-list">{p.results.map(tag => <button type="button" key={tag.name} onClick={() => p.onAppendTag(tag.name)} title={`${tag.categoryName} · ${tag.postCount.toLocaleString("zh-CN")} 张 · 追加到提示词`}>{tag.displayName}</button>)}</div>}
      </div>}
      {!!p.conversation.tagPool.length && <details className="assistant-tag-memory"><summary>已保留标签 · {p.conversation.tagPool.length}</summary><div className="assistant-tag-list">{p.conversation.tagPool.map(tag => <button type="button" key={tag.name} onClick={() => p.onAppendTag(tag.name)}>{tag.displayName}</button>)}</div></details>}
    </div>
    {!follow && <button type="button" className="assistant-jump-latest" aria-label="跳到最新消息" title="跳到最新消息" onClick={jumpToLatest}><ArrowDown size={14} />最新消息</button>}
    <div className="assistant-composer-area" ref={composerRef}>
      <div className="assistant-compose-bar"><button type="button" aria-label={inputCollapsed ? "展开助手输入区" : "折叠助手输入区"} aria-expanded={!inputCollapsed} onClick={() => {
        if (!inputCollapsed) { inputRef.current?.blur(); setExpandedInput(false); }
        setInputCollapsed(!inputCollapsed);
        if (inputCollapsed) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      }}>{inputCollapsed ? <ArrowUp size={14} /> : <ChevronDown size={14} />}<span>{inputCollapsed ? p.input ? "继续编辑草稿" : "发送新消息" : "收起输入区，阅读对话"}</span></button>{inputCollapsed && busy && <button type="button" onClick={p.goal?.status === "running" ? p.onStopGoal : p.onCancel}><Square size={13} />停止</button>}</div>
      {!!p.messageQueue?.length && <details className="assistant-message-queue"><summary>消息队列 · {p.messageQueue.filter((item) => item.status === "queued").length} 等待 · {p.messageQueue.filter((item) => item.status === "failed").length} 失败</summary><p>使用入队时的模型、提示词和参考图；仅在当前页面依次执行。</p><ol>{p.messageQueue.map((item) => <li key={item.id} data-status={item.status}><b>{{ queued: "等待", running: "处理中", cancelling: "停止中", completed: "完成", cancelled: "已取消", failed: "失败" }[item.status]}</b><div><span title={item.label}>{item.label}</span>{item.error && <small>{item.error}</small>}</div>{item.status === "queued" ? <button type="button" onClick={() => p.onRemoveQueued?.(item.id)} aria-label="移除排队消息">移除</button> : item.status === "running" ? <button type="button" onClick={p.onCancel} aria-label="停止队列当前任务">停止</button> : null}</li>)}</ol><div><button type="button" onClick={p.onClearQueued}>移除全部等待</button><button type="button" onClick={p.onClearQueueHistory}>清理已结束记录</button></div></details>}
      {p.signedIn && <AssistantUsagePanel usage={p.usage} goal={p.mode === "goal" && Boolean(p.goal)} compact />}
      <form className={`assistant-composer assistant-attachments${expandedInput ? " is-expanded" : ""}`} data-assistant-image-drop={imageDragActive ? "active" : undefined} onDragOver={event => { if (hasAssistantImageDrag(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setImageDragActive(true); } }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setImageDragActive(false); }} onDrop={event => { const files = assistantDropFiles(event.dataTransfer.files); setImageDragActive(false); if (files.length) { event.preventDefault(); event.stopPropagation(); addImages(files); } }} onSubmit={event => { event.preventDefault(); submit(); }}>
        {!!p.images.length && <div className="assistant-reference-tray"><div><button type="button" className="assistant-reference-toggle" aria-label={referencesExpanded ? "收起参考图" : "展开参考图"} aria-expanded={referencesExpanded} onClick={() => setReferencesExpanded(value => !value)}>参考图 {p.images.length} / {MAX_ASSISTANT_IMAGES}<ChevronDown size={12} /></button><button type="button" onClick={p.onClearImages}>清空</button></div><div className="assistant-attachments-grid" hidden={!referencesExpanded}>{p.images.map((image, index) => <div key={index}><button type="button" aria-label={`查看参考图 ${index + 1}`} onClick={() => p.onPreviewImage(image)}>
          {/* Local, already-compressed references must stay on the client. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={`参考图 ${index + 1}`} /><span>{index + 1}</span></button><button type="button" aria-label={`移除参考图 ${index + 1}`} onClick={() => p.onRemoveImage(index)}><X size={12} /></button></div>)}</div></div>}
        {!!shortcuts.length && <div id={shortcutId} className="assistant-shortcuts" role="listbox" aria-label="助手快捷指令">{shortcuts.map((item, index) => <button key={item.command} id={`${shortcutId}-${index}`} type="button" role="option" aria-selected={index === activeShortcut} disabled={item.action === "new" && p.sessionControl?.pending || item.action === "image" && (p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES)} onPointerDown={(event) => event.preventDefault()} onClick={() => chooseShortcut(item)}><b>{item.command}</b><span>{item.title}</span></button>)}</div>}
        <div className="assistant-editor"><textarea ref={inputRef} value={p.input} maxLength={ASSISTANT_INPUT_MAX_LENGTH} aria-label="标签助手输入" aria-describedby={countId} aria-controls={shortcuts.length ? shortcutId : undefined} aria-activedescendant={shortcuts.length ? `${shortcutId}-${activeShortcut}` : undefined} onChange={event => { setShortcutIndex(0); setShortcutsDismissed(false); p.onInputChange(event.target.value); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (shortcuts.length) {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setShortcutsDismissed(true); return; }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setShortcutIndex((activeShortcut + (event.key === "ArrowDown" ? 1 : shortcuts.length - 1)) % shortcuts.length); return; }
            if ((event.key === "Tab" || event.key === "Enter") && !event.shiftKey) { event.preventDefault(); chooseShortcut(shortcuts[activeShortcut]); return; }
          }
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault(); submit();
        }} onPaste={event => {
          const files = [...event.clipboardData.items].filter(item => item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
          if (files.length) { event.preventDefault(); addImages(files); }
        }} placeholder={p.mode === "goal" ? "描述你希望达到的画面…" : "给助手发送消息，可粘贴参考图…"} />
          <button type="button" aria-label={expandedInput ? "收起助手输入框" : "展开助手输入框"} aria-expanded={expandedInput} title={expandedInput ? "收起输入框" : "展开输入框"} onClick={() => setExpandedInput(!expandedInput)}>{expandedInput ? <Minimize2 size={13} /> : <Expand size={13} />}</button></div>
        <div className="assistant-composer-meta"><span>{p.imagesLoading ? "正在压缩参考图…" : shortcuts.length ? "↑↓选择 · Enter 填入 · Esc 收起" : "Enter 发送 · Shift + Enter 换行 · / 快捷指令"}</span><span id={countId} data-assistant-input-count>{p.input.length.toLocaleString()} / {ASSISTANT_INPUT_MAX_LENGTH.toLocaleString()} 字</span></div>
        {p.signedIn && <button type="button" className="assistant-model-settings assistant-model-settings-trigger" aria-label="打开模型与思考设置" aria-expanded={settingsOpen} onClick={() => { setSessionsOpen(false); setSettingsOpen(true); }}><Settings2 size={14} /><span>模型与思考设置</span><small>{p.modelControl.sourceName || (!p.modelControl.providerId || p.modelControl.providerId === "newapi" ? "NewAPI" : "自定义来源")} · {p.modelControl.value || "请选择模型"}</small><ChevronDown size={13} /></button>}
        <div className="assistant-composer-actions"><label className="assistant-add-reference" title={`添加参考图 · ${p.images.length} / ${MAX_ASSISTANT_IMAGES}`} aria-disabled={p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES}><Plus size={18} /><span>{p.images.length ? `${p.images.length} / ${MAX_ASSISTANT_IMAGES}` : "参考图"}</span><input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-label="上传识图图片" disabled={p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES} onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ""; addImages(files); }} /></label>
          {p.onAddImageSources && <button type="button" className="assistant-resource-button" aria-label="从资源库添加参考图" disabled={p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES} onClick={() => setResourcePickerOpen(true)}>资源库</button>}
    {p.imagesLoading && p.onCancelImageImport && <button type="button" className="assistant-resource-button" onClick={p.onCancelImageImport}>取消导入</button>}
    {busy && p.mode === "tags" && p.onQueue && <button type="button" className="assistant-enqueue-button" aria-label="排队发送助手消息" disabled={p.imagesLoading || !p.input.trim()} onClick={submit}>排队发送</button>}
          <span className="assistant-composer-spacer" />{p.goal?.status === "running" ? <button className="assistant-send-button" type="button" onClick={p.onStopGoal} aria-label="停止目标 Agent" title="停止自动迭代"><Square size={14} fill="currentColor" /></button> : p.loading ? <button className="assistant-send-button" type="button" onClick={p.onCancel} aria-label="取消助手任务" title="取消"><Square size={14} fill="currentColor" /></button> : <button type="submit" className="assistant-send-button" disabled={busy || p.imagesLoading || !p.input.trim()} aria-label={sendLabel} title={sendLabel}><ArrowUp size={18} /></button>}
        </div>
      </form>
    {resourcePickerOpen && <AssistantResourcePicker key={p.resourceScope || "current"} open scope={p.resourceScope || "current"} resources={p.imageResources || []} available={Math.max(0, MAX_ASSISTANT_IMAGES - p.images.length)} onClose={() => setResourcePickerOpen(false)} onSelect={sources => { setReferencesExpanded(true); p.onAddImageSources?.(sources); }}/>}
      {!p.signedIn && <p className="assistant-login-hint">登录后可使用 NewAPI 模型；当前可直接检索标签。</p>}
    </div>
  </section>;
}
