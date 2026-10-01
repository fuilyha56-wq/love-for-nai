"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, ChevronDown, Copy, Dice5, Pin, Plus, Settings2, Sparkles, Tag, Type, X } from "lucide-react";
import {
  parseReplicaPromptConfig, qualityPrompt, randomReplicaPrompt, REPLICA_SHARED_PRESET_KEYS,
  splitPromptTags, supportsLightQuality, ucPrompt, withSharedReplicaPresets, resolvePromptAliases, validatePromptRegex, applyPromptRegex,
  type PromptCompositionPart, type PromptTarget, type PromptRegexRule, type QualityPreset, type ReplicaPromptConfig, type ReplicaVariant, type UcPreset,
} from "@/lib/replica-prompt";
import { clampPromptEditorHeight, PROMPT_EDITOR_HEIGHTS } from "@/lib/prompt-completion";
import { ReplicaFixedTagsDialog, ReplicaPromptModal } from "./replica-fixed-tags-dialog";
import { PromptAutocompleteTextarea } from './prompt-autocomplete';
import { TagChipEditor } from './tag-chip-editor';
import { InlineChatMenu, InlineChatZone, type InlineChatSession } from './inline-chat';
import { tagZh } from '@/lib/tag-translations';
import "./replica-prompt-editor.css";
import { resolveImageModelCapabilities, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { composeModelPrompt, transformModelPromptOnBlur } from "@/lib/model-prompt";

export type ReplicaPromptEditorProps = {
  variant: ReplicaVariant;
  prompt: string;
  negative: string;
  onPromptChange: (value: string) => void;
  onNegativeChange: (value: string) => void;
  onEffectiveChange?: (value: { prompt: string; negative: string }) => void;
  onAssistant?: (text: string) => void;
  model: string;
  imageProtocol?: ImageProviderProtocol;
  operation?: string;
  assistantModel?: string;
  historyPrompts?: string[];
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};
const memoryStorage = new Map<string, string>();
const STORAGE_EVENT = "replica-prompt-config-change";
async function copyPromptText(text: string) {
  if (!navigator.clipboard) throw new Error("剪贴板暂不可用");
  await navigator.clipboard.writeText(text);
}
function translatedPrompt(text: string) {
  return splitPromptTags(text).map((tag) => tagZh(tag.replace(/^[{[]+|[}\]]+$/g, "").replaceAll(" ", "_")) || tag).join(", ");
}
function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key) ?? memoryStorage.get(key) ?? null; }
  catch { return memoryStorage.get(key) ?? null; }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    memoryStorage.delete(key);
  }
  catch { if (value === null) memoryStorage.delete(key); else memoryStorage.set(key, value); }
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: key }));
}
function usePromptConfig(variant: ReplicaVariant) {
  const key = "lfn-replica-prompt-" + variant;
  const subscribe = useMemo(() => (listener: () => void) => {
    const keys: string[] = [key, REPLICA_SHARED_PRESET_KEYS.quality, REPLICA_SHARED_PRESET_KEYS.uc, "lfn-user-library"];
    const changed = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && !keys.includes(event.key)) return;
      if (event instanceof CustomEvent && event.detail !== null && !keys.includes(event.detail)) return;
      listener();
    };
    window.addEventListener("storage", changed);
    window.addEventListener(STORAGE_EVENT, changed);
    // /prompts saves in this window without firing storage; returning/re-focusing rereads it.
    window.addEventListener("focus", changed);
    window.addEventListener("pageshow", changed);
    window.addEventListener("popstate", changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      window.removeEventListener("storage", changed); window.removeEventListener(STORAGE_EVENT, changed);
      window.removeEventListener("focus", changed); window.removeEventListener("pageshow", changed);
      window.removeEventListener("popstate", changed); document.removeEventListener("visibilitychange", changed);
    };
  }, [key]);
  const serialized = useSyncExternalStore(subscribe, () => JSON.stringify([
    readStorage(key), readStorage(REPLICA_SHARED_PRESET_KEYS.quality), readStorage(REPLICA_SHARED_PRESET_KEYS.uc), readStorage("lfn-user-library"),
  ]), () => "[null,null,null,null]");
  const config = useMemo(() => {
    const [saved, quality, uc, library] = JSON.parse(serialized) as [string | null, string | null, string | null, string | null];
    const config = withSharedReplicaPresets(parseReplicaPromptConfig(saved), quality, uc);
    let entries: unknown = [];
    try { entries = JSON.parse(library || "[]"); } catch { /* Invalid shared library is ignored. */ }
    if (Array.isArray(entries)) {
      const names = new Set(config.library.map((entry) => entry.name));
      config.library.push(...entries.slice(0, 500).flatMap((entry, index) => {
        if (!entry || typeof entry.name !== "string" || typeof entry.content !== "string" || !entry.content.trim() || names.has(entry.name)) return [];
        names.add(entry.name);
        return [{ id: "shared-library-" + index, name: entry.name.slice(0, 200), content: entry.content.slice(0, 100_000), target: "positive" as const, position: "prefix" as const, weight: 1, enabled: true, category: "我的词库" }];
      }));
    }
    return config;
  }, [serialized]);
  return [config, (next: ReplicaPromptConfig) => {
    if (next.qualityCustom.trim() !== config.qualityCustom) writeStorage(REPLICA_SHARED_PRESET_KEYS.quality, next.qualityCustom.trim() || null);
    if (next.ucCustom.trim() !== config.ucCustom) writeStorage(REPLICA_SHARED_PRESET_KEYS.uc, next.ucCustom.trim() || null);
    const sharedBefore = config.library.filter((entry) => entry.id.startsWith("shared-library-"));
    const sharedAfter = next.library.filter((entry) => entry.id.startsWith("shared-library-"));
    if (JSON.stringify(sharedBefore) !== JSON.stringify(sharedAfter)) {
      try {
        const original = JSON.parse(readStorage("lfn-user-library") || "[]") as unknown;
        if (Array.isArray(original)) {
          const represented = new Set(sharedBefore.map((entry) => entry.id));
          const updated = new Map(sharedAfter.map((entry) => [entry.id, entry]));
          writeStorage("lfn-user-library", JSON.stringify(original.flatMap((entry, index) => {
            const id = "shared-library-" + index;
            if (!represented.has(id)) return [entry];
            const replacement = updated.get(id);
            return replacement ? [{ ...entry, name: replacement.name, content: replacement.content }] : [];
          })));
        }
      } catch { /* A corrupt library does not prevent saving the editor's own preferences. */ }
    }
    writeStorage(key, JSON.stringify({ ...next, library: next.library.filter((entry) => !entry.id.startsWith("shared-library-")) }));
  }] as const;
}

