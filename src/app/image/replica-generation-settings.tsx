"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, ChevronDown, ChevronRight, ChevronUp, RotateCcw, RectangleHorizontal, RectangleVertical, Square, Sprout } from "lucide-react";
import { quantizeStepValue, useWheelStep } from "@/app/ui/wheel-number";
import "./replica-generation-settings.css";

type Variant = "nai" | "nlw";
type Choice = { value: string; label: string; group?: string };

export const REPLICA_SAMPLERS: Choice[] = [
  { value: "k_euler_ancestral", label: "欧拉祖先", group: "推荐" },
  { value: "k_euler", label: "欧拉", group: "其他" },
  { value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S 祖先", group: "其他" },
  { value: "k_dpmpp_2m_sde", label: "DPM++ 2M SDE", group: "其他" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M", group: "其他" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE", group: "其他" },
  { value: "ddim_v3", label: "DDIM V3", group: "其他" },
];

const schedules: Choice[] = [
  { value: "native", label: "原生" },
  { value: "karras", label: "Karras" },
  { value: "exponential", label: "指数" },
  { value: "polyexponential", label: "多项式指数" },
];

function boundedNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function NumberEntry({ label, value, onChange, min, max, step, className = "" }: {
  label: string; value: number; onChange: (value: number) => void;
  min: number; max: number; step: number; className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft !== null) onChange(boundedNumber(Number(draft), min, max));
    setDraft(null);
  }
  useWheelStep(inputRef, (direction) => {
    const next = quantizeStepValue(draft === null ? value : Number(draft), direction, min, max, step);
    onChange(next);
    if (draft !== null) setDraft(String(next));
  });
  return <input ref={inputRef} className={`rgs-number ${className}`} aria-label={label} type="number"
    min={min} max={max} step={step} value={draft ?? value}
    onFocus={() => setDraft(String(value))} onChange={(event) => setDraft(event.target.value)}
    onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function ReplicaSelect({ variant, label, value, choices, onChange }: {
  variant: Variant; label: string; value: string; choices: Choice[]; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = choices.find((item) => item.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    function locate() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const flip = below < Math.min(320, choices.length * 40 + 60) && above > below;
      const width = Math.min(Math.max(rect.width, variant === "nai" ? 220 : 240), window.innerWidth - 16);
      setPosition({ position: "fixed", width, left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
        top: flip ? undefined : rect.bottom + 4, bottom: flip ? window.innerHeight - rect.top + 4 : undefined,
        maxHeight: Math.max(0, Math.min(420, flip ? above : below)), visibility: "visible" });
    }
    locate();
    menu.current?.focus();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(locate);
    if (trigger.current) observer?.observe(trigger.current);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", locate); window.removeEventListener("scroll", locate, true); };
  }, [open, choices.length, variant]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector(`#${CSS.escape(id)}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function choose(index: number) {
    const next = choices[index];
    if (next) onChange(next.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function reveal() {
    setActive(Math.max(0, choices.findIndex((item) => item.value === value)));
    setOpen(true);
  }
  return <div className="rgs-select">
    <button ref={trigger} type="button" className="rgs-select-trigger" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? setOpen(false) : reveal()}
      onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); reveal(); } }}>
      <span>{selected?.label ?? value}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={id} className="rgs-menu" data-replica-variant={variant} data-replica-menu="true"
      role="listbox" aria-label={label} aria-activedescendant={`${id}-${active}`} tabIndex={-1} style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
        if (event.key === "Home") { event.preventDefault(); setActive(0); }
        if (event.key === "End") { event.preventDefault(); setActive(choices.length - 1); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
        }
      }}>
      {choices.map((item, index) => <div key={item.value}>
        {item.group && item.group !== choices[index - 1]?.group && <div className="rgs-menu-group" role="presentation">{item.group}</div>}
        <button id={`${id}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={item.value === value}
          className={`rgs-menu-option${active === index ? " is-active" : ""}`}
          onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>{item.label}</button>
      </div>)}
    </div>, document.body)}
  </div>;
}

function SliderField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number;
}) {
  return <div className="rgs-slider-field">
    <span className="rgs-label">{label}</span>
    <div className="rgs-slider-row">
      <NumberEntry label={label} value={value} onChange={onChange} min={min} max={max} step={step} />
      <input className="rgs-range" type="range" aria-label={`${label}滑条`} min={min} max={max} step={step}
        value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  </div>;
}

