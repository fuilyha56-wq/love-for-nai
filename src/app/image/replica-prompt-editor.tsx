"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, ChevronDown, Copy, Dice5, Pin, Plus, Settings2, Sparkles, Tag, Type, X } from "lucide-react";
import {
  composeReplicaPrompt, parseReplicaPromptConfig, qualityPrompt, randomReplicaPrompt, REPLICA_SHARED_PRESET_KEYS,
  splitPromptTags, supportsLightQuality, transformPromptOnBlur, ucPrompt, withSharedReplicaPresets,
  type PromptCompositionPart, type PromptTarget, type QualityPreset, type ReplicaPromptConfig, type ReplicaVariant, type UcPreset,
} from "@/lib/replica-prompt";
import { ReplicaFixedTagsDialog, ReplicaPromptModal } from "./replica-fixed-tags-dialog";
import { PromptAutocompleteTextarea } from './prompt-autocomplete';
import { TagChipEditor } from './tag-chip-editor';
import { InlineChatMenu, InlineChatZone, type InlineChatSession } from './inline-chat';
import { tagZh } from '@/lib/tag-translations';
import "./replica-prompt-editor.css";

export type ReplicaPromptEditorProps = {
  variant: ReplicaVariant;
  prompt: string;
  negative: string;
  onPromptChange: (value: string) => void;
  onNegativeChange: (value: string) => void;
  onEffectiveChange?: (value: { prompt: string; negative: string }) => void;
  onAssistant?: (text: string) => void;
  model: string;
  assistantModel?: string;
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
    const keys: string[] = [key, REPLICA_SHARED_PRESET_KEYS.quality, REPLICA_SHARED_PRESET_KEYS.uc];
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
    readStorage(key), readStorage(REPLICA_SHARED_PRESET_KEYS.quality), readStorage(REPLICA_SHARED_PRESET_KEYS.uc),
  ]), () => "[null,null,null]");
  const config = useMemo(() => {
    const [saved, quality, uc] = JSON.parse(serialized) as [string | null, string | null, string | null];
    return withSharedReplicaPresets(parseReplicaPromptConfig(saved), quality, uc);
  }, [serialized]);
  return [config, (next: ReplicaPromptConfig) => {
    if (next.qualityCustom.trim() !== config.qualityCustom) writeStorage(REPLICA_SHARED_PRESET_KEYS.quality, next.qualityCustom.trim() || null);
    if (next.ucCustom.trim() !== config.ucCustom) writeStorage(REPLICA_SHARED_PRESET_KEYS.uc, next.ucCustom.trim() || null);
    writeStorage(key, JSON.stringify(next));
  }] as const;
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
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape);
    };
  }, [anchor, width, onClose]);
  return createPortal(<div ref={panel} data-variant={variant} className="replica-prompt-overlay" role="dialog" aria-label={label}
    style={{ visibility: "hidden" }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>{children}</div>, document.body);
}