function usePromptEditorHeight(variant: ReplicaVariant, target: PromptTarget) {
  const key = "lfn-prompt-editor-height-" + variant + "-" + target;
  const subscribe = useMemo(() => (listener: () => void) => {
    const changed = (event: Event) => { if ((event instanceof StorageEvent ? event.key : (event as CustomEvent).detail) === key) listener(); };
    window.addEventListener("storage", changed); window.addEventListener(STORAGE_EVENT, changed);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener(STORAGE_EVENT, changed); };
  }, [key]);
  const serialized = useSyncExternalStore(subscribe, () => readStorage(key), () => null);
  const fallback = variant === "nai" ? 112 : 144;
  const height = serialized && Number.isFinite(Number(serialized)) ? clampPromptEditorHeight(Number(serialized)) : fallback;
  return [height, (next: number | null) => writeStorage(key, next === null ? null : String(clampPromptEditorHeight(next)))] as const;
}

function PromptResizeHandle({ height, onChange }: { height: number; onChange: (height: number | null) => void }) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  return <div className="replica-prompt-resize-mark" role="separator" tabIndex={0} aria-label="调整提示词输入框高度" aria-orientation="horizontal"
    aria-valuemin={PROMPT_EDITOR_HEIGHTS.minimum} aria-valuemax={PROMPT_EDITOR_HEIGHTS.maximum} aria-valuenow={height}
    title="拖动调整高度；方向键调整；双击或 Home 恢复默认"
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); drag.current = { y: event.clientY, height }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={(event) => { if (drag.current) onChange(drag.current.height + event.clientY - drag.current.y); }}
    onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onDoubleClick={() => onChange(null)}
    onKeyDown={(event) => { if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); onChange(event.key === "Home" ? null : event.key === "End" ? PROMPT_EDITOR_HEIGHTS.maximum : height + (event.key === "ArrowDown" ? 24 : -24)); } }}><span /></div>;
}

function FloatingPanel({ variant, anchor, children, label, width = 400, onClose, onMouseEnter, onMouseLeave }: {
  variant: ReplicaVariant; anchor: RefObject<HTMLElement | null>; children: ReactNode; label: string; width?: number;
  onClose: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      const node = panel.current;
      if (!bounds || !node) return;
      const availableWidth = Math.max(0, window.innerWidth - 16);
      const actualWidth = Math.min(width, availableWidth);
      node.style.width = actualWidth + "px";
      node.style.left = Math.max(8, Math.min(bounds.left, window.innerWidth - actualWidth - 8)) + "px";
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const openAbove = below < 200 && above > below;
      node.style.maxHeight = Math.max(80, openAbove ? above : below) + "px";
      node.style.top = openAbove ? "auto" : bounds.bottom + 8 + "px";
      node.style.bottom = openAbove ? window.innerHeight - bounds.top + 8 + "px" : "auto";
      node.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); anchor.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape);
    };
  }, [anchor, width, onClose]);
  return createPortal(<div ref={panel} data-variant={variant} data-replica-menu className="replica-prompt-overlay" role="dialog" aria-label={label}
    style={{ visibility: "hidden" }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>{children}</div>, document.body);
}