export type ReplicaGenerationSettingsProps = {
  variant: Variant; model: string; providerControls?: ReactNode; modelControls?: ReactNode;
  steps: number; scale: number; seed: string; sampler: string; schedule: string; cfgRescale: number;
  setSteps: (value: number) => void; setScale: (value: number) => void; setSeed: (value: string) => void;
  setSampler: (value: string) => void; setSchedule: (value: string) => void; setCfgRescale: (value: number) => void;
  count: number; setCount: (value: number) => void; batchMode: "once" | "sequential";
  setBatchMode: (value: "once" | "sequential") => void;
};

export function ReplicaGenerationSettings(props: ReplicaGenerationSettingsProps) {
  const { variant, model, providerControls, modelControls, steps, scale, seed, sampler, schedule, cfgRescale,
    setSteps, setScale, setSeed, setSampler, setSchedule, setCfgRescale, count, setCount, batchMode, setBatchMode } = props;
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const panelId = useId();
  const samplerLabel = REPLICA_SAMPLERS.find((item) => item.value === sampler)?.label ?? sampler;
  const modelLabel = model.replace("nai-diffusion-5-curated", "NAI Diffusion V5 (Curated)")
    .replace("nai-diffusion-5", "NAI Diffusion V5 (Full)")
    .replace("nai-diffusion-4-5-full", "NAI Diffusion V4.5 (Full)");

  function closePanel() {
    setOpen(false);
    requestAnimationFrame(() => toggle.current?.focus({ preventScroll: true }));
  }

  useLayoutEffect(() => {
    if (!open || variant !== "nai") return;
    function locate() {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      if (!rect.width || rect.bottom <= topEdge || rect.top >= bottomEdge) {
        setOpen(false);
        return;
      }
      const width = Math.min(Math.max(280, rect.width), rightEdge - leftEdge);
      const bottom = Math.max(topEdge + 1, Math.min(rect.bottom, bottomEdge));
      setPosition({ position: "fixed", left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)),
        width, bottom: window.innerHeight - bottom, maxHeight: bottom - topEdge, visibility: "visible" });
    }
    locate();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(locate);
    if (root.current) observer?.observe(root.current);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    window.visualViewport?.addEventListener("resize", locate);
    window.visualViewport?.addEventListener("scroll", locate);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
      window.visualViewport?.removeEventListener("resize", locate);
      window.visualViewport?.removeEventListener("scroll", locate);
    };
  }, [open, variant]);

  useEffect(() => {
    if (open && variant === "nai" && position.visibility === "visible") {
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }
  }, [open, variant, position.visibility]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      const target = event.target as Element;
      if (target.closest?.(`[data-replica-menu][data-replica-variant="${variant}"]`)) return;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || (event.target as Element).closest?.("[data-replica-menu]")) return;
      setOpen(false); requestAnimationFrame(() => toggle.current?.focus({ preventScroll: true }));
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, variant]);

  function resetSampling() {
    setSteps(23); setScale(7); setSeed(""); setSampler("k_euler_ancestral"); setSchedule("native"); setCfgRescale(0);
  }

  const settingsPanel = <section ref={panel} id={panelId} className="rgs-panel" role="dialog" aria-label="生成参数设置">
      <div className="rgs-panel-header"><span>{variant === "nai" ? "AI设置" : "生成参数"}</span>
        <div><button type="button" aria-label="重置生成参数" title="重置生成参数" onClick={resetSampling}><RotateCcw size={15} /></button>
          <button type="button" aria-label="收起生成参数" onClick={closePanel}><ChevronDown size={20} /></button></div>
      </div>
      <div className="rgs-panel-content">
        {variant === "nlw" && <div className="rgs-model-controls">{providerControls}{modelControls}</div>}
        {variant === "nlw" && <label className="rgs-field"><span className="rgs-label">采样器</span>
          <ReplicaSelect variant={variant} label="采样器" value={sampler} choices={REPLICA_SAMPLERS} onChange={setSampler} /></label>}
        <SliderField label="步数" value={steps} onChange={setSteps} min={1} max={50} step={1} />
        <SliderField label="提示引导" value={scale} onChange={setScale} min={0} max={10} step={0.1} />
        {variant === "nai" && <div className="rgs-paired-fields">
          <label className="rgs-field"><span className="rgs-label">种子</span><div className="rgs-seed-row">
            <input aria-label="种子" value={seed} onChange={(event) => setSeed(event.target.value)} inputMode="numeric" placeholder="输入种子" />
            <button type="button" aria-label="使用随机种子" title="使用随机种子" onClick={() => setSeed("")}><Sprout size={16} /></button>
          </div></label>
          <label className="rgs-field"><span className="rgs-label">采样器</span>
            <ReplicaSelect variant={variant} label="采样器" value={sampler} choices={REPLICA_SAMPLERS} onChange={setSampler} /></label>
        </div>}
        <button type="button" className="rgs-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
          高级设置<ChevronDown size={14} className={advanced ? "is-open" : ""} /></button>
        {advanced && <div className="rgs-advanced-content">
          <SliderField label="提示引导重标" value={cfgRescale} onChange={setCfgRescale} min={0} max={1} step={0.02} />
          <label className="rgs-field"><span className="rgs-label">噪声调度</span>
            <ReplicaSelect variant={variant} label="噪声调度" value={schedule} choices={schedules} onChange={setSchedule} /></label>
        </div>}
        {variant === "nlw" && <div className="rgs-output-settings">
          <label className="rgs-field"><span className="rgs-label">图像数量</span>
            <NumberEntry label="生成张数" value={count} onChange={setCount} min={1} max={30} step={1} /></label>
          <label className="rgs-field"><span className="rgs-label">提交方式</span>
            <ReplicaSelect variant={variant} label="提交方式" value={batchMode} onChange={(value) => setBatchMode(value as "once" | "sequential")}
              choices={[{ value: "once", label: "一次性" }, { value: "sequential", label: "分批次" }]} /></label>
        </div>}
      </div>
    </section>;

  return <div ref={root} className={`rgs-shell${open ? " is-open" : ""}`} data-replica-variant={variant}>
    {variant === "nai" ? <div className="rgs-summary">
      <label><small>步数</small><NumberEntry label="采样步数" value={steps} onChange={setSteps} min={1} max={50} step={1} /></label>
      <label><small>指导</small><NumberEntry label="提示引导" value={scale} onChange={setScale} min={0} max={10} step={0.1} /></label>
      <span><small>种子</small><b title={seed || "随机种子"}>{seed || <Sprout size={16} aria-label="随机种子" />}</b></span>
      <span className="rgs-summary-sampler"><small>采样器</small><b>{samplerLabel}</b></span>
      <button ref={toggle} type="button" className="rgs-open-button" aria-label="生成参数" aria-expanded={open} aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}><ChevronRight size={20} /></button>
    </div> : <button ref={toggle} type="button" className="rgs-nlw-summary" aria-label="生成参数" aria-expanded={open} aria-haspopup="dialog"
      aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
      <span>参数</span><span className="rgs-model-name" title={modelLabel}>{modelLabel}</span>
      {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
    </button>}

    {open && (variant === "nai"
      ? createPortal(<div className="rgs-shell rgs-popup" data-replica-variant={variant} style={position}>{settingsPanel}</div>, document.body)
      : settingsPanel)}
  </div>;
}