function PromptComposition({ target, text, parts }: { target: PromptTarget; text: string; parts: PromptCompositionPart[] }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  return <div className={"replica-composition " + target}>
    <h4>{target === "positive" ? <Sparkles size={17} /> : <Ban size={17} />}{target === "positive" ? "正向提示词" : "负向提示词"}</h4>
    <section className="replica-final-prompt">
      <div><b>{target === "positive" ? "最终生效提示词" : "最终生效负面词"}</b><span>{splitPromptTags(text).length} 标签</span>
        <button type="button" aria-label="复制最终生效提示词" onClick={() => {
          void copyPromptText(text).then(() => { setCopied(true); setCopyError(""); }).catch(() => setCopyError("未能复制，请选择文本复制。"));
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
      <p className={expanded ? "" : "is-truncated"}>{text || "暂无提示词"}</p>
      {text && <p className={"replica-prompt-translation" + (expanded ? "" : " is-truncated")}>{translatedPrompt(text)}</p>}
      {text.length > 220 && <button type="button" className="replica-expand-text" onClick={() => setExpanded(!expanded)}><ChevronDown size={15} />{expanded ? "收起全文" : "展开全文"}</button>}
      {copyError && <small role="status">{copyError}</small>}
    </section>
    <h5>◇ 提示词构成</h5>
    {parts.map((part, index) => <details key={index} open className={"replica-composition-part " + part.kind}>
      <summary><span>{part.label}</span><span>{splitPromptTags(part.content).length}</span><ChevronDown size={16} /></summary><p>{part.content}</p><p className="replica-prompt-translation">{translatedPrompt(part.content)}</p>
    </details>)}
  </div>;
}

function PromptTextInput({ variant, target, value, onChange, config, onAssistant, assistantModel, onError }: {
  variant: ReplicaVariant; target: PromptTarget; value: string; onChange: (value: string) => void; config: ReplicaPromptConfig;
  onAssistant?: (text: string) => void; assistantModel?: string; onError: (text: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const highlight = useRef<HTMLPreElement>(null);
  const [menuSelection, setMenuSelection] = useState<{ position: { x: number; y: number }; session: InlineChatSession } | null>(null);
  const [session, setSession] = useState<InlineChatSession | null>(null);
  const displayParts = value.split(/(\{+|\}+|\[+|\]+|-?\d+(?:\.\d+)?::|::)/g);
  function contextMenu(event: React.MouseEvent<HTMLTextAreaElement>) {
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end);
    if (!selected.trim() || (!assistantModel && !onAssistant)) return;
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    setMenuSelection({ position: { x: event.clientX, y: event.clientY }, session: {
      target: { kind: target === 'positive' ? 'prompt' : 'negative', label: target === 'positive' ? '正向提示词' : '负向提示词' },
      anchor: { top: Math.min(bounds.bottom + 5, Math.max(8, window.innerHeight - 200)), left: Math.max(8, bounds.left), width: Math.min(Math.max(bounds.width, 280), window.innerWidth - Math.max(8, bounds.left) - 8) },
      selection: { start, end, text: selected }, contextBefore: value.slice(0, start), contextAfter: value.slice(end), mode: 'ask', autoSend: false,
    } });
  }
  return <div ref={editor} className={'replica-text-editor' + (config.settings.highlight ? ' has-highlight' : '')}
    onScrollCapture={(event) => { if (event.target instanceof HTMLTextAreaElement && highlight.current) { highlight.current.scrollTop = event.target.scrollTop; highlight.current.scrollLeft = event.target.scrollLeft; } }}
    onBlurCapture={(event) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      const result = transformPromptOnBlur(value, config);
      if (result.text !== value) onChange(result.text);
      if (result.error) onError(result.error);
    }}>
    {config.settings.highlight && <pre ref={highlight} className='replica-syntax-highlight' aria-hidden='true'>{displayParts.map((text, index) => index % 2 ? <span key={index}>{text}</span> : text)}{'\n'}</pre>}
    <label htmlFor={inputId} className="replica-screen-reader-label" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>{target === "positive" ? "提示词" : "负面内容"}</label>
    <PromptAutocompleteTextarea id={inputId} value={value} onChange={onChange} autocomplete={config.settings.autocomplete}
      placeholder={target === 'positive' ? '输入提示词描述画面，输入 < 引用词库，支持自动补全标签' : '不想出现在图像中的内容…'}
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
      <InlineChatZone session={session} model={assistantModel} onClose={() => setSession(null)} onKeep={(replacement) => {
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
  ["autoFormat", "自动格式化", "中文逗号转英文逗号（保留换行）"],
  ["highlight", "高亮强调", "括号和权重语法高亮显示"],
  ["sdConvert", "SD语法自动转换", "失焦时将SD数字权重转换为NAI格式"],
  ["resolveAliasesOnCopy", "复制时展开词库", "复制时把 <词库名> 替换为词库内容"],
] as const;

export function ReplicaPromptEditor({ variant, prompt, negative, onPromptChange, onNegativeChange, onEffectiveChange, onAssistant, model, assistantModel, collapsed, onCollapsedChange }: ReplicaPromptEditorProps) {
  const [config, saveConfig] = usePromptConfig(variant);
  const [target, setTarget] = useState<PromptTarget>("positive");
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
  const composition = useMemo(() => composeReplicaPrompt(prompt, negative, model, config), [prompt, negative, model, config]);
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
    return tagModes[editorTarget]
      ? <div key={editorTarget} className='replica-shared-tag-editor'><TagChipEditor value={value} onChange={change} zhOf={(tag) => tagZh(tag.replaceAll(' ', '_'))} /></div>
      : <PromptTextInput key={editorTarget} variant={variant} target={editorTarget} value={value} onChange={change} config={config} onAssistant={onAssistant} assistantModel={assistantModel} onError={setNotice} />;
  }
  function presetButton(preset: "quality" | "uc", naiFooter = false) {
    const enabled = preset === "quality" ? config.quality !== "none" : config.uc !== "none";
    return <button type="button" ref={preset === "quality" ? qualityButton : ucButton}
      className={"replica-preset-button " + preset + (enabled ? " is-enabled" : "") + (naiFooter ? " is-footer" : "")}
      aria-label={preset === "quality" ? "选择质量词" : "选择负面质量词预设"} title={preset === "quality" ? "质量词" : "负面质量词"} aria-expanded={menu === preset}
      onClick={() => toggleMenu(preset)} onMouseEnter={() => { if (!menu && window.matchMedia("(hover: hover) and (pointer: fine)").matches) setPresetHover(preset); }} onMouseLeave={() => setPresetHover(null)}>
      {naiFooter ? <>{preset === "quality" ? "Quality Tags: " + qualityLabels[config.quality] : "UC Preset: " + ucLabels[config.uc]}<ChevronDown size={13} /></> : preset === "quality" ? <Sparkles size={18} /> : <Ban size={18} />}
    </button>;
  }
  function modeToggle(editorTarget: PromptTarget) {
    return <div className="replica-editor-mode" role="group" aria-label={(editorTarget === "positive" ? "正向" : "负向") + "编辑模式"}>
      <button type="button" aria-label="文本模式" aria-pressed={!tagModes[editorTarget]} title="切换到文本模式" onClick={() => setTagModes({ ...tagModes, [editorTarget]: false })}><Type size={17} /></button>
      <button type="button" aria-label="标签模式" aria-pressed={tagModes[editorTarget]} title="切换到标签模式" onClick={() => setTagModes({ ...tagModes, [editorTarget]: true })}><Tag size={17} /></button>
    </div>;
  }
  function copyCurrent() {
    const value = config.settings.resolveAliasesOnCopy ? (target === "positive" ? composition.prompt : composition.negative) : (target === "positive" ? prompt : negative);
    void copyPromptText(value).then(() => setNotice("已复制提示词。")).catch(() => setNotice("未能复制，请选择文本复制。"));
  }
  return <section className={"replica-prompt" + (isCollapsed ? " is-collapsed" : "")} data-variant={variant} aria-label="提示词编辑器">
    {variant === "nlw" ? <>
      <div className="replica-prompt-toolbar">
        <div className="replica-prompt-tabs" role="tablist" aria-label="提示词类型">
          {(["positive", "negative"] as const).map((item) => <button type="button" key={item} ref={item === "positive" ? positiveButton : negativeButton} role="tab" aria-selected={target === item}
            className={item + (target === item ? " is-selected" : "")} onClick={() => { setTarget(item); setHoverTarget(null); }} onMouseEnter={() => hover(item)} onMouseLeave={() => hover(null, 180)}
            onFocus={() => hover(item, 0)} onBlur={() => hover(null, 180)}>{item === "positive" ? <Sparkles size={16} /> : <Ban size={16} />} {item === "positive" ? "正面" : "负面"} <span>{splitPromptTags(item === "positive" ? prompt : negative).length}</span></button>)}
        </div>
        <button type="button" className="replica-fixed-button" aria-label="管理固定词" title="管理固定词" onClick={() => setFixedOpen(true)}><Pin size={16} /></button>
        {presetButton("quality")}{presetButton("uc")}
      </div>
      {editor(target)}
      <div className="replica-prompt-resize-mark" aria-hidden="true" />
      <footer className="replica-prompt-footer">
        <button type="button" className="replica-transparent-toggle" aria-pressed={config.transparent} onClick={() => saveConfig({ ...config, transparent: !config.transparent })}>透明背景</button>
        {modeToggle(target)}
        <button type="button" aria-label="随机提示词" title="随机提示词" disabled={randomizing} onClick={() => void randomize(target)}><Dice5 size={17} /></button>
        <button type="button" aria-label="清空当前提示词" title="清空" onClick={() => (target === "positive" ? onPromptChange : onNegativeChange)("")}><X size={17} /></button>
        <button type="button" ref={settingsButton} aria-label="提示词设置" title="提示词设置" aria-expanded={menu === "settings"} onClick={() => toggleMenu("settings")}><Settings2 size={18} /></button>
        <button type="button" className="replica-prompt-tag-count" title="复制提示词" onClick={copyCurrent}>{splitPromptTags(target === "positive" ? composition.prompt : composition.negative).length} 标签</button>
      </footer>
    </> : <div className="replica-nai-prompt-cards">
      <div className={"replica-nai-prompt-card " + target}>
        <header>
          <div className="replica-nai-prompt-tabs" role="tablist" aria-label="提示词类型">
            {(["positive", "negative"] as const).map((item) => <button type="button" key={item} ref={item === "positive" ? positiveButton : negativeButton} role="tab" aria-selected={target === item}
              className={item + (target === item ? " is-selected" : "")} onClick={() => { setTarget(item); setMenu(null); setPresetHover(null); setHoverTarget(null); }}>{item === "positive" ? "提示词" : "UC"}</button>)}
          </div>
          <div className="replica-nai-prompt-actions"><button type="button" aria-label={"清空" + (target === "positive" ? "提示词" : "负面内容")} onClick={() => (target === "positive" ? onPromptChange : onNegativeChange)("")}><X size={16} /></button><button type="button" aria-label="随机提示词" disabled={randomizing} onClick={() => void randomize(target)}><Dice5 size={16} /></button>{canCollapse && <button type="button" className="replica-prompt-collapse" aria-label={isCollapsed ? "展开提示词" : "收起提示词"} aria-expanded={!isCollapsed} onClick={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            setMenu(null); setPresetHover(null); setHoverTarget(null);
            onCollapsedChange?.(!isCollapsed);
          }}><ChevronDown size={16} /></button>}</div>
        </header>
        {!isCollapsed && <>{editor(target)}
        <footer>{target === "positive" ? <button type="button" className="replica-transparent-toggle" aria-pressed={config.transparent} onClick={() => saveConfig({ ...config, transparent: !config.transparent })}>{config.transparent ? <Check size={11} /> : <X size={11} />} 透明背景</button> : modeToggle(target)}{presetButton(target === "positive" ? "quality" : "uc", true)}</footer></>}
      </div>
    </div>}
    {notice && <p role="status" className="replica-prompt-notice">{notice}<button type="button" aria-label="关闭提示词提示" onClick={() => setNotice("")}><X size={12} /></button></p>}
    {variant === "nlw" && hoverTarget && !menu && <FloatingPanel variant={variant} anchor={hoverTarget === "positive" ? positiveButton : negativeButton} label="最终提示词详情" width={480} onClose={() => setHoverTarget(null)} onMouseEnter={() => hover(hoverTarget, 0)} onMouseLeave={() => hover(null, 180)}>
      <PromptComposition key={hoverTarget} target={hoverTarget} text={hoverTarget === "positive" ? composition.prompt : composition.negative} parts={hoverTarget === "positive" ? composition.positiveParts : composition.negativeParts} />
    </FloatingPanel>}
    {!isCollapsed && presetHover && !menu && <FloatingPanel variant={variant} anchor={presetHover === "quality" ? qualityButton : ucButton} label="质量词详情" width={340} onClose={() => setPresetHover(null)}>
      <div className="replica-preset-preview"><b>{presetHover === "quality" ? "质量词（正面）" : "质量词（负面）"}</b><p>{(presetHover === "quality" ? qualityPrompt(model, config.quality, config.qualityCustom) : ucPrompt(model, config.uc, config.ucCustom)) || "未启用质量词"}</p></div>
    </FloatingPanel>}
    {!isCollapsed && menu && <FloatingPanel variant={variant} anchor={menu === "quality" ? qualityButton : menu === "uc" ? ucButton : settingsButton} label={menu === "settings" ? "提示词设置菜单" : "质量词预设菜单"} width={menu === "settings" ? 350 : 240} onClose={() => setMenu(null)}>
      {menu === "quality" ? <>{(["standard", ...(supportsLightQuality(model) ? ["light"] : []), "none", "custom"] as QualityPreset[]).map((preset) => <button type="button" className="replica-menu-row" key={preset} onClick={() => { if (preset === "custom") openCustom("quality"); else { saveConfig({ ...config, quality: preset }); setMenu(null); } }}>{config.quality === preset ? <Check size={16} /> : <span className="replica-check-placeholder" />}{qualityLabels[preset]}</button>)}</>
        : menu === "uc" ? <>{(["heavy", "light", "human", "furry", "none", "custom"] as UcPreset[]).map((preset) => <button type="button" className="replica-menu-row" key={preset} onClick={() => { if (preset === "custom") openCustom("uc"); else { saveConfig({ ...config, uc: preset }); setMenu(null); } }}>{config.uc === preset ? <Check size={16} /> : <span className="replica-check-placeholder" />}{ucLabels[preset]}</button>)}</>
        : <>{settingItems.map(([key, label, description]) => <label key={key} className="replica-setting-row"><input type="checkbox" checked={config.settings[key]} onChange={(event) => saveConfig({ ...config, settings: { ...config.settings, [key]: event.target.checked } })} /><span><b>{label}</b><small>{description}</small></span></label>)}
          <button type="button" className="replica-setting-row" onClick={() => { setMenu(null); setRegexOpen(true); }}><Settings2 size={18} /><span><b>正则替换规则…</b><small>已配置 {config.regexRules.length} 条规则</small></span><ChevronDown size={15} /></button>
          <label className="replica-setting-row is-unavailable" title="当前标签服务未提供共现数据"><input type="checkbox" checked={false} disabled /><span><b>共现标签推荐</b><small>暂无可用的共现数据源</small></span></label></>}
    </FloatingPanel>}
    {fixedOpen && <ReplicaFixedTagsDialog variant={variant} config={config} onChange={saveConfig} onClose={() => setFixedOpen(false)} />}
    {customPreset && <ReplicaPromptModal variant={variant} title={customPreset === "quality" ? "自定义质量词" : "自定义负面质量词"} onClose={() => setCustomPreset(null)}
      footer={<><button type="button" onClick={() => setCustomPreset(null)}>取消</button><button type="button" className="replica-primary" onClick={() => { saveConfig(customPreset === "quality" ? { ...config, quality: "custom", qualityCustom: customDraft } : { ...config, uc: "custom", ucCustom: customDraft }); setCustomPreset(null); }}>保存</button></>}>
      <textarea className="replica-custom-preset-input" aria-label="自定义质量词内容" value={customDraft} onChange={(event) => setCustomDraft(event.target.value)} placeholder="输入质量标签，以逗号分隔" />
      {config.library.length > 0 && <div className="replica-preset-library"><b>从词库添加</b>{config.library.map((entry) => <button type="button" key={entry.id} onClick={() => setCustomDraft([customDraft.trim(), entry.content].filter(Boolean).join(", "))}>{entry.name || entry.content}</button>)}</div>}
    </ReplicaPromptModal>}
    {regexOpen && <ReplicaPromptModal variant={variant} title="正则替换规则" onClose={() => setRegexOpen(false)} className="replica-regex-dialog" footer={<button type="button" className="replica-primary" onClick={() => setRegexOpen(false)}>完成</button>}>
      <p>规则按顺序在编辑器失焦时应用；支持 JavaScript 正则表达式，替换内容可使用 $1 等捕获组。</p>
      {config.regexRules.map((rule) => <div key={rule.id} className="replica-regex-row"><input type="checkbox" aria-label="启用替换规则" checked={rule.enabled} onChange={(event) => saveConfig({ ...config, regexRules: config.regexRules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) })} />
        <input aria-label="正则表达式" placeholder="正则表达式" value={rule.pattern} onChange={(event) => saveConfig({ ...config, regexRules: config.regexRules.map((item) => item.id === rule.id ? { ...item, pattern: event.target.value } : item) })} />
        <input aria-label="替换内容" placeholder="替换内容" value={rule.replacement} onChange={(event) => saveConfig({ ...config, regexRules: config.regexRules.map((item) => item.id === rule.id ? { ...item, replacement: event.target.value } : item) })} />
        <button type="button" aria-label="删除替换规则" onClick={() => saveConfig({ ...config, regexRules: config.regexRules.filter((item) => item.id !== rule.id) })}><X size={16} /></button></div>)}
      <button type="button" className="replica-tonal" onClick={() => saveConfig({ ...config, regexRules: [...config.regexRules, { id: crypto.randomUUID(), pattern: "", replacement: "", enabled: true }] })}><Plus size={16} /> 添加规则</button>
    </ReplicaPromptModal>}
  </section>;
}
