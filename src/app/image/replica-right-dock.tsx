"use client";

import { Bot, ChevronLeft, ChevronRight, Columns2, Ellipsis, History, Info, Rows2, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createReplicaDockState, normalizeReplicaDockState, reduceReplicaDock, resolveAvailableReplicaDockState, resolveDockColumns, resolveDockSplit, resolveReplicaDockLayout, REPLICA_DOCK_SPLITTER, type ReplicaDockAction, type ReplicaDockAvailability, type ReplicaDockExpansionRequest, type ReplicaDockMode, type ReplicaDockPane, type ReplicaDockState } from "@/lib/replica-dock";
import "./replica-right-dock.css";

export { resolveDockSplit, REPLICA_DOCK_SPLITTER, REPLICA_HISTORY_MIN_HEIGHT, REPLICA_ASSISTANT_MIN_HEIGHT } from "@/lib/replica-dock";

export type ReplicaRightDockProps = {
  history: ReactNode;
  assistant: ReactNode;
  historyEnabled?: boolean;
  assistantEnabled?: boolean;
  initialHistoryOpen?: boolean;
  assistantOpenRequest?: number;
  /** Increment a positive revision to apply a desktop expansion preference once. */
  expansionRequest?: ReplicaDockExpansionRequest;
  storageKey?: string | null;
  onCollapsedChange?: (allCollapsed: boolean) => void;
};

type DockStore = {
  snapshot: ReplicaDockState;
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => ReplicaDockState;
  update: (action: ReplicaDockAction, persist?: boolean, availability?: ReplicaDockAvailability) => void;
  persist: () => void;
};
const deviceStores = new Map<string, DockStore>();

function createDockStore(initial: ReplicaDockState, storageKey: string | null): DockStore {
  let saved = initial;
  if (storageKey) {
    try { saved = normalizeReplicaDockState(JSON.parse(window.localStorage.getItem(storageKey) ?? "null"), initial); } catch { /* A blocked or invalid device preference keeps the defaults. */ }
  }
  const callbacks = new Set<() => void>();
  const emit = () => callbacks.forEach((callback) => callback());
  const store: DockStore = {
    snapshot: saved,
    getSnapshot: () => store.snapshot,
    persist: () => {
      if (storageKey) try { window.localStorage.setItem(storageKey, JSON.stringify(store.snapshot)); } catch { /* Private browsing still supports the current session. */ }
    },
    update: (action, persist = true, availability) => {
      store.snapshot = reduceReplicaDock(store.snapshot, action, availability);
      if (persist) store.persist();
      emit();
    },
    subscribe: (callback) => {
      callbacks.add(callback);
      const receive = (event: StorageEvent) => {
        if (!storageKey || (event.key !== storageKey && event.key !== null)) return;
        try { store.snapshot = normalizeReplicaDockState(JSON.parse(event.newValue ?? "null"), initial); emit(); } catch { /* Ignore malformed changes from another tab. */ }
      };
      window.addEventListener("storage", receive);
      return () => { callbacks.delete(callback); window.removeEventListener("storage", receive); };
    },
  };
  return store;
}

function paneLabel(pane: ReplicaDockPane) { return pane === "history" ? "历史记录" : "聊天"; }

