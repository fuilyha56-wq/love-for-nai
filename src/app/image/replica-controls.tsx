"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftToLine, BookOpen, Bot, Brush, ChevronDown, Copy, FileUp, Folder, ImagePlus, LockKeyhole, Menu, Pencil, Plus, ScanSearch, Sparkles, UnlockKeyhole, UserRound, Users, WandSparkles, X } from "lucide-react";
import { PopupSelect } from "@/app/ui/popup-select";
import { ReplicaImageSize } from "./replica-generation-settings";
import { ReplicaPromptEditor } from "./replica-prompt-editor";
import { listTaggerModels, readTaggerPreferences, runBrowserTagger, subscribeTaggerChanges, writeTaggerPreferences, type TaggerModelInfo, type TaggerPreferences } from "@/lib/browser-tagger";
import { mergeTaggerPrompt, type TaggerPrediction } from "@/lib/tagger-core";
import { resolveImageModelCapabilities, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import "./replica-controls.css";

export type ReplicaCharacter = { id: string; prompt: string; negative?: string; centerX: number; centerY: number };
type Source = { data: string; name: string } | null;
type Props = {
  variant: "nai" | "nlw";
  prompt: string; negative: string; model: string; operation: string;
  assistantModel: string;
  imageProtocol?: ImageProviderProtocol;
  historyPrompts?: string[];
  onPromptChange: (value: string) => void; onNegativeChange: (value: string) => void;
  onEffectiveChange: (value: { prompt: string; negative: string }) => void;
  onAssistant: (value: string) => void;
  width: number; height: number; count: number;
  setWidth: (value: number) => void; setHeight: (value: number) => void; setCount: (value: number) => void;
  seed: string; setSeed: (value: string) => void;
  characters: ReplicaCharacter[]; setCharacters: (value: ReplicaCharacter[]) => void;
  charactersEnabled: boolean; setCharactersEnabled: (value: boolean) => void;
  aiAutoPosition: boolean; setAiAutoPosition: (value: boolean) => void;
  source: Source; reverseSource?: Source; onRemoveReverseSource?: () => void; onUpload: (file: File, operation: string) => void; onRemoveSource: () => void;
  onSelectOperation: (operation: string) => void; onOpenEditor: () => void; onOpenMaskEditor: () => void; onGallery: (operation: string) => void; onReverse: (options?: { localTags?: string[]; signal?: AbortSignal }) => void | Promise<void>;
  reverseBusy?: boolean;
  onMenu: () => void; onCollapse: () => void; modelControls: ReactNode;
  balance: string; strength: number; setStrength: (value: number) => void;
  referenceType: string; setReferenceType: (value: string) => void;
  vibeStrength: number; setVibeStrength: (value: number) => void;
  vibeInformationExtracted: number; setVibeInformationExtracted: (value: number) => void;
};

function Section({ title, icon, actions, children, defaultOpen = false }: { title: string; icon: ReactNode; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className={`replica-section${open ? " is-open" : ""}`}>
    <div className="replica-section-heading">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}><span>{icon}{title}</span><ChevronDown size={18} /></button>
      {actions && <div className="replica-section-shortcuts">{actions}</div>}
    </div>
    <div className="replica-section-motion" aria-hidden={!open} inert={!open}><div className="replica-section-content">{children}</div></div>
  </section>;
}

function SourcePreview({ source, onRemove }: { source: Source; onRemove: () => void }) {
  return source && <div className="replica-source-preview"><Image src={source.data} alt={source.name} width={80} height={80} unoptimized /><span>{source.name}</span><button type="button" onClick={onRemove} aria-label="移除源图片"><X size={17} /></button></div>;
}

export type ReplicaCharactersProps = Pick<Props,
  "variant" | "model" | "imageProtocol" | "characters" | "setCharacters" | "charactersEnabled" |
  "setCharactersEnabled" | "aiAutoPosition" | "setAiAutoPosition"
>;

export function ReplicaCharacters(p: ReplicaCharactersProps) {
  const [characterOpen, setCharacterOpen] = useState(false);
  const updateCharacter = (id: string, patch: Partial<ReplicaCharacter>) => p.setCharacters(p.characters.map(item => item.id === id ? { ...item, ...patch } : item));
  const addCharacter = (tag = "") => {
    p.setCharactersEnabled(true); setCharacterOpen(true);
    if (!p.charactersEnabled && p.characters.length === 1 && !p.characters[0].prompt) p.setCharacters([{ ...p.characters[0], prompt: tag }]);
    else if (p.characters.length < 6) p.setCharacters([...p.characters, { id: `character-${Date.now()}`, prompt: tag, negative: "", centerX: 0.5, centerY: 0.5 }]);
  };
  const capabilities = resolveImageModelCapabilities(p.model, p.imageProtocol);
  const supportsCharacters = capabilities.characters && /v(?:4|5)/i.test(p.model);
  if (!capabilities.characters) return null;
  return <section className={`replica-character-section${characterOpen ? " is-open" : ""}`}>
    <div className="replica-character-heading">
      <button type="button" className="replica-character-title" onClick={() => setCharacterOpen(!characterOpen)} aria-expanded={characterOpen}><Users size={20} /><span>{p.variant === "nai" ? "角色提示" : "角色"}</span></button>
      {p.variant === "nai" ? <><p>为你场景中的角色创建一个单独的提示。</p><button type="button" className="replica-character-add" onClick={() => addCharacter()} disabled={!supportsCharacters} aria-label="添加角色提示词"><Plus size={26} /></button></> : <>
        <div className="replica-character-shortcuts"><button type="button" onClick={() => addCharacter("1girl")} disabled={!supportsCharacters}>♀ 女</button><button type="button" onClick={() => addCharacter("1boy")} disabled={!supportsCharacters}>♂ 男</button><button type="button" onClick={() => addCharacter()} disabled={!supportsCharacters}>⚥ 其他</button><Link href="/settings#prompts"><BookOpen size={14} />词库</Link></div>
        <button type="button" className="replica-character-chevron" onClick={() => setCharacterOpen(!characterOpen)} aria-label="展开角色" aria-expanded={characterOpen}><ChevronDown size={18} /></button>
      </>}
    </div>
    <div className="replica-character-motion" aria-hidden={!characterOpen} inert={!characterOpen}><div className="replica-character-body">
      {!supportsCharacters && <p>当前模型不支持角色提示词。</p>}
      {supportsCharacters && <label className="replica-character-auto"><input type="checkbox" checked={p.aiAutoPosition} onChange={event => p.setAiAutoPosition(event.target.checked)} />AI 自动定位</label>}
      {p.charactersEnabled && p.characters.map((character, index) => <div className="replica-character-card" key={character.id}>
        <div><b>角色 {index + 1}</b><button type="button" onClick={() => { const next = p.characters.filter(item => item.id !== character.id); p.setCharacters(next.length ? next : [{ id: "char-1", prompt: "", centerX: 0.5, centerY: 0.5 }]); if (!next.length) p.setCharactersEnabled(false); }} aria-label={`删除角色 ${index + 1}`}><X size={16} /></button></div>
        <label>提示词<textarea aria-label={`角色 ${index + 1} 提示词`} value={character.prompt} onChange={event => updateCharacter(character.id, { prompt: event.target.value })} /></label>
        <label>负向提示词<textarea aria-label={`角色 ${index + 1} 负向提示词`} value={character.negative || ""} onChange={event => updateCharacter(character.id, { negative: event.target.value })} /></label>
        {!p.aiAutoPosition && <div className="replica-character-position">{([['水平位置', 'centerX'], ['垂直位置', 'centerY']] as const).map(([label, axis]) => <label key={axis}>{label}<output>{character[axis].toFixed(2)}</output><input type="range" aria-label={`角色 ${index + 1} ${label}`} min={0} max={1} step={0.05} value={character[axis]} onChange={event => updateCharacter(character.id, { [axis]: Number(event.target.value) })} /></label>)}</div>}
      </div>)}
      <button type="button" className="replica-add-character" onClick={() => addCharacter()} disabled={!supportsCharacters || (p.charactersEnabled && p.characters.length >= 6)}><Plus size={16} />添加角色</button>
    </div></div>
  </section>;
}

export type ReplicaNaiReferenceProps = Pick<Props,
  "operation" | "source" | "onRemoveSource" | "onSelectOperation" | "onUpload" |
  "onOpenEditor" | "strength" | "setStrength"
> & { hideGroupLabel?: boolean; model?: string; imageProtocol?: ImageProviderProtocol };

export function ReplicaNaiReference(p: ReplicaNaiReferenceProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const capabilities = resolveImageModelCapabilities(p.model || "nai-v4-full", p.imageProtocol);
  if (!capabilities.edit) return null;
  return <>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
      const file = event.target.files?.[0];
      if (file) p.onUpload(file, "img2img");
      event.target.value = "";
    }} />
    {!p.hideGroupLabel && <span className="replica-group-label">参考图片</span>}
    <div className="replica-nai-reference"><button type="button" onClick={() => p.onSelectOperation("img2img")}><ScanSearch size={23} /><span><b>图片与图片</b><small>改变你的形象。</small></span></button><button type="button" onClick={() => fileRef.current?.click()} aria-label="上传源图片"><FileUp size={20} /></button><button type="button" onClick={p.onOpenEditor} aria-label="绘制草图"><Pencil size={20} /></button></div>
    {p.source && <SourcePreview source={p.source} onRemove={p.onRemoveSource} />}
    {capabilities.sampling && p.operation === "img2img" && p.source && <label className="replica-slider-label">变化强度 <output>{p.strength}</output><input type="range" min={0} max={1} step={0.05} aria-label="变化强度" value={p.strength} onChange={event => p.setStrength(Number(event.target.value))} /></label>}
  </>;
}

