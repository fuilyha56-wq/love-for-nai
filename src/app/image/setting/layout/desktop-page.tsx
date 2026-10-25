"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Aperture, ArrowLeft, GripVertical, Images, LayoutTemplate, RotateCcw, Save, SlidersHorizontal, Sparkles, WandSparkles } from "lucide-react";
import { useAppearance } from "@/app/appearance";
import { DEFAULT_CUSTOM_LAYOUT, loadCustomLayout, parseCustomLayout, saveCustomLayout, type CustomLayoutModule, type CustomLayoutPreferences } from "@/lib/appearance-store";
import { CUSTOM_LAYOUT_EDITOR_MODULES as MODULES, findDragInsertion, nudgeModule, orderForZone, reorderModule, type LayoutEditorZone, type LayoutDragInsertion } from "@/lib/layout-editor";
import "./layout-editor.css";

type Drag = { id: CustomLayoutModule; zone: LayoutEditorZone; startX: number; startY: number; x: number; y: number; pointerId: number; active: boolean };

function DragPreview({ drag }: { drag: Drag }) {
  const preview = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    function positionPreview() {
      const element = preview.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 12;
      const top = (viewport?.offsetTop ?? 0) + 12;
      const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 12;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 12;
      const { width, height } = element.getBoundingClientRect();
      const x = drag.x + 12 + width > right ? drag.x - width - 12 : drag.x + 12;
      const y = drag.y + 12 + height > bottom ? drag.y - height - 12 : drag.y + 12;
      element.style.left = `${Math.max(left, Math.min(x, right - width))}px`;
      element.style.top = `${Math.max(top, Math.min(y, bottom - height))}px`;
    }
    positionPreview();
    window.addEventListener("resize", positionPreview);
    window.visualViewport?.addEventListener("resize", positionPreview);
    window.visualViewport?.addEventListener("scroll", positionPreview);
    return () => {
      window.removeEventListener("resize", positionPreview);
      window.visualViewport?.removeEventListener("resize", positionPreview);
      window.visualViewport?.removeEventListener("scroll", positionPreview);
    };
  }, [drag.x, drag.y]);

  // The page-enter animation retains a transform on main, so a fixed child
  // would use main's scrolling coordinates instead of the pointer's viewport.
  return createPortal(<div ref={preview} className="layout-drag-ghost" aria-hidden="true"><GripVertical size={16} />{MODULES[drag.id].label}</div>, document.body);
}

function ModulePreview({ id }: { id: CustomLayoutModule }) {
  switch (id) {
    case "model": return <div className="layout-preview-field"><span>模型</span><b>NAI Diffusion V5</b><span className="layout-preview-chevron">⌄</span></div>;
    case "prompt": return <div className="layout-preview-textarea">一位站在花海中的少女，柔和的光线…</div>;
    case "image": return <div className="layout-preview-split"><span>832 × 1216</span><span>1024 × 1024</span></div>;
    case "sampling": return <div className="layout-preview-meter"><span>采样步数 28</span><i /></div>;
    case "operations": return <div className="layout-preview-field"><span>生成方式</span><b>文生图</b><span className="layout-preview-chevron">⌄</span></div>;
    case "references": return <div className="layout-preview-split"><span>从图库选择</span><span>导入图片</span></div>;
    case "director": return <div className="layout-preview-split"><span>线稿</span><span>上色</span></div>;
    case "history": return <div className="layout-preview-empty"><Images size={15} /> 生成后的图片会出现在这里</div>;
    case "agent": return <div className="layout-preview-textarea">输入构想，让助手整理标签…</div>;
  }
}