export function ReplicaRightDock({ history, assistant, historyEnabled = true, assistantEnabled = true, initialHistoryOpen = false, assistantOpenRequest = 0, expansionRequest, storageKey = "lfn-replica-right-dock", onCollapsedChange }: ReplicaRightDockProps): ReactElement {
  const [initial] = useState(() => createReplicaDockState(initialHistoryOpen, assistantOpenRequest > 0));
  const store = useMemo(() => {
    if (typeof window === "undefined" || !storageKey) return createDockStore(initial, null);
    const existing = deviceStores.get(storageKey);
    if (existing) return existing;
    const created = createDockStore(initial, storageKey);
    deviceStores.set(storageKey, created);
    return created;
  }, [initial, storageKey]);
  const savedState = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initial);
  const availability = { historyEnabled, assistantEnabled };
  const state = resolveAvailableReplicaDockState(savedState, availability);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const panelsRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const drag = useRef<{ pointerId: number; start: number; extent: number } | null>(null);
  const floatingDrag = useRef<{ pointerId: number; x: number; y: number; rect: NonNullable<ReplicaDockState["floatingRect"]>; resize: boolean } | null>(null);
  const handledAssistantRequest = useRef<{ store: DockStore | null; request: number }>({ store: null, request: -1 });
  const handledExpansionRequest = useRef<{ store: DockStore | null; revision: number }>({ store: null, revision: 0 });
  const id = useId();
  const expansionRevision = expansionRequest?.revision ?? 0;
  const requestedExpanded = expansionRequest?.expanded ?? false;
  const layout = resolveReplicaDockLayout(savedState, dimensions.width, availability);
  const selectedLayout = resolveReplicaDockLayout({ ...savedState, expanded: true }, dimensions.width, availability);
  const bothEnabled = historyEnabled && assistantEnabled;
  const anyEnabled = historyEnabled || assistantEnabled;
  const modeOptions = bothEnabled ? ([ ["exclusive", "独占切换", <History key="history" size={16} />], ["stacked", "上下分栏", <Rows2 key="rows" size={16} />], ["side-by-side", "左右分栏", <Columns2 key="columns" size={16} />] ] as const) : [];
  const bothOpen = layout.historyOpen && layout.assistantOpen && !state.floating;
  const allCollapsed = !state.expanded;
  const split = resolveDockSplit((dimensions.height - REPLICA_DOCK_SPLITTER) * state.historyFraction, dimensions.height);
  const columns = resolveDockColumns(state.chatWidth, dimensions.width);
  const usable = Math.max(0, (layout.horizontal ? dimensions.width : dimensions.height) - REPLICA_DOCK_SPLITTER);
  const extent = layout.horizontal ? columns.historyWidth : split.historyHeight;
  const limits = layout.horizontal
    ? { minimum: resolveDockColumns(usable, dimensions.width).historyWidth, maximum: resolveDockColumns(0, dimensions.width).historyWidth }
    : { minimum: resolveDockSplit(0, dimensions.height).historyHeight, maximum: resolveDockSplit(usable, dimensions.height).historyHeight };

  useEffect(() => { onCollapsedChange?.(allCollapsed); }, [allCollapsed, onCollapsedChange]);
  useEffect(() => {
    if (!Number.isFinite(expansionRevision) || expansionRevision <= 0) return;
    if (handledExpansionRequest.current.store === store && expansionRevision <= handledExpansionRequest.current.revision) return;
    handledExpansionRequest.current = { store, revision: expansionRevision };
    store.update({ type: "expansion", expanded: requestedExpanded }, true, { historyEnabled, assistantEnabled });
  }, [expansionRevision, requestedExpanded, assistantEnabled, historyEnabled, store]);
  useEffect(() => {
    if (handledAssistantRequest.current.store === store && handledAssistantRequest.current.request === assistantOpenRequest) return;
    handledAssistantRequest.current = { store, request: assistantOpenRequest };
    if (assistantOpenRequest > 0 && assistantEnabled) store.update({ type: "reveal", pane: "assistant" }, true, { historyEnabled, assistantEnabled });
  }, [assistantOpenRequest, assistantEnabled, historyEnabled, store]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && menuRef.current) menuRef.current.open = false; };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  useEffect(() => {
    if (!layout.assistantOpen) return;
    assistantRef.current?.querySelector<HTMLElement>("textarea, input:not([type=hidden]), [contenteditable=true]")?.focus({ preventScroll: true });
  }, [layout.assistantOpen]);
  useEffect(() => {
    // The browser top layer keeps the same chat subtree while escaping glass
    // backdrop filters and clipped workspace panels, unlike reparenting a portal.
    const pane = assistantRef.current;
    if (!pane || !("showPopover" in pane)) return;
    const sync = () => {
      if (state.floating && state.floatingVisible && window.matchMedia("(min-width:1024px)").matches) {
        if (!pane.matches(":popover-open")) pane.showPopover();
      } else if (pane.matches(":popover-open")) pane.hidePopover();
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [state.floating, state.floatingVisible]);
  useEffect(() => {
    const panels = panelsRef.current;
    if (!panels || allCollapsed) return;
    const measure = () => setDimensions({ width: panels.clientWidth, height: panels.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(panels);
    return () => observer.disconnect();
  }, [allCollapsed]);

  function update(action: ReplicaDockAction, persist = true) { store.update(action, persist, availability); }
  function reveal(pane: ReplicaDockPane) { update({ type: "reveal", pane }); }
  function collapse(pane: ReplicaDockPane) { update({ type: "collapse", pane }); }
  function resize(requestedExtent: number, persist = false) {
    if (usable <= 0) return;
    if (layout.horizontal) update({ type: "split", chatWidth: resolveDockColumns(usable - requestedExtent, dimensions.width).assistantWidth }, persist);
    else update({ type: "split", historyFraction: resolveDockSplit(requestedExtent, dimensions.height).historyHeight / usable }, persist);
  }
  function chooseMode(mode: ReplicaDockMode) { update({ type: "mode", mode }); if (menuRef.current) menuRef.current.open = false; }
  function stopDrag(event: React.PointerEvent<HTMLElement>) {
    drag.current = null;
    floatingDrag.current = null;
    store.persist();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function floatingRect() {
    const width = typeof window === "undefined" ? 420 : Math.min(420, window.innerWidth - 24);
    const height = typeof window === "undefined" ? 640 : Math.min(640, window.innerHeight - 24);
    return state.floatingRect ?? { x: typeof window === "undefined" ? 12 : Math.max(12, window.innerWidth - width - 56), y: 72, width, height };
  }
  function startFloatingDrag(event: React.PointerEvent<HTMLElement>, resizeWindow = false) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, summary, select")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const visible = assistantRef.current?.getBoundingClientRect();
    const rect = visible ? { x: visible.x, y: visible.y, width: visible.width, height: visible.height } : floatingRect();
    floatingDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect, resize: resizeWindow };
  }
  function moveFloating(event: React.PointerEvent<HTMLElement>) {
    if (event.buttons === 0) { floatingDrag.current = null; return; }
    const dragging = floatingDrag.current;
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragging.x;
    const deltaY = event.clientY - dragging.y;
    const rect = dragging.resize
      ? { ...dragging.rect, width: Math.max(240, Math.min(window.innerWidth - dragging.rect.x - 12, dragging.rect.width + deltaX)), height: Math.max(280, Math.min(window.innerHeight - dragging.rect.y - 12, dragging.rect.height + deltaY)) }
      : { ...dragging.rect, x: Math.max(12, Math.min(window.innerWidth - 120, dragging.rect.x + deltaX)), y: Math.max(12, Math.min(window.innerHeight - 64, dragging.rect.y + deltaY)) };
    update({ type: "floating-rect", rect }, false);
  }

  const splitStyle: CSSProperties | undefined = bothOpen && dimensions.height > 0
    ? layout.horizontal
      ? { gridTemplateColumns: `${columns.historyWidth}px ${REPLICA_DOCK_SPLITTER}px ${columns.assistantWidth}px` }
      : { gridTemplateRows: `${split.historyHeight}px ${REPLICA_DOCK_SPLITTER}px ${split.assistantHeight}px` }
    : undefined;
  const rect = floatingRect();
  const floatStyle = state.floating ? { "--dock-float-x": `${rect.x}px`, "--dock-float-y": `${rect.y}px`, "--dock-float-width": `${rect.width}px`, "--dock-float-height": `${rect.height}px` } as CSSProperties : undefined;

  const heading = (pane: ReplicaDockPane, isOpen: boolean) => <div className="replica-dock-heading-row">
    <button className="replica-dock-heading" type="button" aria-expanded={isOpen} aria-controls={`${id}-${pane}`} aria-label={`${isOpen ? "收起" : "展开"}${paneLabel(pane)}`} onClick={() => isOpen ? collapse(pane) : reveal(pane)}>
      {isOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}{pane === "history" ? <History size={18} /> : <Bot size={18} />}<span>{paneLabel(pane)}</span>
    </button>
  </div>;

  return (
    <aside className={`replica-right-dock${allCollapsed ? " is-collapsed" : ""}`} aria-label="聊天与历史停靠栏" data-dock-mode={state.mode} data-dock-floating={state.floating || undefined}>
      {!anyEnabled && <div className="replica-dock-empty" role="status" title="历史与聊天都已关闭，可在布局设置中启用。"><Info size={20} aria-hidden="true" /><span aria-hidden="true">模块已关闭</span><span className="sr-only">历史与聊天都已关闭，可在布局设置中启用。</span></div>}
      {allCollapsed && anyEnabled && <div className={`replica-dock-rail${!bothEnabled ? " is-single" : ""}`}>
        {assistantEnabled && <button className={selectedLayout.assistantOpen && !state.floating ? "is-active" : undefined} type="button" onClick={() => reveal("assistant")} aria-label="展开聊天" aria-expanded={state.floating && state.floatingVisible} aria-controls={`${id}-assistant`} title="展开聊天"><Bot size={20} /><span className="replica-dock-rail-label" aria-hidden="true"><span>聊</span><span>天</span></span></button>}
        {historyEnabled && <button className={selectedLayout.historyOpen ? "is-active" : undefined} type="button" onClick={() => reveal("history")} aria-label="展开历史记录" aria-expanded={false} aria-controls={`${id}-history`} title="展开历史记录"><History size={20} /><span className="replica-dock-rail-label" aria-hidden="true"><span>历</span><span>史</span></span></button>}
      </div>}
      <div className="replica-dock-workspace" hidden={allCollapsed && !(state.floating && state.floatingVisible)}>
        <div className="replica-dock-toolbar" hidden={allCollapsed}>
          <div className="replica-dock-tabs" role="tablist" aria-label="右侧面板" aria-multiselectable={state.mode !== "exclusive"}>
            {assistantEnabled && <button type="button" role="tab" aria-selected={layout.assistantOpen} aria-controls={`${id}-assistant`} onClick={() => reveal("assistant")}><Bot size={16} />聊天</button>}
            {historyEnabled && <button type="button" role="tab" aria-selected={layout.historyOpen} aria-controls={`${id}-history`} onClick={() => reveal("history")}><History size={16} />历史</button>}
          </div>
          {(bothEnabled || (assistantEnabled && storageKey !== null)) && <details ref={menuRef} className="replica-dock-menu" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label="侧边栏布局设置" title="侧边栏布局设置"><Ellipsis size={18} /></summary>
            <div role="menu" aria-label="侧边栏布局">
              <span className="replica-dock-menu-label">右栏布局</span>
              {modeOptions.map(([mode, label, icon]) => <button key={mode} type="button" role="menuitemradio" aria-checked={state.mode === mode} onClick={() => chooseMode(mode)}>{icon}<span>{label}</span><span aria-hidden="true">{state.mode === mode ? "✓" : ""}</span></button>)}
              {assistantEnabled && storageKey !== null && <button type="button" role="menuitem" onClick={() => { update({ type: state.floating ? "dock" : "float" }); if (menuRef.current) menuRef.current.open = false; }}><SquareArrowOutUpRight size={16} /><span>{state.floating ? "聊天停靠回侧栏" : "聊天在浮窗中打开"}</span></button>}
              {bothEnabled && <p>左右分栏在空间不足时自动改为上下分栏。</p>}
            </div>
          </details>}
        </div>
        <div ref={panelsRef} className={`replica-dock-panels${bothOpen ? " is-split" : ""}${layout.horizontal ? " is-horizontal" : ""}`} hidden={allCollapsed && !(state.floating && state.floatingVisible)} style={splitStyle}>
          <section className={`replica-dock-pane replica-dock-history${layout.historyOpen ? " is-open" : ""}${layout.restorePane === "history" ? " is-restore" : ""}`} hidden={!layout.historyOpen && layout.restorePane !== "history"} aria-label="历史记录">
            {historyEnabled && heading("history", layout.historyOpen)}
            <div className="replica-dock-content" id={`${id}-history`} hidden={!layout.historyOpen}>{history}</div>
          </section>
          {bothOpen && <div
            className="replica-dock-splitter" role="separator" tabIndex={0} aria-label={layout.horizontal ? "调整历史与聊天宽度" : "调整历史与聊天高度"} aria-orientation={layout.horizontal ? "vertical" : "horizontal"} aria-controls={`${id}-history ${id}-assistant`}
            aria-valuemin={usable ? Math.round(limits.minimum / usable * 100) : 0} aria-valuemax={usable ? Math.round(limits.maximum / usable * 100) : 100} aria-valuenow={usable ? Math.round(extent / usable * 100) : 50}
            onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, start: layout.horizontal ? event.clientX : event.clientY, extent }; }}
            onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) resize(drag.current.extent + (layout.horizontal ? event.clientX : event.clientY) - drag.current.start); }}
            onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={() => { drag.current = null; }}
            onDoubleClick={() => update({ type: "split", historyFraction: .5, chatWidth: usable / 2 })}
            onKeyDown={(event) => { const step = event.shiftKey ? 48 : 16; const previous = layout.horizontal ? "ArrowLeft" : "ArrowUp"; const next = layout.horizontal ? "ArrowRight" : "ArrowDown"; const requested = event.key === previous ? extent - step : event.key === next ? extent + step : event.key === "Home" ? limits.minimum : event.key === "End" ? limits.maximum : null; if (requested !== null) { event.preventDefault(); resize(requested, true); } }}
          />}
          <section ref={assistantRef} className={`replica-dock-pane replica-dock-assistant${layout.assistantOpen ? " is-open" : ""}${layout.restorePane === "assistant" ? " is-restore" : ""}${state.floating ? " is-floating" : ""}`} style={floatStyle} popover={state.floating ? "manual" : undefined} hidden={!layout.assistantOpen && layout.restorePane !== "assistant"} aria-label={state.floating ? "聊天浮窗" : "聊天"} role={state.floating ? "dialog" : undefined}>
            {state.floating ? <div className="replica-dock-floating-heading" onPointerDown={startFloatingDrag} onPointerMove={moveFloating} onPointerUp={stopDrag} onPointerCancel={stopDrag}><Bot size={18} /><span>聊天</span><button type="button" aria-label="聊天停靠回侧栏" title="停靠回侧栏" onClick={() => update({ type: "dock" })}><Columns2 size={16} /></button><button type="button" aria-label="关闭聊天浮窗" onClick={() => update({ type: "floating-visible", visible: false })}><X size={18} /></button></div> : assistantEnabled && heading("assistant", layout.assistantOpen)}
            <div className="replica-dock-content" id={`${id}-assistant`} hidden={!layout.assistantOpen}>{assistant}</div>
            {state.floating && <div className="replica-dock-floating-resize" role="separator" aria-label="调整聊天浮窗大小" tabIndex={0} onPointerDown={(event) => startFloatingDrag(event, true)} onPointerMove={moveFloating} onPointerUp={stopDrag} onPointerCancel={stopDrag} onKeyDown={(event) => { const delta = event.shiftKey ? 48 : 16; if (!event.key.startsWith("Arrow")) return; event.preventDefault(); const next = { ...rect, width: Math.max(240, rect.width + (event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0)), height: Math.max(280, rect.height + (event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0)) }; update({ type: "floating-rect", rect: next }); }} />}
          </section>
        </div>
      </div>
    </aside>
  );
}

export default ReplicaRightDock;