const sizePresets = [
  { value: "small-portrait", label: "小图 - 竖屏 (512×768)", width: 512, height: 768 },
  { value: "small-landscape", label: "小图 - 横屏 (768×512)", width: 768, height: 512 },
  { value: "small-square", label: "小图 - 方形 (640×640)", width: 640, height: 640 },
  { value: "normal-portrait", label: "常规 - 竖屏 (832×1216)", width: 832, height: 1216 },
  { value: "normal-landscape", label: "常规 - 横屏 (1216×832)", width: 1216, height: 832 },
  { value: "normal-square", label: "常规 - 方形 (1024×1024)", width: 1024, height: 1024 },
  { value: "large-portrait", label: "大图 - 竖屏 (1024×1536)", width: 1024, height: 1536 },
  { value: "large-landscape", label: "大图 - 横屏 (1536×1024)", width: 1536, height: 1024 },
  { value: "large-square", label: "大图 - 方形 (1280×1280)", width: 1280, height: 1280 },
];

const nlwSizePresets = [
  ...sizePresets.filter((item) => item.value.startsWith("normal-")),
  ...sizePresets.filter((item) => item.value.startsWith("large-")).map((item) => item.value === "large-square"
    ? { ...item, label: "大图 - 方形 (1472×1472)", width: 1472, height: 1472 } : item),
  ...sizePresets.filter((item) => item.value.startsWith("small-")),
];