export function ReplicaReverseTagger(p: Pick<Props, "source" | "prompt" | "model" | "imageProtocol" | "onPromptChange" | "onReverse" | "reverseBusy">) {
  const [models, setModels] = useState<TaggerModelInfo[]>([]);
  const [preferences, setPreferences] = useState<TaggerPreferences>({ modelId: "", onnx: false, llm: true, generalThreshold: 0.35, characterThreshold: 0.85 });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [predictions, setPredictions] = useState<TaggerPrediction[]>([]);
  const [predictionSource, setPredictionSource] = useState("");
  const controller = useRef<AbortController | null>(null);
  const latestPrompt = useRef(p.prompt);
  useEffect(() => { latestPrompt.current = p.prompt; }, [p.prompt]);
  useEffect(() => () => controller.current?.abort(), [p.source?.data, p.model, p.imageProtocol]);
  useEffect(() => {
    let active = true;
    const refresh = () => { setPreferences(readTaggerPreferences()); void listTaggerModels().then(items => { if (active) setModels(items); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取本地模型。"); }); };
    refresh(); const unsubscribe = subscribeTaggerChanges(refresh);
    return () => { active = false; controller.current?.abort(); unsubscribe(); };
  }, []);
  const working = busy || p.reverseBusy;
  const visiblePredictions = predictionSource === p.source?.data ? predictions : [];
  const chosenModel = models.find(model => model.id === preferences.modelId);
  const modelOptions = models.map(model => ({ value: model.id, label: model.name, description: `${model.modelName} · ${model.tagCount.toLocaleString()} 标签` }));
  function update(value: Partial<TaggerPreferences>) { try { setPreferences(writeTaggerPreferences(value)); setError(""); } catch { setError("无法保存反推设置，请检查浏览器的存储权限。"); } }
  function selectModel(modelId: string) { update({ modelId }); }
  function applyTags(tags: readonly string[]) {
    if (!tags.length) return;
    const style = resolveImageModelCapabilities(p.model, p.imageProtocol).promptStyle;
    const currentPrompt = latestPrompt.current;
    p.onPromptChange(style === "tags" ? mergeTaggerPrompt(currentPrompt, tags) : `${currentPrompt.trim()}${currentPrompt.trim() ? "\n\n" : ""}Create an image featuring ${tags.join(", ")}.`);
  }
  async function reverse() {
    if (!p.source || working || (!preferences.onnx && !preferences.llm)) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setStatus(""); setPredictions([]);
    try {
      let localTags: string[] | undefined;
      if (preferences.onnx) {
        const result = await runBrowserTagger({ modelId: preferences.modelId, image: p.source.data, generalThreshold: preferences.generalThreshold, characterThreshold: preferences.characterThreshold, signal: abort.signal, onProgress: setStatus });
        if (abort.signal.aborted) return;
        setPredictions(result); setPredictionSource(p.source.data); localTags = result.map(item => item.name);
        if (!preferences.llm) applyTags(localTags);
      }
      if (preferences.llm) { setStatus("正在通过视觉模型反推…"); await p.onReverse({ localTags, signal: abort.signal }); }
      if (!abort.signal.aborted) setStatus(preferences.llm ? "已完成视觉反推。" : localTags?.length ? `识别出 ${localTags.length} 个标签，已加入提示词。` : "没有标签达到当前阈值，可降低阈值后重试。");
    } catch (reason) { if (reason instanceof Error && reason.name === "AbortError") setStatus("反推已取消。"); else { setStatus(""); setError(reason instanceof Error ? reason.message : "图片反推失败。"); } }
    finally { if (controller.current === abort) controller.current = null; setBusy(false); }
  }
  useEffect(() => {
    if (!models.length || models.some(model => model.id === preferences.modelId)) return;
    void Promise.resolve().then(() => {
      try {
        setPreferences(writeTaggerPreferences({ modelId: models[0].id }));
        setError("");
      } catch {
        setError("无法保存默认模型，请检查浏览器存储权限。");
      }
    });
  }, [models, preferences.modelId]);
  const onnxUnavailable = preferences.onnx && !models.length;
  const onnxNeedsModel = preferences.onnx && !!models.length && !chosenModel;
  return <div className="replica-local-tagger">
    <div className="replica-reverse-methods"><label><input type="checkbox" checked={preferences.onnx} disabled={working} onChange={event => update({ onnx: event.target.checked })} />ONNX tagger</label><label><input type="checkbox" checked={preferences.llm} disabled={working} onChange={event => update({ llm: event.target.checked })} />LLM 反推</label></div>
    {models.length ? <label className="replica-tagger-model">本地 tagger 模型<PopupSelect value={preferences.modelId} disabled={working} ariaLabel="本地 tagger 模型" options={modelOptions} onChange={selectModel} searchable searchPlaceholder="搜索本地模型" /></label> : <div className="replica-tagger-empty" role="status"><p>尚未导入本地 ONNX 标签模型。</p><Link className="replica-primary-upload" href="/settings#local-tagger">去设置导入模型</Link></div>}
    {onnxUnavailable && <p className="replica-tagger-warning" role="alert">已开启 ONNX，但尚未导入模型。请先点击“去设置导入模型”。</p>}
    {onnxNeedsModel && <p className="replica-tagger-warning" role="alert">当前本地模型已失效，请重新选择可用模型。</p>}
    <label className="replica-slider-label">通用标签阈值 <output>{preferences.generalThreshold.toFixed(2)}</output><input type="range" disabled={working || !preferences.onnx || onnxUnavailable} aria-label="通用标签阈值" min={0} max={1} step={0.01} value={preferences.generalThreshold} onChange={event => update({ generalThreshold: Number(event.target.value) })} /></label>
    <label className="replica-slider-label">角色标签阈值 <output>{preferences.characterThreshold.toFixed(2)}</output><input type="range" disabled={working || !preferences.onnx || onnxUnavailable} aria-label="角色标签阈值" min={0} max={1} step={0.01} value={preferences.characterThreshold} onChange={event => update({ characterThreshold: Number(event.target.value) })} /></label>
    <p className="replica-hint">ONNX 在本机识别标签；LLM 根据当前图像模型生成适用的提示词。两项同时启用时，标签作为视觉反推的补充。</p>
    {status && <p className="replica-tagger-status" role="status" aria-live="polite">{status}</p>}{error && <p className="replica-tagger-error" role="alert">{error}</p>}
    {!!visiblePredictions.length && <div className="replica-tagger-result"><div>{visiblePredictions.slice(0, 50).map(item => <span key={`${item.category}-${item.name}`} title={`${(item.score * 100).toFixed(1)}%`}>{item.name}</span>)}</div>{preferences.llm && <button type="button" disabled={working} onClick={() => applyTags(visiblePredictions.map(item => item.name))}>将本地标签加入提示词</button>}</div>}
    <div className="replica-tagger-actions"><button type="button" className="replica-tonal-button" disabled={!p.source || working || (!preferences.onnx && !preferences.llm) || (preferences.onnx && !chosenModel)} onClick={() => void reverse()}><Bot size={18} />{working ? "反推中…" : "开始反推"}</button>{busy && <button type="button" className="replica-tonal-button" onClick={() => { controller.current?.abort(); setStatus("正在取消…"); }}>取消</button>}</div>
  </div>;
}

export function ReplicaControls(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef("img2img");
  const [seedLocked, setSeedLocked] = useState(false);
  const capabilities = resolveImageModelCapabilities(p.model, p.imageProtocol);
  const upload = (operation: string) => { uploadTarget.current = operation; fileRef.current?.click(); };
  const activeSource = (operation: string) => p.operation === operation ? p.source : null;
  const reverseSource = p.reverseSource === undefined ? activeSource("suggest-tags") : p.reverseSource;
  const removeReverseSource = p.onRemoveReverseSource || p.onRemoveSource;
  const prompt = <ReplicaPromptEditor variant={p.variant} prompt={p.prompt} negative={p.negative} model={p.model} imageProtocol={p.imageProtocol} operation={p.operation} assistantModel={p.assistantModel} historyPrompts={p.historyPrompts} onPromptChange={p.onPromptChange} onNegativeChange={p.onNegativeChange} onEffectiveChange={p.onEffectiveChange} onAssistant={p.onAssistant} />;
  const reverseSection = <Section title="反推" icon={<ScanSearch size={20} />}>
    <button type="button" className="replica-primary-upload" disabled={p.reverseBusy} onClick={() => upload("suggest-tags")} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file && !p.reverseBusy) p.onUpload(file, "suggest-tags"); }}><ImagePlus size={19} />增加图片 / 拖入图片</button>
    <SourcePreview source={reverseSource} onRemove={removeReverseSource} />
    <ReplicaReverseTagger source={reverseSource} prompt={p.prompt} model={p.model} imageProtocol={p.imageProtocol} onPromptChange={p.onPromptChange} onReverse={p.onReverse} reverseBusy={p.reverseBusy} />
  </Section>;
  return <div className="replica-controls" data-variant={p.variant}>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) p.onUpload(file, uploadTarget.current); event.target.value = ""; }} />
    <div className="replica-controls-topbar">
      {p.variant === "nai" ? <><Link href="/" aria-label="返回首页"><Image className="replica-nai-mark" src="/nai/novelai.png" width={24} height={24} alt="NovelAI" unoptimized /></Link><div className="replica-wallet"><span>AFF: <b>{p.balance}</b></span><Link href="/account" aria-label="打开钱包"><Plus size={22} /></Link></div><button type="button" onClick={p.onMenu} aria-label="打开站内菜单"><Menu size={22} /></button></> : <><Brush size={18} /><b>画布</b><button type="button" onClick={p.onCollapse} aria-label="收起参数栏"><ArrowLeftToLine size={18} /></button></>}
    </div>
    <div className="replica-controls-scroll">
      {p.variant === "nai" && <div className="replica-model-controls">{p.modelControls}</div>}
      {p.variant === "nlw" && <><ReplicaImageSize variant="nlw" width={p.width} height={p.height} count={p.count} setWidth={p.setWidth} setHeight={p.setHeight} setCount={p.setCount} />{capabilities.seed && <div className="replica-seed"><b>种子</b><div><input aria-label="种子" value={p.seed} inputMode="numeric" placeholder="随机" onChange={event => p.setSeed(event.target.value.replace(/[^0-9]/g, ""))} />{p.seed && <><button type="button" onClick={() => void navigator.clipboard.writeText(p.seed)} aria-label="复制种子"><Copy size={17} /></button><button type="button" onClick={() => p.setSeed("")} aria-label="清空种子"><X size={17} /></button></>}<button type="button" onClick={() => { if (!seedLocked && !p.seed) p.setSeed(String(crypto.getRandomValues(new Uint32Array(1))[0])); setSeedLocked(!seedLocked); }} aria-label={seedLocked ? "解锁种子" : "锁定种子"} aria-pressed={seedLocked}>{seedLocked ? <LockKeyhole size={20} /> : <UnlockKeyhole size={20} />}</button></div></div>}</>}
      {prompt}
      <ReplicaCharacters variant={p.variant} model={p.model} imageProtocol={p.imageProtocol} characters={p.characters} setCharacters={p.setCharacters} charactersEnabled={p.charactersEnabled} setCharactersEnabled={p.setCharactersEnabled} aiAutoPosition={p.aiAutoPosition} setAiAutoPosition={p.setAiAutoPosition} />
      {p.variant === "nai" ? <>
        <ReplicaNaiReference model={p.model} imageProtocol={p.imageProtocol} operation={p.operation} source={p.source} onRemoveSource={p.onRemoveSource} onSelectOperation={p.onSelectOperation} onUpload={p.onUpload} onOpenEditor={p.onOpenEditor} strength={p.strength} setStrength={p.setStrength} />
        <ReplicaImageSize variant="nai" width={p.width} height={p.height} count={p.count} setWidth={p.setWidth} setHeight={p.setHeight} setCount={p.setCount} />
      </> : <>
        {reverseSection}
        {capabilities.edit && <Section title="图生图" icon={<ImagePlus size={20} />}>
          <b>源图像</b><SourcePreview source={activeSource("img2img")} onRemove={p.onRemoveSource} />
          <div className="replica-source-actions"><button type="button" onClick={() => upload("img2img")}><FileUp size={28} />上传图片</button><button type="button" onClick={p.onOpenEditor}><Brush size={28} />绘制草图</button></div>
          <button type="button" className="replica-primary-upload" onClick={() => p.onGallery("img2img")}><ImagePlus size={18} />从精准参考库导入</button>
          {capabilities.sampling && activeSource("img2img") && <label className="replica-slider-label">变化强度 <output>{p.strength}</output><input type="range" min={0} max={1} step={0.05} aria-label="变化强度" value={p.strength} onChange={event => p.setStrength(Number(event.target.value))} /></label>}
        </Section>}
        {capabilities.edit && <Section title="风格迁移" icon={<WandSparkles size={20} />}>
          <p className="replica-hint">改变图像，保留视觉风格</p><SourcePreview source={activeSource("vibe-transfer")} onRemove={p.onRemoveSource} />
          <div className="replica-reference-actions"><button type="button" onClick={() => upload("vibe-transfer")}><ImagePlus size={42} /><b>从文件添加</b><small>PNG、JPG、WebP</small></button><button type="button" onClick={() => p.onGallery("vibe-transfer")}><Folder size={42} /><b>从库导入</b><small>从图片库中选择</small></button></div>
          {capabilities.vibe && activeSource("vibe-transfer") && <><label className="replica-slider-label">参考强度 <output>{p.vibeStrength}</output><input aria-label="参考强度" type="range" min={0} max={1} step={0.05} value={p.vibeStrength} onChange={event => p.setVibeStrength(Number(event.target.value))} /></label><label className="replica-slider-label">信息提取 <output>{p.vibeInformationExtracted}</output><input aria-label="信息提取" type="range" min={0} max={1} step={0.05} value={p.vibeInformationExtracted} onChange={event => p.setVibeInformationExtracted(Number(event.target.value))} /></label></>}
        </Section>}
        {capabilities.edit && <Section title="精准参考" icon={<UserRound size={20} />}>
          <p className="replica-hint">添加参考图并设置类型和参数。</p><SourcePreview source={activeSource("precise-reference")} onRemove={p.onRemoveSource} />
          <button type="button" className="replica-tonal-button" onClick={() => upload("precise-reference")}><Plus size={19} />添加参考图</button>
          <label className="replica-reference-type">参考类型<select value={p.referenceType} onChange={event => p.setReferenceType(event.target.value)}><option value="character&style">角色与风格</option><option value="character">角色</option><option value="style">风格</option></select></label>
          <button type="button" className="replica-library-button" onClick={() => p.onGallery("precise-reference")}><Folder size={18} />从库导入</button>
        </Section>}
      </>}
      {capabilities.operations.includes("inpainting") && p.operation === "inpainting" && <><button type="button" className="replica-tonal-button" onClick={() => upload("inpainting")}><FileUp size={18} />上传重绘源图片</button><SourcePreview source={activeSource("inpainting")} onRemove={p.onRemoveSource} /><button type="button" className="replica-tonal-button" disabled={!p.source} onClick={p.onOpenMaskEditor}><Brush size={18} />绘制蒙版与精确重绘</button></>}
      {p.operation !== "generate" && <button type="button" className="replica-back-generate" onClick={() => p.onSelectOperation("generate")}><Sparkles size={16} />返回文生图</button>}
      {capabilities.edit && <details className="replica-more-tools"><summary>图像工具</summary><div>{[['inpainting', '局部重绘'], ['upscale', '放大'], ['director-lineart', '提取线稿'], ['director-bg-remover', '移除背景']].filter(([value]) => capabilities.operations.includes(value)).map(([value,label]) => <button key={value} type="button" onClick={() => p.onSelectOperation(value)}>{label}</button>)}</div></details>}
    </div>
  </div>;
}