function promptCount(text: string, natural: boolean): string {
  return natural ? `${Array.from(text).length} 字符` : `${splitPromptTags(text).length} 标签`;
}

function PromptComposition({ target, text, parts, natural }: { target: PromptTarget; text: string; parts: PromptCompositionPart[]; natural: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  return <div className={"replica-composition " + target}>
    <h4>{target === "positive" ? <Sparkles size={17} /> : <Ban size={17} />}{natural ? target === "positive" ? "场景描述" : "排除要求" : target === "positive" ? "正向提示词" : "负向提示词"}</h4>
    <section className="replica-final-prompt">
      <div><b>{natural ? target === "positive" ? "最终场景描述" : "最终排除要求" : target === "positive" ? "最终生效提示词" : "最终生效负面词"}</b><span>{promptCount(text, natural)}</span>
        <button type="button" aria-label="复制最终生效提示词" onClick={() => {
          void copyPromptText(text).then(() => { setCopied(true); setCopyError(""); }).catch(() => setCopyError("未能复制，请选择文本复制。"));
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
      <p className={expanded ? "" : "is-truncated"}>{text || (natural ? "暂无描述" : "暂无提示词")}</p>
      {!natural && text && <p className={"replica-prompt-translation" + (expanded ? "" : " is-truncated")}>{translatedPrompt(text)}</p>}
      {text.length > 220 && <button type="button" className="replica-expand-text" onClick={() => setExpanded(!expanded)}><ChevronDown size={15} />{expanded ? "收起全文" : "展开全文"}</button>}
      {copyError && <small role="status">{copyError}</small>}
    </section>
    <h5>◇ {natural ? "描述构成" : "提示词构成"}</h5>
    {parts.map((part, index) => <details key={index} open className={"replica-composition-part " + part.kind}>
      <summary><span>{part.label}</span><span>{natural ? promptCount(part.content, true) : splitPromptTags(part.content).length}</span><ChevronDown size={16} /></summary><p>{part.content}</p>{!natural && <p className="replica-prompt-translation">{translatedPrompt(part.content)}</p>}
    </details>)}
  </div>;
}

function PromptTextInput({ variant, target, value, onChange, config, onAssistant, assistantModel, onError, height, relatedSamples, imageModel, imageProtocol, operation, natural }: {
  variant: ReplicaVariant; target: PromptTarget; value: string; onChange: (value: string) => void; config: ReplicaPromptConfig;
  onAssistant?: (text: string) => void; assistantModel?: string; onError: (text: string) => void; height: number; relatedSamples: string[];
  imageModel: string; imageProtocol?: ImageProviderProtocol; operation?: string; natural: boolean;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const highlight = useRef<HTMLPreElement>(null);
  const [menuSelection, setMenuSelection] = useState<{ position: { x: number; y: number }; session: InlineChatSession } | null>(null);
  const [session, setSession] = useState<InlineChatSession | null>(null);
  const displayParts = value.split(/(\{+|\}+|\[+|\]+|\(+|\)+|-?(?:\d+(?:\.\d+)?|\.\d+)::|::|<[^<>\n]*>)/g);
  function contextMenu(event: React.MouseEvent<HTMLTextAreaElement>) {
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end);
    if (!selected.trim() || (!assistantModel && !onAssistant)) return;
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    setMenuSelection({ position: { x: event.clientX, y: event.clientY }, session: {
      target: { kind: target === 'positive' ? 'prompt' : 'negative', label: natural ? target === 'positive' ? '场景描述' : '排除要求' : target === 'positive' ? '正向提示词' : '负向提示词' },
      anchor: { top: Math.min(bounds.bottom + 5, Math.max(8, window.innerHeight - 200)), left: Math.max(8, bounds.left), width: Math.min(Math.max(bounds.width, 280), window.innerWidth - Math.max(8, bounds.left) - 8) },
      selection: { start, end, text: selected }, contextBefore: value.slice(0, start), contextAfter: value.slice(end), mode: 'ask', autoSend: false,
    } });
  }
  return <div ref={editor} style={{ height }} className={'replica-text-editor' + (!natural && config.settings.highlight ? ' has-highlight' : '')}
    onScrollCapture={(event) => { if (event.target instanceof HTMLTextAreaElement && highlight.current) { highlight.current.scrollTop = event.target.scrollTop; highlight.current.scrollLeft = event.target.scrollLeft; } }}
    onBlurCapture={(event) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      const result = transformModelPromptOnBlur(value, config, natural);
      if (result.text !== value) onChange(result.text);
      if (result.error) onError(result.error);
    }}>
    {!natural && config.settings.highlight && <pre ref={highlight} className='replica-syntax-highlight' aria-hidden='true'>{displayParts.map((text, index) => index % 2 ? <span key={index}>{text}</span> : text)}{'\n'}</pre>}
    <label htmlFor={inputId} className="replica-screen-reader-label" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>{target === "positive" ? "提示词" : "负面内容"}</label>
    <PromptAutocompleteTextarea id={inputId} value={value} onChange={onChange} autocomplete={!natural && config.settings.autocomplete}
      library={config.library} relatedSamples={relatedSamples} cooccurrence={!natural && config.settings.cooccurrence} onFeedback={onError}
      onCopy={(event) => {
        if (!config.settings.resolveAliasesOnCopy) return;
        const selected = value.slice(event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
        if (!selected) return;
        event.preventDefault(); event.clipboardData.setData("text/plain", resolvePromptAliases(selected, config.library));
      }}
      placeholder={target === 'positive' ? natural ? '描述主体、构图、风格、文字或希望对参考图做的修改…' : '输入提示词描述画面，输入 < 引用词库，支持自动补全标签' : '不想出现在图像中的内容…'}
      onContextMenu={contextMenu} className='replica-raw-textarea' />
    {onAssistant && <button type='button' className='replica-editor-assistant' aria-label='打开提示词助手' title='提示词助手' onClick={() => onAssistant(value)}><Sparkles size={17} /></button>}
    {menuSelection && createPortal(<div className='replica-prompt-overlay replica-inline-host' data-variant={variant}>
      <InlineChatMenu position={menuSelection.position} targetLabel={menuSelection.session.target.label} onClose={() => setMenuSelection(null)} onPick={(item) => {
        if (assistantModel) setSession({ ...menuSelection.session, mode: item.id, autoSend: item.autoSend });
        else onAssistant?.(item.description + '\n\n' + menuSelection.session.selection.text);
        setMenuSelection(null);
      }} />
    </div>, document.body)}
    {session && assistantModel && createPortal(<div className='replica-prompt-overlay replica-inline-host' data-variant={variant}>
      <InlineChatZone key={JSON.stringify([target, imageModel, imageProtocol || "auto", operation || "generate", assistantModel])} session={session} model={assistantModel} imageModel={imageModel} modelProtocol={imageProtocol} operation={operation} onClose={() => setSession(null)} onKeep={(replacement) => {
        if (value.slice(session.selection.start, session.selection.end) !== session.selection.text) { onError('所选提示词已变更，请重新选择后应用 AI 建议。'); return; }
        onChange(value.slice(0, session.selection.start) + replacement + value.slice(session.selection.end));
      }} />
    </div>, document.body)}
  </div>;
}
const qualityLabels: Record<QualityPreset, string> = { standard: "Standard", light: "Light", none: "None", custom: "Custom" };
const ucLabels: Record<UcPreset, string> = { heavy: "重度", light: "轻度", human: "人物专注", furry: "兽人专注", none: "无", custom: "自定义" };
const settingItems = [
  ["autocomplete", "智能补全", "输入时显示标签建议"],
  ["autoFormat", "自动格式化", "中文逗号转英文、标签内空格转下划线（保留换行）"],
  ["highlight", "高亮强调", "括号和权重语法高亮显示"],
  ["sdConvert", "SD语法自动转换", "失焦时将SD数字权重转换为NAI格式"],
  ["resolveAliasesOnCopy", "复制时展开词库", "复制时把 <词库名> 替换为词库内容"],
] as const;

export function ReplicaPromptEditor({ variant, prompt, negative, onPromptChange, onNegativeChange, onEffectiveChange, onAssistant, model, imageProtocol, operation, assistantModel, historyPrompts = [], collapsed, onCollapsedChange }: ReplicaPromptEditorProps) {
  const natural = resolveImageModelCapabilities(model, imageProtocol).promptStyle === "natural";
  const [config, saveConfig] = usePromptConfig(variant);
  const [target, setTarget] = useState<PromptTarget>("positive");
  const [editorHeight, setEditorHeight] = usePromptEditorHeight(variant, target);
  const [tagModes, setTagModes] = useState({ positive: false, negative: false });
  const [fixedOpen, setFixedOpen] = useState(false);
  const [menu, setMenu] = useState<"quality" | "uc" | "settings" | null>(null);
  const [hoverTarget, setHoverTarget] = useState<PromptTarget | null>(null);
  const [presetHover, setPresetHover] = useState<"quality" | "uc" | null>(null);
  const [customPreset, setCustomPreset] = useState<"quality" | "uc" | null>(null);
  const [customDraft, setCustomDraft] = useState("");
  const [regexOpen, setRegexOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [randomizing, setRandomizing] = useState(false);
  const positiveButton = useRef<HTMLButtonElement>(null);
  const negativeButton = useRef<HTMLButtonElement>(null);
  const qualityButton = useRef<HTMLButtonElement>(null);
  const ucButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const lastEffective = useRef("");
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canCollapse = variant === "nai" && Boolean(onCollapsedChange);
  const isCollapsed = canCollapse && Boolean(collapsed);
  const composition = useMemo(() => composeModelPrompt(prompt, negative, model, config, imageProtocol), [prompt, negative, model, config, imageProtocol]);
  const relatedSamples = useMemo(() => [...historyPrompts, ...config.library.map((entry) => entry.content)], [historyPrompts, config.library]);
  useEffect(() => {
    const fingerprint = JSON.stringify([composition.prompt, composition.negative]);
    if (lastEffective.current !== fingerprint) {
      lastEffective.current = fingerprint;
      onEffectiveChange?.({ prompt: composition.prompt, negative: composition.negative });
    }
  }, [composition.prompt, composition.negative, onEffectiveChange]);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  function hover(next: PromptTarget | null, wait = 200) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (next && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    hoverTimer.current = setTimeout(() => setHoverTarget(next), wait);
  }
  function toggleMenu(next: typeof menu) { setHoverTarget(null); setPresetHover(null); setMenu(menu === next ? null : next); }
  async function randomize(editorTarget: PromptTarget) {
    if (natural) { onAssistant?.("为当前图像模型创作一段随机的场景描述提示词。"); return; }
    if (randomizing) return;
    setRandomizing(true);
    try { (editorTarget === "positive" ? onPromptChange : onNegativeChange)(await randomReplicaPrompt()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "随机词库加载失败"); }
    finally { setRandomizing(false); }
  }
  function openCustom(preset: "quality" | "uc") {
    const key = REPLICA_SHARED_PRESET_KEYS[preset];
    setMenu(null); setCustomPreset(preset); setCustomDraft(readStorage(key) || "");
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: key }));
  }
  function editor(editorTarget: PromptTarget) {
    const value = editorTarget === "positive" ? prompt : negative;
    const change = editorTarget === "positive" ? onPromptChange : onNegativeChange;
    const editorKey = JSON.stringify([editorTarget, model, imageProtocol || "auto", operation || "generate", assistantModel]);
    return !natural && tagModes[editorTarget]
      ? <div key={editorKey} style={{ height: editorHeight }} className='replica-shared-tag-editor'><TagChipEditor value={value} onChange={change} zhOf={(tag) => tagZh(tag.replaceAll(' ', '_'))}
        autocomplete={config.settings.autocomplete} library={config.library} cooccurrence={config.settings.cooccurrence} relatedSamples={relatedSamples}
        resolveCopy={config.settings.resolveAliasesOnCopy ? (text) => resolvePromptAliases(text, config.library) : undefined} /></div>
      : <PromptTextInput key={editorKey} variant={variant} target={editorTarget} value={value} onChange={change} config={config} onAssistant={onAssistant} assistantModel={assistantModel} imageModel={model} imageProtocol={imageProtocol} operation={operation} natural={natural} onError={setNotice} height={editorHeight} relatedSamples={relatedSamples} />;
  }
  function presetButton(preset: "quality" | "uc", naiFooter = false) {
    if (natural) return null;
    const enabled = preset === "quality" ? config.quality !== "none" : config.uc !== "none";
    return <button type="button" ref={preset === "quality" ? qualityButton : ucButton}
      className={"replica-preset-button " + preset + (enabled ? " is-enabled" : "") + (naiFooter ? " is-footer" : "")}
      aria-label={preset === "quality" ? "选择质量词" : "选择负面质量词预设"} title={preset === "quality" ? "质量词" : "负面质量词"} aria-expanded={menu === preset}
      onClick={() => toggleMenu(preset)} onMouseEnter={() => { if (!menu && window.matchMedia("(hover: hover) and (pointer: fine)").matches) setPresetHover(preset); }} onMouseLeave={() => setPresetHover(null)}>
      {naiFooter ? <>{preset === "quality" ? "Quality Tags: " + qualityLabels[config.quality] : "UC Preset: " + ucLabels[config.uc]}<ChevronDown size={13} /></> : preset === "quality" ? <Sparkles size={18} /> : <Ban size={18} />}
    </button>;
  }
  function modeToggle(editorTarget: PromptTarget) {
    if (natural) return <span className="replica-editor-mode" title="当前模型使用自然语言描述"><Type size={17} /> 描述</span>;
    return <div className="replica-editor-mode" role="group" aria-label={(editorTarget === "positive" ? "正向" : "负向") + "编辑模式"}>
      <button type="button" aria-label="文本模式" aria-pressed={!tagModes[editorTarget]} title="切换到文本模式" onClick={() => setTagModes({ ...tagModes, [editorTarget]: false })}><Type size={17} /></button>
      <button type="button" aria-label="标签模式" aria-pressed={tagModes[editorTarget]} title="切换到标签模式" onClick={() => setTagModes({ ...tagModes, [editorTarget]: true })}><Tag size={17} /></button>
    </div>;
  }
  function copyCurrent() {
    const raw = target === "positive" ? prompt : negative;
    const value = config.settings.resolveAliasesOnCopy ? resolvePromptAliases(raw, config.library) : raw;
    void copyPromptText(value).then(() => setNotice("已复制提示词。")).catch(() => setNotice("未能复制，请选择文本复制。"));
  }
  return <section className={"replica-prompt" + (isCollapsed ? " is-collapsed" : "")} data-variant={variant} aria-label="提示词编辑器">
    {variant === "nlw" ? <>
      <div className="replica-prompt-toolbar">
        <div className="replica-prompt-tabs" role="tablist" aria-label="提示词类型">
          {(["positive", "negative"] as const).map((item) => <button type="button" key={item} ref={item === "positive" ? positiveButton : negativeButton} role="tab" aria-selected={target === item}
            className={item + (target === item ? " is-selected" : "")} onClick={() => { setTarget(item); setHoverTarget(null); }} onMouseEnter={() => hover(item)} onMouseLeave={() => hover(null, 180)}
             onFocus={() => hover(item, 0)} onBlur={() => hover(null, 180)}>{item === "positive" ? <Sparkles size={16} /> : <Ban size={16} />} {natural ? item === "positive" ? "描述" : "排除内容" : item === "positive" ? "正面" : "负面"} <span>{natural ? promptCount(item === "positive" ? prompt : negative, true) : splitPromptTags(item === "positive" ? prompt : negative).length}</span></button>)}
        </div>
        <button type="button" className="replica-fixed-button" aria-label="管理固定词" title="管理固定词" onClick={() => setFixedOpen(true)}><Pin size={16} /></button>
        {presetButton("quality")}{presetButton("uc")}
      </div>
      {editor(target)}
      <PromptResizeHandle height={editorHeight} onChange={setEditorHeight} />
      <footer className="replica-prompt-footer">
        <button type="button" className="replica-transparent-toggle" aria-pressed={config.transparent} onClick={() => saveConfig({ ...config, transparent: !config.transparent })}>透明背景</button>
        {modeToggle(target)}
        <button type="button" aria-label="随机提示词" title="随机提示词" disabled={randomizing} onClick={() => void randomize(target)}><Dice5 size={17} /></button>
        <button type="button" aria-label="清空当前提示词" title="清空" onClick={() => (target === "positive" ? onPromptChange : onNegativeChange)("")}><X size={17} /></button>
        <button type="button" ref={settingsButton} aria-label="提示词设置" title="提示词设置" aria-expanded={menu === "settings"} onClick={() => toggleMenu("settings")}><Settings2 size={18} /></button>
        <button type="button" className="replica-prompt-tag-count" title={natural ? "复制描述" : "复制提示词"} onClick={copyCurrent}>{promptCount(target === "positive" ? composition.prompt : composition.negative, natural)}</button>
      </footer>
    </> : <div className="replica-nai-prompt-cards">
      <div className={"replica-nai-prompt-card " + target}>
        <header>
          <div className="replica-nai-prompt-tabs" role="tablist" aria-label="提示词类型">
            {(["positive", "negative"] as const).map((item) => <button type="button" key={item} ref={item === "positive" ? positiveButton : negativeButton} role="tab" aria-selected={target === item}
               className={item + (target === item ? " is-selected" : "")} onClick={() => { setTarget(item); setMenu(null); setPresetHover(null); setHoverTarget(null); }}>{natural ? item === "positive" ? "描述" : "排除内容" : item === "positive" ? "提示词" : "UC"}</button>)}
          </div>
          <div className="replica-nai-prompt-actions"><button type="button" aria-label={"清空" + (target === "positive" ? "提示词" : "负面内容")} onClick={() => (target === "positive" ? onPromptChange : onNegativeChange)("")}><X size={16} /></button><button type="button" aria-label="随机提示词" disabled={randomizing} onClick={() => void randomize(target)}><Dice5 size={16} /></button>{canCollapse && <button type="button" className="replica-prompt-collapse" aria-label={isCollapsed ? "展开提示词" : "收起提示词"} aria-expanded={!isCollapsed} onClick={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            setMenu(null); setPresetHover(null); setHoverTarget(null);
            onCollapsedChange?.(!isCollapsed);
          }}><ChevronDown size={16} /></button>}</div>
        </header>
        {!isCollapsed && <>{editor(target)}
        <PromptResizeHandle height={editorHeight} onChange={setEditorHeight} />
        <footer>{target === "positive" ? <button type="button" className="replica-transparent-toggle" aria-pressed={config.transparent} onClick={() => saveConfig({ ...config, transparent: !config.transparent })}>{config.transparent ? <Check size={11} /> : <X size={11} />} 透明背景</button> : <span>{natural ? "排除要求" : "负向提示词"}</span>}{presetButton(target === "positive" ? "quality" : "uc", true)}</footer>
        <div className="replica-nai-editor-tools">{modeToggle(target)}<button type="button" className="replica-fixed-button" aria-label="管理固定词" title="管理固定词" onClick={() => setFixedOpen(true)}><Pin size={16} /></button><button type="button" ref={settingsButton} aria-label="提示词设置" title="提示词设置" aria-expanded={menu === "settings"} onClick={() => toggleMenu("settings")}><Settings2 size={18} /></button><button type="button" className="replica-prompt-tag-count" title={natural ? "复制描述" : "复制提示词"} onClick={copyCurrent}>{promptCount(target === "positive" ? composition.prompt : composition.negative, natural)}</button></div></>}
      </div>
    </div>}
    {notice && <p role="status" className="replica-prompt-notice">{notice}<button type="button" aria-label="关闭提示词提示" onClick={() => setNotice("")}><X size={12} /></button></p>}
    {variant === "nlw" && hoverTarget && !menu && <FloatingPanel variant={variant} anchor={hoverTarget === "positive" ? positiveButton : negativeButton} label="最终提示词详情" width={480} onClose={() => setHoverTarget(null)} onMouseEnter={() => hover(hoverTarget, 0)} onMouseLeave={() => hover(null, 180)}>
      <PromptComposition key={JSON.stringify([hoverTarget, model, imageProtocol || "auto"])} target={hoverTarget} text={hoverTarget === "positive" ? composition.prompt : composition.negative} parts={hoverTarget === "positive" ? composition.positiveParts : composition.negativeParts} natural={natural} />
    </FloatingPanel>}
    {!isCollapsed && presetHover && !menu && <FloatingPanel variant={variant} anchor={presetHover === "quality" ? qualityButton : ucButton} label="质量词详情" width={340} onClose={() => setPresetHover(null)}>
      <div className="replica-preset-preview"><b>{presetHover === "quality" ? "质量词（正面）" : "质量词（负面）"}</b><p>{(presetHover === "quality" ? qualityPrompt(model, config.quality, config.qualityCustom) : ucPrompt(model, config.uc, config.ucCustom)) || "未启用质量词"}</p></div>
    </FloatingPanel>}
    {!isCollapsed && menu && <FloatingPanel variant={variant} anchor={menu === "quality" ? qualityButton : menu === "uc" ? ucButton : settingsButton} label={menu === "settings" ? "提示词设置菜单" : "质量词预设菜单"} width={menu === "settings" ? 350 : 240} onClose={() => setMenu(null)}>
      {menu === "quality" ? <>{(["standard", ...(supportsLightQuality(model) ? ["light"] : []), "none", "custom"] as QualityPreset[]).map((preset) => <button type="button" className="replica-menu-row" key={preset} onClick={() => { if (preset === "custom") openCustom("quality"); else { saveConfig({ ...config, quality: preset }); setMenu(null); } }}>{config.quality === preset ? <Check size={16} /> : <span className="replica-check-placeholder" />}{qualityLabels[preset]}</button>)}</>
        : menu === "uc" ? <>{(["heavy", "light", "human", "furry", "none", "custom"] as UcPreset[]).map((preset) => <button type="button" className="replica-menu-row" key={preset} onClick={() => { if (preset === "custom") openCustom("uc"); else { saveConfig({ ...config, uc: preset }); setMenu(null); } }}>{config.uc === preset ? <Check size={16} /> : <span className="replica-check-placeholder" />}{ucLabels[preset]}</button>)}</>
        : <>{settingItems.filter(([key]) => !natural || key === "resolveAliasesOnCopy").map(([key, label, description]) => <label key={key} className="replica-setting-row"><input type="checkbox" checked={config.settings[key]} onChange={(event) => saveConfig({ ...config, settings: { ...config.settings, [key]: event.target.checked } })} /><span><b>{label}</b><small>{description}</small></span></label>)}
          <button type="button" className="replica-setting-row" onClick={() => { setMenu(null); setRegexOpen(true); }}><Settings2 size={18} /><span><b>正则替换规则…</b><small>已配置 {config.regexRules.length} 条规则</small></span><ChevronDown size={15} /></button>
          {!natural && <label className="replica-setting-row"><input type="checkbox" checked={config.settings.cooccurrence} onChange={(event) => saveConfig({ ...config, settings: { ...config.settings, cooccurrence: event.target.checked } })} /><span><b>共现标签推荐</b><small>选中标签、Ctrl+单击或 Ctrl+Shift+Space；根据本次历史与我的词库推荐</small></span></label>}</>}
    </FloatingPanel>}
    {fixedOpen && <ReplicaFixedTagsDialog variant={variant} config={config} onChange={saveConfig} onClose={() => setFixedOpen(false)} />}
    {customPreset && <ReplicaPromptModal variant={variant} title={customPreset === "quality" ? "自定义质量词" : "自定义负面质量词"} onClose={() => setCustomPreset(null)}
      footer={<><button type="button" onClick={() => setCustomPreset(null)}>取消</button><button type="button" className="replica-primary" onClick={() => { saveConfig(customPreset === "quality" ? { ...config, quality: "custom", qualityCustom: customDraft } : { ...config, uc: "custom", ucCustom: customDraft }); setCustomPreset(null); }}>保存</button></>}>
      <textarea className="replica-custom-preset-input" aria-label="自定义质量词内容" value={customDraft} onChange={(event) => setCustomDraft(event.target.value)} placeholder="输入质量标签，以逗号分隔" />
      {config.library.length > 0 && <div className="replica-preset-library"><b>从词库添加</b>{config.library.map((entry) => <button type="button" key={entry.id} onClick={() => setCustomDraft([customDraft.trim(), entry.content].filter(Boolean).join(", "))}>{entry.name || entry.content}</button>)}</div>}
    </ReplicaPromptModal>}
    {regexOpen && <PromptRegexDialog variant={variant} rules={config.regexRules} initialText={target === "positive" ? prompt : negative} onClose={() => setRegexOpen(false)}
      onSave={(rules) => { saveConfig({ ...config, regexRules: rules }); setRegexOpen(false); setNotice("替换规则已保存，将在提示词失焦时按顺序应用。"); }} />}
  </section>;
}