export default function LayoutEditorPage() {
  const router = useRouter();
  const { updatePreferences } = useAppearance();
  const [layout, setLayout] = useState<CustomLayoutPreferences>(DEFAULT_CUSTOM_LAYOUT);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<CustomLayoutModule>("image");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<LayoutDragInsertion | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const dropRef = useRef<LayoutDragInsertion | null>(null);
  const frameRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setLayout(loadCustomLayout()); setLoaded(true); }, 0);
    return () => {
      window.clearTimeout(timer);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  function update(next: (current: CustomLayoutPreferences) => CustomLayoutPreferences) {
    setLayout(next);
    setMessage("布局已调整，点击保存后应用到工作台。");
  }

  function save(leave: boolean) {
    setLayout(saveCustomLayout(layout));
    updatePreferences({ workspaceLayout: "custom" });
    setMessage("自定义布局已保存到此浏览器。");
    if (leave) router.push("/image");
  }

  function reset() {
    setLayout(parseCustomLayout(DEFAULT_CUSTOM_LAYOUT));
    setMessage("已恢复默认布局，点击保存后应用到工作台。");
  }

  function selectCard(id: CustomLayoutModule) {
    setSelected(id);
    if (window.innerWidth < 1000) {
      document.getElementById("layout-card-properties")?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
  }

  function cancelDrag() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    dragRef.current = null;
    dropRef.current = null;
    setDrag(null);
    setDrop(null);
  }

  function locateInsertion(current: Drag) {
    const element = document.elementFromPoint(current.x, current.y);
    const column = element?.closest<HTMLElement>("[data-layout-zone]");
    let insertion: LayoutDragInsertion | null = null;
    if (column?.dataset.layoutZone === current.zone) {
      const rects = [...column.querySelectorAll<HTMLElement>("[data-layout-module]")].map((card) => {
        const rect = card.getBoundingClientRect();
        return { id: card.dataset.layoutModule as CustomLayoutModule, top: rect.top, bottom: rect.bottom };
      });
      insertion = findDragInsertion(rects, current.id, current.y);
    }
    dropRef.current = insertion;
    setDrop((previous) => previous?.id === insertion?.id && previous?.edge === insertion?.edge ? previous : insertion);
  }

  function autoScroll() {
    const current = dragRef.current;
    if (!current?.active) { frameRef.current = null; return; }
    const viewport = previewRef.current;
    const bounds = viewport?.getBoundingClientRect();
    if (viewport && bounds && current.x >= bounds.left - 24 && current.x <= bounds.right + 24) {
      const vertical = current.y < 90 ? -Math.min(18, (90 - current.y) / 4) : current.y > window.innerHeight - 72 ? Math.min(18, (current.y - window.innerHeight + 72) / 4) : 0;
      if (vertical) window.scrollBy(0, vertical);
      if (viewport.scrollWidth > viewport.clientWidth && current.y >= bounds.top && current.y <= bounds.bottom) {
        const horizontal = current.x < bounds.left + 36 ? -10 : current.x > bounds.right - 36 ? 10 : 0;
        if (horizontal) viewport.scrollLeft += horizontal;
      }
    }
    locateInsertion(current);
    frameRef.current = window.requestAnimationFrame(autoScroll);
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: CustomLayoutModule) {
    if (event.button !== 0 || !loaded) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(id);
    dragRef.current = { id, zone: MODULES[id].zone, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const previous = dragRef.current;
    if (!previous || event.pointerId !== previous.pointerId) return;
    const active = previous.active || Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) >= 6;
    const current = { ...previous, x: event.clientX, y: event.clientY, active };
    dragRef.current = current;
    if (!active) return;
    setDrag(current);
    locateInsertion(current);
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(autoScroll);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.active) {
      locateInsertion({ ...current, x: event.clientX, y: event.clientY });
      const insertion = dropRef.current;
      if (insertion) update((value) => reorderModule(value, current.id, insertion.id, insertion.edge));
    }
    cancelDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function nudge(id: CustomLayoutModule, direction: -1 | 1) {
    setSelected(id);
    update((current) => nudgeModule(current, id, direction));
  }

  function renderZone(zone: LayoutEditorZone) {
    return orderForZone(layout, zone).map((id, index, list) => {
      const item = MODULES[id];
      const visible = layout.visibleModules[id];
      return <section
        key={id}
        data-layout-module={id}
        role="group"
        aria-label={`选择${item.label}卡片`}
        aria-describedby="layout-card-properties"
        tabIndex={0}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, input, label")) return;
          selectCard(id);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectCard(id); }
        }}
        style={{ width: `${layout.moduleWidths?.[id] ?? 100}%`, minHeight: layout.modulePositions[id].height * 52 }}
        className={`layout-module${visible ? "" : " is-hidden"}${selected === id ? " is-selected" : ""}${drop?.id === id ? ` is-drop-${drop.edge}` : ""}${drag?.id === id ? " is-dragging" : ""}`}
      >
        <div className="layout-module-heading">
          <button type="button" className="layout-drag-handle" aria-label={`拖动${item.label}排序`} title="拖动排序，也可按上下方向键"
            onPointerDown={(event) => beginDrag(event, id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); cancelDrag(); }
              if (!dragRef.current && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); nudge(id, event.key === "ArrowUp" ? -1 : 1); }
            }}><GripVertical size={17} /></button>
          <div className="layout-module-copy"><b>{item.label}</b><small>{item.detail}</small></div>
          <label className="layout-module-visibility" title={visible ? `隐藏${item.label}` : `显示${item.label}`}>
            <input type="checkbox" checked={visible} onChange={(event) => { const checked = event.target.checked; setSelected(id); update((current) => ({ ...current, visibleModules: { ...current.visibleModules, [id]: checked } })); }} aria-label={`显示${item.label}`} /><span />
          </label>
        </div>
        <ModulePreview id={id} />
        <div className="layout-module-keyboard"><span>{selected === id ? "已选中" : "点击卡片设置"}</span><button type="button" onClick={() => nudge(id, -1)} disabled={index === 0} aria-label={`上移${item.label}`}>上移</button><button type="button" onClick={() => nudge(id, 1)} disabled={index === list.length - 1} aria-label={`下移${item.label}`}>下移</button></div>
      </section>;
    });
  }

  const selectedItem = MODULES[selected];
  const selectedOrder = orderForZone(layout, selectedItem.zone);
  const selectedIndex = selectedOrder.indexOf(selected);
  const selectedWidth = layout.moduleWidths?.[selected] ?? 100;
  const selectedHeight = layout.modulePositions[selected].height;

  return <main className="layout-editor-page">
    <header className="layout-editor-header"><div className="layout-editor-brand"><Aperture size={21} /><b>Love for NAI</b><span>布局编辑器</span></div><div className="layout-editor-header-actions"><Link href="/settings"><ArrowLeft size={15} /> 返回外观设置</Link><button type="button" onClick={() => save(true)} disabled={!loaded}><Save size={15} /> 保存并返回工作台</button></div></header>
    <div className="layout-editor-body">
      <div className="layout-editor-intro"><div><span className="layout-editor-eyebrow"><LayoutTemplate size={14} /> CUSTOM WORKSPACE</span><h1>自定义工作台布局</h1><p>点击卡片调整属性，拖动把手在同一侧栏内排序。保存后应用到工作台，画布与生成按钮保持固定。</p></div><button type="button" onClick={reset} disabled={!loaded}><RotateCcw size={15} /> 恢复默认</button></div>
      {message && <p className="layout-editor-message" role="status">{message}</p>}
      <div className="layout-editor-settings">
        <label>左侧宽度 <output>{layout.leftWidth}px</output><input aria-label="左侧宽度" type="range" min="240" max="520" value={layout.leftWidth} onChange={(event) => { const value = Number(event.target.value); update((current) => ({ ...current, leftWidth: value })); }} /></label>
        <label>右侧宽度 <output>{layout.rightWidth}px</output><input aria-label="右侧宽度" type="range" min="200" max="460" value={layout.rightWidth} onChange={(event) => { const value = Number(event.target.value); update((current) => ({ ...current, rightWidth: value })); }} /></label>
        <label className="layout-editor-checkbox"><input type="checkbox" checked={layout.rightCollapsed} onChange={(event) => { const value = event.target.checked; update((current) => ({ ...current, rightCollapsed: value })); }} /> 工作台默认折叠右栏</label>
      </div>
      <div className="layout-editor-workspace">
        <div ref={previewRef} className="layout-editor-preview-scroll">
          <div className="layout-editor-preview" style={{ gridTemplateColumns: `${layout.leftWidth}px minmax(160px, 1fr) ${layout.rightWidth}px` }}>
            <aside className="layout-preview-column" data-layout-zone="controls"><div className="layout-preview-column-title"><SlidersHorizontal size={15} /> 图像设置</div>{renderZone("controls")}<div className="layout-preview-submit"><Sparkles size={15} /> 生成图像</div></aside>
            <section className="layout-preview-canvas" aria-label="画布预览"><div className="layout-preview-canvas-label">画布 · 固定区域</div><div className="layout-preview-art"><WandSparkles size={34} /><b>画布等待你的想象</b><span>创作结果会显示在这里</span></div></section>
            <aside className="layout-preview-column" data-layout-zone="tools"><div className="layout-preview-column-title"><WandSparkles size={15} /> 功能区</div>{renderZone("tools")}<div className="layout-preview-fixed">创作中心 · 会话状态</div></aside>
          </div>
        </div>
        <aside className="layout-editor-inspector" aria-label="卡片属性" id="layout-card-properties">
          <div className="layout-inspector-heading"><SlidersHorizontal size={16} /><div><b>{selectedItem.label}</b><small>卡片属性 · {selectedItem.zone === "controls" ? "左侧栏" : "右侧栏"}</small></div></div>
          <label className="layout-inspector-toggle"><span>在工作台显示</span><input type="checkbox" aria-label="选中卡片在工作台显示" checked={layout.visibleModules[selected]} onChange={(event) => { const value = event.target.checked; update((current) => ({ ...current, visibleModules: { ...current.visibleModules, [selected]: value } })); }} /></label>
          <div className="layout-inspector-size">
            <label className="layout-inspector-field"><span>卡片宽度 <output>{selectedWidth}%</output></span><input type="range" aria-label="选中卡片宽度" min="50" max="100" step="5" value={selectedWidth} onChange={(event) => { const value = Number(event.target.value); update((current) => ({ ...current, moduleWidths: { ...current.moduleWidths, [selected]: value } })); }} /></label>
            <label className="layout-inspector-field"><span>最小高度 <output>{selectedHeight * 52}px</output></span><input type="range" aria-label="选中卡片最小高度" min="1" max="4" value={selectedHeight} onChange={(event) => { const value = Number(event.target.value); update((current) => ({ ...current, modulePositions: { ...current.modulePositions, [selected]: { ...current.modulePositions[selected], height: value } } })); }} /></label>
          </div>
          <p className="layout-inspector-hint">宽度相对于所在侧栏。内容较多时，卡片会自动增高。</p>
          <div className="layout-inspector-actions"><span>侧栏顺序 {selectedIndex + 1} / {selectedOrder.length}</span><div><button type="button" aria-label="上移选中卡片" disabled={selectedIndex === 0} onClick={() => nudge(selected, -1)}>上移</button><button type="button" aria-label="下移选中卡片" disabled={selectedIndex === selectedOrder.length - 1} onClick={() => nudge(selected, 1)}>下移</button><button type="button" onClick={() => update((current) => ({ ...current, moduleWidths: { ...current.moduleWidths, [selected]: 100 }, modulePositions: { ...current.modulePositions, [selected]: { ...current.modulePositions[selected], height: 2 } } }))}>重置大小</button></div></div>
        </aside>
      </div>
      <p className="layout-editor-drag-hint" role="status" aria-live="polite">{drag ? drop ? `松开，将${MODULES[drag.id].label}放到${MODULES[drop.id].label}${drop.edge === "before" ? "之前" : "之后"}` : "拖到同一侧栏的卡片之间，按 Esc 取消" : "选中卡片后可调整显隐和大小；拖动把手排序，也可按上下方向键。"}</p>
      <div className="layout-editor-bottom"><span>修改只在保存后应用。</span><div><Link href="/settings">取消</Link><button type="button" onClick={() => save(false)} disabled={!loaded}><Save size={15} /> 保存布局</button></div></div>
    </div>
    {drag && <DragPreview drag={drag} />}
  </main>;
}
