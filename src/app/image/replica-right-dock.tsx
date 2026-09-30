"use client";

import { Bot, ChevronLeft, ChevronRight, History } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import "./replica-right-dock.css";

export type ReplicaRightDockProps = {
  history: ReactNode;
  assistant: ReactNode;
  assistantOpenRequest?: number;
  onCollapsedChange?: (allCollapsed: boolean) => void;
};

export const REPLICA_DOCK_SPLITTER = 8;
export const REPLICA_HISTORY_MIN_HEIGHT = 160;
export const REPLICA_ASSISTANT_MIN_HEIGHT = 280;

export function resolveDockSplit(requestedHistoryHeight: number, availableHeight: number): { historyHeight: number; assistantHeight: number } {
  const usable = Math.max(0, Number.isFinite(availableHeight) ? availableHeight - REPLICA_DOCK_SPLITTER : 0);
  const scale = Math.min(1, usable / (REPLICA_HISTORY_MIN_HEIGHT + REPLICA_ASSISTANT_MIN_HEIGHT));
  const minimum = REPLICA_HISTORY_MIN_HEIGHT * scale;
  const maximum = usable - REPLICA_ASSISTANT_MIN_HEIGHT * scale;
  const historyHeight = Math.min(maximum, Math.max(minimum, Number.isFinite(requestedHistoryHeight) ? requestedHistoryHeight : minimum));
  return { historyHeight, assistantHeight: usable - historyHeight };
}

export function ReplicaRightDock({ history, assistant, assistantOpenRequest = 0, onCollapsedChange }: ReplicaRightDockProps): ReactElement {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(assistantOpenRequest > 0);
  const [handledAssistantOpenRequest, setHandledAssistantOpenRequest] = useState(assistantOpenRequest);
  const [availableHeight, setAvailableHeight] = useState(0);
  const [historyFraction, setHistoryFraction] = useState(.45);
  const panelsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; historyHeight: number } | null>(null);
  const id = useId();
  if (!Object.is(handledAssistantOpenRequest, assistantOpenRequest)) {
    setHandledAssistantOpenRequest(assistantOpenRequest);
    if (assistantOpenRequest > 0) setAssistantOpen(true);
  }
  const allCollapsed = !historyOpen && !assistantOpen;
  const bothOpen = historyOpen && assistantOpen;
  const usable = Math.max(0, availableHeight - REPLICA_DOCK_SPLITTER);
  const split = resolveDockSplit(usable * historyFraction, availableHeight);
  const limits = { minimum: resolveDockSplit(0, availableHeight).historyHeight, maximum: resolveDockSplit(usable, availableHeight).historyHeight };

  useEffect(() => { onCollapsedChange?.(allCollapsed); }, [allCollapsed, onCollapsedChange]);

  useEffect(() => {
    if (!bothOpen) drag.current = null;
  }, [bothOpen]);

  useEffect(() => {
    const panels = panelsRef.current;
    if (!panels || allCollapsed) return;
    const measure = () => setAvailableHeight(panels.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(panels);
    return () => observer.disconnect();
  }, [allCollapsed]);

  function resize(historyHeight: number) {
    if (usable > 0) setHistoryFraction(resolveDockSplit(historyHeight, availableHeight).historyHeight / usable);
  }

  const splitStyle: CSSProperties | undefined = bothOpen && availableHeight > 0
    ? { gridTemplateRows: `${split.historyHeight}px ${REPLICA_DOCK_SPLITTER}px ${split.assistantHeight}px` }
    : undefined;

  return (
    <aside className={`replica-right-dock${allCollapsed ? " is-collapsed" : ""}`} aria-label="聊天与历史停靠栏">
      {allCollapsed && <div className="replica-dock-rail">
        <button type="button" onClick={() => setAssistantOpen(true)} aria-label="展开聊天" aria-expanded={false} aria-controls={`${id}-assistant`} title="展开聊天"><Bot size={20} /><span className="replica-dock-rail-label" aria-hidden="true"><span>聊</span><span>天</span></span></button>
        <button type="button" onClick={() => setHistoryOpen(true)} aria-label="展开历史记录" aria-expanded={false} aria-controls={`${id}-history`} title="展开历史记录"><History size={20} /><span className="replica-dock-rail-label" aria-hidden="true"><span>历</span><span>史</span></span></button>
      </div>}
      <div ref={panelsRef} className={`replica-dock-panels${bothOpen ? " is-split" : ""}`} hidden={allCollapsed} style={splitStyle}>
        <section className={`replica-dock-pane replica-dock-history${historyOpen ? " is-open" : ""}`} aria-label="历史记录">
          <button className="replica-dock-heading" type="button" aria-expanded={historyOpen} aria-controls={`${id}-history`} aria-label={historyOpen ? "收起历史记录" : "展开历史记录"} onClick={() => setHistoryOpen((open) => !open)}>
            {historyOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}<History size={18} /><span>历史记录</span>
          </button>
          <div className="replica-dock-content" id={`${id}-history`} hidden={!historyOpen}>{history}</div>
        </section>
        {bothOpen && <div
          className="replica-dock-splitter"
          role="separator"
          tabIndex={0}
          aria-label="调整历史与聊天高度"
          aria-orientation="horizontal"
          aria-controls={`${id}-history ${id}-assistant`}
          aria-valuemin={usable ? Math.round(limits.minimum / usable * 100) : 0}
          aria-valuemax={usable ? Math.round(limits.maximum / usable * 100) : 100}
          aria-valuenow={usable ? Math.round(split.historyHeight / usable * 100) : 45}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, startY: event.clientY, historyHeight: split.historyHeight };
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId === event.pointerId) resize(drag.current.historyHeight + event.clientY - drag.current.startY);
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; }}
          onLostPointerCapture={() => { drag.current = null; }}
          onDoubleClick={() => setHistoryFraction(.45)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 48 : 16;
            const next = event.key === "ArrowUp" ? split.historyHeight - step : event.key === "ArrowDown" ? split.historyHeight + step : event.key === "Home" ? limits.minimum : event.key === "End" ? limits.maximum : null;
            if (next !== null) { event.preventDefault(); resize(next); }
          }}
        />}
        <section className={`replica-dock-pane replica-dock-assistant${assistantOpen ? " is-open" : ""}`} aria-label="聊天">
          <button className="replica-dock-heading" type="button" aria-expanded={assistantOpen} aria-controls={`${id}-assistant`} aria-label={assistantOpen ? "收起聊天" : "展开聊天"} onClick={() => setAssistantOpen((open) => !open)}>
            {assistantOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}<Bot size={18} /><span>聊天</span>
          </button>
          <div className="replica-dock-content" id={`${id}-assistant`} hidden={!assistantOpen}>{assistant}</div>
        </section>
      </div>
    </aside>
  );
}

export default ReplicaRightDock;
