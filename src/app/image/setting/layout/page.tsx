"use client";

import { useEffect, useState, type PointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Aperture,
  ArrowLeft,
  GripVertical,
  Images,
  LayoutTemplate,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useAppearance } from "@/app/appearance";
import {
  DEFAULT_CUSTOM_LAYOUT,
  loadCustomLayout,
  parseCustomLayout,
  saveCustomLayout,
  type CustomLayoutModule,
  type CustomLayoutPreferences,
} from "@/lib/appearance-store";
import "./layout-editor.css";

type Zone = "controls" | "tools";
type Drag = { id: CustomLayoutModule; zone: Zone; x: number; y: number; pointerId: number };

const MODULES: Record<CustomLayoutModule, { label: string; detail: string; zone: Zone; required?: true }> = {
  model: { label: "模型与模式", detail: "模型、内容类型和操作模式", zone: "controls", required: true },
  prompt: { label: "提示词", detail: "正向、排除内容和角色", zone: "controls", required: true },
  image: { label: "图像设置", detail: "尺寸与比例", zone: "controls" },
  sampling: { label: "采样与批次", detail: "步数、采样器和生成张数", zone: "controls" },
  operations: { label: "操作参数", detail: "源图、蒙版和工具参数", zone: "controls", required: true },
  references: { label: "参考图片", detail: "图生图、图库和导入", zone: "controls" },
  director: { label: "导演工具", detail: "线稿、上色等图像工具", zone: "controls" },
  history: { label: "本次历史", detail: "当前会话生成结果", zone: "tools" },
  agent: { label: "标签助手", detail: "检索、分析与生成标签", zone: "tools" },
};

function orderedModules(layout: CustomLayoutPreferences, zone: Zone) {
  return layout.moduleOrder.filter((id) => MODULES[id].zone === zone);
}

function moveModule(layout: CustomLayoutPreferences, id: CustomLayoutModule, target: CustomLayoutModule | null) {
  if (id === target) return layout;
  const sourceIndex = layout.moduleOrder.indexOf(id);
  const targetIndex = target ? layout.moduleOrder.indexOf(target) : -1;
  const next = layout.moduleOrder.filter((item) => item !== id);
  const index = target ? next.indexOf(target) + (sourceIndex < targetIndex ? 1 : 0) : next.length;
  next.splice(index, 0, id);
  return { ...layout, moduleOrder: next };
}

function ModulePreview({ id }: { id: CustomLayoutModule }) {
  switch (id) {
    case "model":
      return <div className="layout-preview-field"><span>模型</span><b>NAI Diffusion V5</b><span className="layout-preview-chevron">⌄</span></div>;
    case "prompt":
      return <div className="layout-preview-textarea">一位站在花海中的少女，柔和的光线…</div>;
    case "image":
      return <div className="layout-preview-split"><span>832 × 1216</span><span>1024 × 1024</span></div>;
    case "sampling":
      return <div className="layout-preview-meter"><span>采样步数 28</span><i /></div>;
    case "operations":
      return <div className="layout-preview-field"><span>生成方式</span><b>文生图</b><span className="layout-preview-chevron">⌄</span></div>;
    case "references":
      return <div className="layout-preview-split"><span>从图库选择</span><span>导入图片</span></div>;
    case "director":
      return <div className="layout-preview-split"><span>线稿</span><span>上色</span></div>;
    case "history":
      return <div className="layout-preview-empty"><Images size={15} /> 生成后的图片会出现在这里</div>;
    case "agent":
      return <div className="layout-preview-textarea">输入构想，让助手整理标签…</div>;
  }
}