export function replicaSizePreset(width: number, height: number, variant: Variant = "nai") {
  return (variant === "nai" ? sizePresets : nlwSizePresets)
    .find((item) => item.width === width && item.height === height)?.value ?? "custom";
}

export type ReplicaImageSizeProps = {
  variant: Variant; width: number; height: number; count: number;
  setWidth: (value: number) => void; setHeight: (value: number) => void; setCount: (value: number) => void;
};

export function ReplicaImageSize({ variant, width, height, count, setWidth, setHeight, setCount }: ReplicaImageSizeProps) {
  const [customCount, setCustomCount] = useState(false);
  const choices = variant === "nai" ? sizePresets : nlwSizePresets;
  const preset = replicaSizePreset(width, height, variant);
  const sizeClass = preset.split("-")[0];
  const orientation = width === height ? "square" : width > height ? "landscape" : "portrait";
  function applySize(value: string) {
    const next = choices.find((item) => item.value === value);
    if (next) { setWidth(next.width); setHeight(next.height); }
  }
  return <section className="rgs-image-size" data-replica-variant={variant}>
    {variant === "nai" ? <>
      <h3>图像设置</h3>
      <div className="rgs-resolution-heading"><b>分辨率</b><div className="rgs-dimensions">
        <NumberEntry label="图片宽度" value={width} onChange={setWidth} min={64} max={1600} step={64} />
        <button type="button" aria-label="交换宽高" title="交换宽高" onClick={() => { setWidth(height); setHeight(width); }}>×</button>
        <NumberEntry label="图片高度" value={height} onChange={setHeight} min={64} max={1600} step={64} />
      </div></div>
      <div className="rgs-size-options">
        <ReplicaSelect variant={variant} label="分辨率预设" value={sizeClass} onChange={(value) => applySize(`${value}-${orientation}`)}
          choices={[{ value: "small", label: "小图" }, { value: "normal", label: "普通" }, { value: "large", label: "大图" }, ...(sizeClass === "custom" ? [{ value: "custom", label: "自定义" }] : [])]} />
        <div className="rgs-segmented rgs-orientations" role="group" aria-label="画面方向">
          {([["landscape", "横图", RectangleHorizontal], ["portrait", "竖图", RectangleVertical], ["square", "方图", Square]] as const)
            .map(([value, label, Icon]) => <button type="button" key={value} aria-label={label} title={label} aria-pressed={orientation === value}
              onClick={() => applySize(`${sizeClass === "custom" ? "normal" : sizeClass}-${value}`)}><Icon size={18} /></button>)}
        </div>
      </div>
      <div className="rgs-count-heading"><b>图片数量</b><button type="button" onClick={() => setCustomCount(!customCount)} aria-expanded={customCount || count > 4}>自定义张数</button></div>
      <div className="rgs-segmented rgs-counts" role="group" aria-label="生成张数快捷选择">
        {[1, 2, 3, 4].map((value) => <button type="button" key={value} aria-label={`生成 ${value} 张图片`} aria-pressed={count === value} onClick={() => setCount(value)}>{value}</button>)}
      </div>
      {(customCount || count > 4) && <label className="rgs-custom-count">生成张数 · 1–30
        <NumberEntry label="生成张数" value={count} onChange={setCount} min={1} max={30} step={1} /></label>}
    </> : <>
      <h3>图像尺寸</h3>
      <ReplicaSelect variant={variant} label="分辨率预设" value={preset} choices={[...choices, { value: "custom", label: `自定义 (${width}×${height})` }]} onChange={applySize} />
      <div className="rgs-nlw-dimensions"><label><small>宽度</small>
        <NumberEntry label="图片宽度" value={width} onChange={setWidth} min={64} max={1600} step={64} /></label>
        <span aria-hidden="true">×</span><label><small>高度</small>
          <NumberEntry label="图片高度" value={height} onChange={setHeight} min={64} max={1600} step={64} /></label>
        <button type="button" aria-label="交换宽高" title="交换宽高" onClick={() => { setWidth(height); setHeight(width); }}><ArrowLeftRight size={20} /></button>
      </div>
    </>}
  </section>;
}
