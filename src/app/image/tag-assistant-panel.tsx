"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Expand, Minimize2, Plus, RefreshCw, Settings2, Sparkles, Square, Trash2, X } from "lucide-react";
import { AssistantModelPicker, AssistantSourceControl, type AssistantModelControl } from "./assistant-model-picker";
import { AssistantReasoningControl } from "@/app/ui/assistant-reasoning-control";
import { AssistantUsagePanel, GoalRoundControl, type useAssistantUsage } from "@/app/ui/assistant-usage";
import { ASSISTANT_INPUT_MAX_LENGTH } from "@/lib/assistant-input";
import { MAX_ASSISTANT_IMAGES } from "@/lib/assistant-limits";
import { copyTextToClipboard } from "@/lib/client-clipboard";
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
  usage: ReturnType<typeof useAssistantUsage>;
  input: string; onInputChange: (input: string) => void; onSubmit: () => void; onCancel: () => void;
  loading: boolean; searching: boolean; error: string;
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

export function TagAssistantPanel(p: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false), [expandedInput, setExpandedInput] = useState(false), [allTurns, setAllTurns] = useState(false);
  const [referencesExpanded, setReferencesExpanded] = useState(true);
  const [submitted, setSubmitted] = useState("");
  const [follow, setFollow] = useState(true);
  const rootRef = useRef<HTMLElement>(null), composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null), settingsRef = useRef<HTMLDivElement>(null), settingsButtonRef = useRef<HTMLButtonElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  const followingRef = useRef(true), uploadRef = useRef<HTMLInputElement>(null);
  const countId = useId(), settingsId = useId();
  const busy = p.loading || p.searching || p.goal?.status === "running";
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
    const dismiss = (event: PointerEvent) => { if (!settingsRef.current?.contains(event.target as Node) && !settingsButtonRef.current?.contains(event.target as Node)) setSettingsOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); };
  }, [settingsOpen]);
  function submit() {
    if (busy || p.imagesLoading || !p.input.trim()) return;
    setSubmitted(p.input.trim()); setReferencesExpanded(false); jumpToLatest(); p.onSubmit();
  }
  function addImages(files: File[]) { setReferencesExpanded(true); p.onAddImages(files); }
  return <section ref={rootRef} className="tag-assistant-panel" data-assistant-layout="launcher" data-layout-module="agent" style={p.style} aria-label="创作助手" onKeyDownCapture={event => {
    if (event.key === "Escape" && settingsOpen) { event.preventDefault(); event.stopPropagation(); setSettingsOpen(false); settingsButtonRef.current?.focus(); }
  }}>
    {p.tools && <div className="assistant-layout-tools">{p.tools}</div>}
    <div className="assistant-panel-heading">
      <div className="assistant-panel-modes" role="group" aria-label="标签助手模式"><Sparkles size={16} />
        <button type="button" aria-pressed={p.mode === "tags"} disabled={busy} onClick={() => p.onModeChange("tags")}>标签助手</button>
        <button type="button" aria-pressed={p.mode === "goal"} disabled={busy} onClick={() => p.onModeChange("goal")}>目标 Agent</button>
      </div>
      <button type="button" aria-label="清空助手对话" title="清空助手对话" disabled={busy || !p.conversation.turns.length && !p.conversation.tagPool.length} onClick={p.onClearConversation}><Trash2 size={15} /></button>
      <button ref={settingsButtonRef} type="button" aria-label="助手设置" title="助手设置" aria-expanded={settingsOpen} aria-controls={settingsId} onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={16} /></button>
    </div>
    {settingsOpen && <div ref={settingsRef} id={settingsId} className="assistant-panel-settings" role="region" aria-label="助手设置">
      <div><b>助手设置</b><button type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭助手设置"><X size={16} /></button></div>
      <p>{p.natural ? `根据 ${p.imageModel || "当前模型"} 的能力整理场景描述和参考图修改。` : "自动查阅本地标签库、Danbooru 或 QuickTagCloud，也可在消息中指定来源。"}</p>
      <p>多轮对话保留上下文和已校验标签。支持上传或粘贴 10 张参考图，自动压缩；目标复核使用前 9 张与最新结果。</p>
      <p>Enter 发送，Shift + Enter 换行。{p.modelControl.providerId && p.modelControl.providerId !== "newapi" ? "模型调用由所选自定义模型源计费。" : "模型调用使用当前账号 NewAPI 额度。"}生图按工作台当前计价。</p>
      <button type="button" className="assistant-settings-refresh" disabled={p.modelControl.pending} onClick={p.modelControl.onRefresh}><RefreshCw size={14} />{p.modelControl.pending ? "刷新中…" : "刷新模型列表"}</button>
    </div>}
    <div className="assistant-transcript" ref={scrollRef} onScroll={() => {
      const node = scrollRef.current; if (!node) return;
      const near = node.scrollHeight - node.scrollTop - node.clientHeight < 72; followingRef.current = near; setFollow(near);
    }} role="log" aria-label="助手对话" aria-live="polite">
      {p.mode === "goal" && <div className="assistant-goal-settings">
        <div role="group" aria-label="Agent 执行权限"><button type="button" aria-pressed={p.autonomy === "approval"} disabled={busy} onClick={() => p.onAutonomyChange("approval")}>请求批准（默认）</button><button type="button" aria-pressed={p.autonomy === "full"} disabled={busy} onClick={() => p.onAutonomyChange("full")}>完全访问</button></div>
        {p.autonomy === "full" ? <><GoalRoundControl value={p.rounds} onChange={p.onRoundsChange} disabled={busy} /><p>最多 {p.rounds} 轮，每轮 1 张；自动应用调整，费用由当前账号承担。</p></> : <p>每轮提出调整建议，由你决定应用和生成。</p>}
      </div>}
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
        <time>{new Date(turn.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
        {turn.message && <p className="assistant-message-text">{turn.message}</p>}
        {turn.prompt && <PromptPreview label="正向提示词" value={turn.prompt} />}
        {!!turn.tags.length && <div className="assistant-tag-list">{turn.tags.map(tag => <button type="button" key={tag.name} onClick={() => p.onAppendTag(tag.name)} title="追加到提示词">{tag.displayName}</button>)}</div>}
      </article>)}
      {hasCurrent && <div className="assistant-current-turn">
        {submitted && (p.loading || p.suggestion || p.error || latest?.request !== submitted) && <div className="assistant-user-message">{submitted}</div>}
        {(p.loading || p.steps.length > 0) && <details className="assistant-tool-activity" open={p.loading || undefined}><summary><span className={p.loading ? "assistant-working-dot" : ""} />{p.loading ? "正在处理" : "检索过程"}<span>{p.steps.length} 步</span><ChevronDown size={13} /></summary>
          <ol>{p.steps.map((step, index) => <li key={`${step.tool}-${index}`}><span className={step.ok ? "is-success" : "is-error"}>{step.ok ? "✓" : "✕"}</span><div><b>{toolLabels[step.tool] || step.tool}</b>{step.query && <p>{step.query}</p>}{step.summary && <small>{step.summary}</small>}</div></li>)}{p.loading && <li>模型思考中…</li>}</ol>
        </details>}
        {p.error && <p role="alert" className="assistant-error-message">{p.error}</p>}
        {p.suggestion && <div className="assistant-suggestion" aria-label="助手建议">
          {p.suggestion.message && <p className="assistant-message-text">{p.suggestion.message}</p>}
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
      {p.signedIn && <AssistantUsagePanel usage={p.usage} goal={p.mode === "goal" && Boolean(p.goal)} compact />}
      <form className={`assistant-composer assistant-attachments${expandedInput ? " is-expanded" : ""}`} onSubmit={event => { event.preventDefault(); submit(); }}>
        {!!p.images.length && <div className="assistant-reference-tray"><div><button type="button" className="assistant-reference-toggle" aria-label={referencesExpanded ? "收起参考图" : "展开参考图"} aria-expanded={referencesExpanded} onClick={() => setReferencesExpanded(value => !value)}>参考图 {p.images.length} / {MAX_ASSISTANT_IMAGES}<ChevronDown size={12} /></button><button type="button" onClick={p.onClearImages}>清空</button></div><div className="assistant-attachments-grid" hidden={!referencesExpanded}>{p.images.map((image, index) => <div key={index}><button type="button" aria-label={`查看参考图 ${index + 1}`} onClick={() => p.onPreviewImage(image)}>
          {/* Local, already-compressed references must stay on the client. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={`参考图 ${index + 1}`} /><span>{index + 1}</span></button><button type="button" aria-label={`移除参考图 ${index + 1}`} onClick={() => p.onRemoveImage(index)}><X size={12} /></button></div>)}</div></div>}
        <div className="assistant-editor"><textarea ref={inputRef} value={p.input} maxLength={ASSISTANT_INPUT_MAX_LENGTH} aria-label="标签助手输入" aria-describedby={countId} onChange={event => p.onInputChange(event.target.value)} onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault(); submit();
        }} onPaste={event => {
          const files = [...event.clipboardData.items].filter(item => item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
          if (files.length) { event.preventDefault(); addImages(files); }
        }} placeholder={p.mode === "goal" ? "描述你希望达到的画面…" : "给助手发送消息，可粘贴参考图…"} />
          <button type="button" aria-label={expandedInput ? "收起助手输入框" : "展开助手输入框"} aria-expanded={expandedInput} title={expandedInput ? "收起输入框" : "展开输入框"} onClick={() => setExpandedInput(!expandedInput)}>{expandedInput ? <Minimize2 size={13} /> : <Expand size={13} />}</button></div>
        <div className="assistant-composer-meta"><span>{p.imagesLoading ? "正在压缩参考图…" : "Enter 发送 · Shift + Enter 换行"}</span><span id={countId} data-assistant-input-count>{p.input.length.toLocaleString()} / {ASSISTANT_INPUT_MAX_LENGTH.toLocaleString()} 字</span></div>
        {p.signedIn && <><AssistantSourceControl {...p.modelControl} disabled={busy} /><div className="assistant-composer-models"><AssistantModelPicker {...p.modelControl} compact disabled={busy} /><AssistantReasoningControl model={p.modelControl.value} compact /></div></>}
        <div className="assistant-composer-actions"><label className="assistant-add-reference" title={`添加参考图 · ${p.images.length} / ${MAX_ASSISTANT_IMAGES}`} aria-disabled={p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES}><Plus size={18} /><span>{p.images.length ? `${p.images.length} / ${MAX_ASSISTANT_IMAGES}` : "参考图"}</span><input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-label="上传识图图片" disabled={p.imagesLoading || p.images.length >= MAX_ASSISTANT_IMAGES} onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ""; addImages(files); }} /></label>
          <span className="assistant-composer-spacer" />{p.goal?.status === "running" ? <button className="assistant-send-button" type="button" onClick={p.onStopGoal} aria-label="停止目标 Agent" title="停止自动迭代"><Square size={14} fill="currentColor" /></button> : p.loading ? <button className="assistant-send-button" type="button" onClick={p.onCancel} aria-label="取消助手任务" title="取消"><Square size={14} fill="currentColor" /></button> : <button type="submit" className="assistant-send-button" disabled={busy || p.imagesLoading || !p.input.trim()} aria-label={sendLabel} title={sendLabel}><ArrowUp size={18} /></button>}
        </div>
      </form>
      {!p.signedIn && <p className="assistant-login-hint">登录后可使用 NewAPI 模型；当前可直接检索标签。</p>}
    </div>
  </section>;
}