export default function LayoutEditorPage() {
  const router = useRouter();
  const { updatePreferences } = useAppearance();
  const [layout, setLayout] = useState<CustomLayoutPreferences>(DEFAULT_CUSTOM_LAYOUT);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<CustomLayoutModule | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLayout(loadCustomLayout());
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function save(leave: boolean) {
    setLayout(saveCustomLayout(layout));
    updatePreferences({ workspaceLayout: "custom" });
    setMessage("自定义布局已保存到此浏览器。");
    if (leave) router.push("/image");
  }

  function reset() {
    setLayout(parseCustomLayout(DEFAULT_CUSTOM_LAYOUT));
    setMessage("已恢复默认布局。需要点击保存后，工作台才会切换到自定义布局。");
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: CustomLayoutModule) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, zone: MODULES[id].zone, x: event.clientX, y: event.clientY, pointerId: event.pointerId });
    setOver(null);
  }

  function findTarget(x: number, y: number) {
    const element = document.elementFromPoint(x, y);
    const zone = element?.closest<HTMLElement>("[data-layout-zone]")?.dataset.layoutZone as Zone | undefined;
    const id = element?.closest<HTMLElement>("[data-layout-module]")?.dataset.layoutModule as CustomLayoutModule | undefined;
    return { zone, id };
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setDrag({ ...drag, x: event.clientX, y: event.clientY });
    const target = findTarget(event.clientX, event.clientY);
    setOver(target.zone === drag.zone && target.id !== drag.id ? target.id ?? null : null);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const target = findTarget(event.clientX, event.clientY);
    if (target.zone === drag.zone && target.id !== drag.id) {
      setLayout((current) => moveModule(current, drag.id, target.id ?? null));
      setMessage("布局已调整，点击保存后应用到工作台。");
    }
    setDrag(null);
    setOver(null);
  }

  function nudge(id: CustomLayoutModule, direction: -1 | 1) {
    const zoneOrder = orderedModules(layout, MODULES[id].zone);
    const index = zoneOrder.indexOf(id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= zoneOrder.length) return;
    const next = [...layout.moduleOrder];
    const sourceIndex = next.indexOf(id);
    const targetIndex = next.indexOf(zoneOrder[nextIndex]);
    [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
    setLayout({ ...layout, moduleOrder: next });
    setMessage("布局已调整，点击保存后应用到工作台。");
  }

  function renderZone(zone: Zone) {
    return orderedModules(layout, zone).map((id, index, list) => {
      const item = MODULES[id];
      const visible = layout.visibleModules[id];
      return (
        <section
          key={id}
          data-layout-module={id}
          className={`layout-module${visible ? "" : " is-hidden"}${over === id ? " is-drop-target" : ""}${drag?.id === id ? " is-dragging" : ""}`}
        >
          <div className="layout-module-heading">
            <button
              type="button"
              className="layout-drag-handle"
              aria-label={`拖动${item.label}排序`}
              title={`拖动${item.label}排序`}
              onPointerDown={(event) => beginDrag(event, id)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => { setDrag(null); setOver(null); }}
            ><GripVertical size={17} /></button>
            <div className="layout-module-copy"><b>{item.label}</b><small>{item.detail}</small></div>
            {!item.required && (
              <label className="layout-module-visibility" title={visible ? `隐藏${item.label}` : `显示${item.label}`}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) => setLayout({
                    ...layout,
                    visibleModules: { ...layout.visibleModules, [id]: event.target.checked },
                  })}
                  aria-label={`显示${item.label}`}
                />
                <span />
              </label>
            )}
          </div>
          <ModulePreview id={id} />
          <div className="layout-module-keyboard">
            <button type="button" onClick={() => nudge(id, -1)} disabled={index === 0} aria-label={`上移${item.label}`}>上移</button>
            <button type="button" onClick={() => nudge(id, 1)} disabled={index === list.length - 1} aria-label={`下移${item.label}`}>下移</button>
          </div>
        </section>
      );
    });
  }

  return (
    <main className="layout-editor-page">
      <header className="layout-editor-header">
        <div className="layout-editor-brand"><Aperture size={21} /><b>Love for NAI</b><span>布局编辑器</span></div>
        <div className="layout-editor-header-actions">
          <Link href="/settings"><ArrowLeft size={15} /> 返回外观设置</Link>
          <button type="button" onClick={() => save(true)} disabled={!loaded}><Save size={15} /> 保存并返回工作台</button>
        </div>
      </header>
      <div className="layout-editor-body">
        <div className="layout-editor-intro">
          <div><span className="layout-editor-eyebrow"><LayoutTemplate size={14} /> CUSTOM WORKSPACE</span><h1>自定义工作台布局</h1><p>拖动模块左侧的把手调整位置，按需显示控件；保存后在图像工作台使用。画布和生成按钮始终保留。</p></div>
          <button type="button" onClick={reset} disabled={!loaded}><RotateCcw size={15} /> 恢复默认</button>
        </div>
        {message && <p className="layout-editor-message" role="status">{message}</p>}
        <div className="layout-editor-settings">
          <label>左侧宽度 <output>{layout.leftWidth}px</output><input type="range" min="240" max="520" value={layout.leftWidth} onChange={(event) => setLayout({ ...layout, leftWidth: Number(event.target.value) })} /></label>
          <label>右侧宽度 <output>{layout.rightWidth}px</output><input type="range" min="200" max="460" value={layout.rightWidth} onChange={(event) => setLayout({ ...layout, rightWidth: Number(event.target.value) })} /></label>
          <label className="layout-editor-checkbox"><input type="checkbox" checked={layout.rightCollapsed} onChange={(event) => setLayout({ ...layout, rightCollapsed: event.target.checked })} /> 工作台默认折叠右栏</label>
        </div>
        <div className="layout-editor-preview-scroll">
          <div className="layout-editor-preview" style={{ gridTemplateColumns: `${layout.leftWidth}px minmax(300px, 1fr) ${layout.rightWidth}px` }}>
            <aside className="layout-preview-column" data-layout-zone="controls"><div className="layout-preview-column-title"><SlidersHorizontal size={15} /> 图像设置</div>{renderZone("controls")}<div className="layout-preview-submit"><Sparkles size={15} /> 生成图像</div></aside>
            <section className="layout-preview-canvas" aria-label="画布预览"><div className="layout-preview-canvas-label">画布 · 固定区域</div><div className="layout-preview-art"><WandSparkles size={34} /><b>画布等待你的想象</b><span>创作结果会显示在这里</span></div></section>
            <aside className="layout-preview-column" data-layout-zone="tools"><div className="layout-preview-column-title"><WandSparkles size={15} /> 功能区</div>{renderZone("tools")}<div className="layout-preview-fixed">创作中心 · 会话状态</div></aside>
          </div>
        </div>
        <div className="layout-editor-bottom"><span>拖动控件改变顺序，保存后立即应用于本浏览器。</span><div><Link href="/settings">取消</Link><button type="button" onClick={() => save(false)} disabled={!loaded}><Save size={15} /> 保存布局</button></div></div>
      </div>
      {drag && <div className="layout-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>{MODULES[drag.id].label}</div>}
    </main>
  );
}