function PromptRegexDialog({ variant, rules, initialText, onSave, onClose }: { variant: ReplicaVariant; rules: PromptRegexRule[]; initialText: string; onSave: (rules: PromptRegexRule[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(rules);
  const [testText, setTestText] = useState(initialText);
  const invalid = draft.some((rule) => rule.enabled && validatePromptRegex(rule));
  const result = applyPromptRegex(testText, draft);
  const update = (id: string, patch: Partial<PromptRegexRule>) => setDraft(draft.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  function move(index: number, delta: number) { const next = [...draft]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setDraft(next); }
  return <ReplicaPromptModal variant={variant} title="正则替换规则" className="replica-regex-dialog" onClose={onClose}
    footer={<><button type="button" onClick={onClose}>取消</button><button type="button" className="replica-primary" disabled={invalid} onClick={() => onSave(draft)}>保存规则</button></>}>
    <p>规则按顺序在编辑器失焦时应用，先替换，再转换 SD 权重和格式。替换内容支持 $1、$2 等捕获组。</p>
    {!draft.length && <p>还没有规则，点击「添加规则」新建。</p>}
    {draft.map((rule, index) => <section key={rule.id} className="replica-regex-rule">
      <header><label><input type="checkbox" aria-label={"启用第 " + (index + 1) + " 条规则"} checked={rule.enabled} onChange={(event) => update(rule.id, { enabled: event.target.checked })} />规则 {index + 1}</label>
        <span><button type="button" disabled={index === 0} aria-label={"上移规则 " + (index + 1)} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === draft.length - 1} aria-label={"下移规则 " + (index + 1)} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={"删除规则 " + (index + 1)} onClick={() => setDraft(draft.filter((item) => item.id !== rule.id))}><X size={16} /></button></span>
      </header><div className="replica-regex-row"><label>匹配（正则表达式）<input aria-label={"第 " + (index + 1) + " 条正则表达式"} placeholder="例如：\\bblue[ _]hair\\b" value={rule.pattern} aria-invalid={Boolean(validatePromptRegex(rule))} onChange={(event) => update(rule.id, { pattern: event.target.value })} /></label>
        <label>替换为<input aria-label={"第 " + (index + 1) + " 条替换内容"} placeholder="例如：aqua hair" value={rule.replacement} onChange={(event) => update(rule.id, { replacement: event.target.value })} /></label></div>
      <label className="replica-regex-case"><input type="checkbox" checked={rule.flags !== "gi"} onChange={(event) => update(rule.id, { flags: event.target.checked ? "g" : "gi" })} />区分大小写</label>
      {validatePromptRegex(rule) && <small className="replica-regex-error" role="status">{validatePromptRegex(rule)}{!rule.enabled && "（规则已停用）"}</small>}
    </section>)}
    <button type="button" className="replica-tonal" disabled={draft.length >= 40} onClick={() => setDraft([...draft, { id: crypto.randomUUID(), pattern: "", replacement: "", enabled: true, flags: "g" }])}><Plus size={16} />添加规则</button>
    <div className="replica-regex-test"><label>试运行<textarea aria-label="正则试运行输入" value={testText} onChange={(event) => setTestText(event.target.value)} /></label><b>替换结果</b><output aria-label="正则替换预览">{result.error || result.text || "暂无内容"}</output></div>
  </ReplicaPromptModal>;
}
