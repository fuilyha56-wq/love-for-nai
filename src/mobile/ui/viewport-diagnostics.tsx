"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  VIEWPORT_DIAGNOSTIC_ACTIVE_KIND as ACTIVE,
  VIEWPORT_DIAGNOSTIC_BOUNDS,
  VIEWPORT_DIAGNOSTIC_CAPTURE_RE,
  VIEWPORT_DIAGNOSTIC_DURATION_MS,
  VIEWPORT_DIAGNOSTIC_EVENT as EVENT,
  VIEWPORT_DIAGNOSTIC_MAX_BYTES,
  VIEWPORT_DIAGNOSTIC_MAX_ROWS,
  VIEWPORT_DIAGNOSTIC_SOURCE as SOURCE,
  VIEWPORT_DIAGNOSTIC_VERSION,
  type ViewportDiagnosticPayload,
} from "@/lib/viewport-diagnostic-schema";
import { getWorkspaceKeyboard } from "./use-workspace-keyboard";

type CaptureCallbacks = { onProgress: (seconds: number) => void; onComplete: (payload: ViewportDiagnosticPayload) => void };

/** Reads geometry only. The cleanup cancels recording without uploading. */
export function startViewportDiagnosticCapture(capture: string, callbacks: CaptureCallbacks) {
  if (!VIEWPORT_DIAGNOSTIC_CAPTURE_RE.test(capture)) throw new Error("Invalid viewport capture");
  const root = document.documentElement;
  const body = document.body;
  const viewport = window.visualViewport;
  const keyboard = getWorkspaceKeyboard();
  const rows: number[][] = [];
  const payload: ViewportDiagnosticPayload = { capture, version: VIEWPORT_DIAGNOSTIC_VERSION, rows };
  // All fields are ASCII numbers and a hex token; string length equals UTF-8 bytes.
  let bytes = JSON.stringify(payload).length;
  let stopped = false;
  let frame = 0;
  let pendingEvents = 0;
  let previousGeometry: number[] | undefined;
  let lastSampleAt = -Infinity;
  let lastSeconds = -1;
  let observedPortal: HTMLElement | null = null;
  const start = performance.now();
  const removers: Array<() => void> = [];

  function visible<T extends HTMLElement>(scope: ParentNode, selector: string, includeInert = false): T | null {
    for (const node of scope.querySelectorAll<T>(selector)) {
      if (!node.closest(includeInert ? "[hidden]" : "[hidden], [inert]") && node.getBoundingClientRect().height > 0) return node;
    }
    return null;
  }
  function measurements(node: HTMLElement | null) {
    if (!node) return [-1, -1, -1];
    const rect = node.getBoundingClientRect();
    return [node.scrollTop, rect.top, rect.height];
  }
  function snapshot(mask: number) {
    const backdrop = visible<HTMLElement>(document, ".mobile-studio-prompt-backdrop:not([hidden]):not([inert])");
    const dialog = backdrop?.querySelector<HTMLElement>(".mobile-studio-workspace-dialog") ?? null;
    const pane = dialog ? visible<HTMLElement>(dialog, ".mobile-studio-workspace-content:not([hidden]):not([inert])") : null;
    const panel = pane?.querySelector<HTMLElement>(".mobile-tag-assistant-panel") ?? null;
    const transcript = panel?.querySelector<HTMLElement>(".assistant-transcript") ?? null;
    const composer = panel?.querySelector<HTMLElement>(".assistant-composer-area") ?? null;
    const active = document.activeElement;
    const textarea = pane && active instanceof HTMLTextAreaElement && pane.contains(active)
      ? active : pane ? visible<HTMLTextAreaElement>(pane, ".assistant-editor textarea, .replica-raw-textarea, textarea") : null;
    // The hidden background remains laid out and can affect root/body overflow.
    const main = visible<HTMLElement>(document, "main[data-studio-layout]", true);
    const style = getComputedStyle(root);
    const native = keyboard?.boundingRect;
    const kind = !active ? ACTIVE.none : active === body ? ACTIVE.body : active instanceof HTMLTextAreaElement ? ACTIVE.textarea
      : active instanceof HTMLInputElement ? ACTIVE.input : active instanceof HTMLElement && active.isContentEditable ? ACTIVE.editable : ACTIVE.other;
    const source = root.dataset.viewportSource === "visual" ? SOURCE.visual : root.dataset.viewportSource === "keyboard" ? SOURCE.keyboard : SOURCE.unknown;
    const row = [
      performance.now() - start, mask, window.innerHeight, window.innerWidth, root.clientHeight,
      viewport?.height ?? -1, viewport?.width ?? -1, viewport?.offsetTop ?? -1, viewport?.offsetLeft ?? -1,
      viewport?.scale ?? -1, viewport?.pageTop ?? -1,
      document.querySelector<HTMLElement>("[data-viewport-measure]")?.getBoundingClientRect().height ?? -1,
      Number.parseFloat(style.getPropertyValue("--lfn-viewport-height")), Number.parseFloat(style.getPropertyValue("--lfn-viewport-top")),
      window.scrollY, window.isSecureContext ? 1 : 0, keyboard ? 1 : 0,
      ...measurements(body), ...measurements(root), ...measurements(main), ...measurements(backdrop), ...measurements(dialog),
      ...measurements(pane), ...measurements(panel), ...measurements(transcript), ...measurements(composer), ...measurements(textarea),
      body.clientHeight, body.scrollHeight, root.scrollHeight, main?.clientHeight ?? -1, main?.scrollHeight ?? -1,
      kind, source, native?.y ?? -1, native?.height ?? -1, keyboard ? Number(keyboard.overlaysContent) : -1,
      /(?:^|,)\s*interactive-widget\s*=\s*resizes-content\s*(?:,|$)/i.test(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? "") ? 1 : 0,
      document.hidden ? 1 : 0,
    ].map((value, index) => {
      const [min, max] = VIEWPORT_DIAGNOSTIC_BOUNDS[index];
      return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : -1)) * 100) / 100;
    });
    return { row, backdrop };
  }
  function append(row: number[], force = false) {
    const size = JSON.stringify(row).length;
    if (force) {
      while (rows.length && (rows.length >= VIEWPORT_DIAGNOSTIC_MAX_ROWS || bytes + size + 1 > VIEWPORT_DIAGNOSTIC_MAX_BYTES)) {
        bytes -= JSON.stringify(rows.pop()).length + (rows.length ? 1 : 0);
      }
    }
    if (rows.length >= VIEWPORT_DIAGNOSTIC_MAX_ROWS || bytes + size + (rows.length ? 1 : 0) > VIEWPORT_DIAGNOSTIC_MAX_BYTES) return;
    bytes += size + (rows.length ? 1 : 0);
    rows.push(row);
  }
  function recordEvent(mask: number) {
    if (stopped) return;
    // Capture the event's current state as well as the next animation frame.
    pendingEvents |= mask;
    append(snapshot(mask).row);
  }
  function listen(target: EventTarget | null | undefined, type: string, mask: number, capturePhase = false) {
    if (!target) return;
    const listener = () => recordEvent(mask);
    target.addEventListener(type, listener, capturePhase);
    removers.push(() => target.removeEventListener(type, listener, capturePhase));
  }
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    let mask = 0;
    for (const entry of entries) {
      if (entry.target === root) mask |= EVENT.root_resize;
      else if (entry.target === body) mask |= EVENT.body_resize;
      else if (entry.target === observedPortal) mask |= EVENT.portal_resize;
    }
    if (mask) recordEvent(mask);
  });
  observer?.observe(root);
  observer?.observe(body);
  listen(viewport, "resize", EVENT.visual_resize);
  listen(viewport, "scroll", EVENT.visual_scroll);
  listen(window, "resize", EVENT.window_resize);
  listen(window, "scroll", EVENT.window_scroll);
  listen(document, "scroll", EVENT.element_scroll, true);
  listen(document, "focusin", EVENT.focus_in, true);
  listen(document, "focusout", EVENT.focus_out, true);
  listen(document, "selectionchange", EVENT.selection_change);
  listen(document, "compositionstart", EVENT.composition_start, true);
  listen(document, "compositionend", EVENT.composition_end, true);
  listen(document, "visibilitychange", EVENT.visibility_change);
  listen(keyboard, "geometrychange", EVENT.keyboard_geometry);

  function sampleFrame() {
    if (stopped) return;
    const { row, backdrop } = snapshot(pendingEvents ? pendingEvents | EVENT.after_event_frame : EVENT.geometry_frame);
    if (backdrop !== observedPortal) {
      if (observedPortal) observer?.unobserve(observedPortal);
      observedPortal = backdrop;
      if (observedPortal) observer?.observe(observedPortal);
    }
    const changed = !previousGeometry || row.some((value, index) => index >= 2 && value !== previousGeometry![index]);
    if (pendingEvents || changed || row[0] - lastSampleAt >= 100) {
      if (!pendingEvents && !changed) row[1] = EVENT.heartbeat;
      append(row);
      lastSampleAt = row[0];
    }
    previousGeometry = row;
    pendingEvents = 0;
    const seconds = Math.max(0, Math.ceil((VIEWPORT_DIAGNOSTIC_DURATION_MS - row[0]) / 1000));
    if (seconds !== lastSeconds) { lastSeconds = seconds; callbacks.onProgress(seconds); }
    frame = requestAnimationFrame(sampleFrame);
  }
  function cleanup() {
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    observer?.disconnect();
    removers.forEach(remove => remove());
  }
  const timer = setTimeout(() => {
    append(snapshot(EVENT.end).row, true);
    cleanup();
    callbacks.onComplete(payload);
  }, VIEWPORT_DIAGNOSTIC_DURATION_MS);
  append(snapshot(EVENT.start).row);
  frame = requestAnimationFrame(sampleFrame);
  return cleanup;
}

/** Opt-in through the fragment so the capture token never enters access-log URLs. */
export function ViewportDiagnostics() {
  const [capture, setCapture] = useState<string | null>(null);
  const [status, setStatus] = useState<"ready" | "recording" | "uploading" | "success" | "error">("ready");
  const [seconds, setSeconds] = useState(20);
  const mounted = useRef(false);
  const stopCapture = useRef<(() => void) | null>(null);
  const request = useRef<AbortController | null>(null);
  const originalBody = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("viewportTrace")?.toLowerCase();
    void Promise.resolve().then(() => {
      if (mounted.current && token && VIEWPORT_DIAGNOSTIC_CAPTURE_RE.test(token)) setCapture(token);
    });
    return () => {
      mounted.current = false;
      stopCapture.current?.();
      request.current?.abort();
    };
  }, []);

  async function upload() {
    if (!originalBody.current || !mounted.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus("uploading");
    try {
      const response = await fetch("/api/diagnostics/viewport", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: originalBody.current,
        signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("Viewport upload failed");
      if (mounted.current && request.current === controller) setStatus("success");
    } catch {
      if (mounted.current && !controller.signal.aborted && request.current === controller) setStatus("error");
    }
  }
  function begin() {
    if (!capture || status === "recording" || status === "uploading") return;
    stopCapture.current?.();
    originalBody.current = null;
    setStatus("recording");
    setSeconds(20);
    stopCapture.current = startViewportDiagnosticCapture(capture, {
      onProgress: setSeconds,
      onComplete: payload => {
        stopCapture.current = null;
        originalBody.current = JSON.stringify(payload);
        void upload();
      },
    });
  }
  if (!capture) return null;
  const text = status === "recording" ? `尺寸记录中 · ${seconds}秒` : status === "uploading" ? "正在发送尺寸记录…"
    : status === "success" ? "尺寸记录已发送 · 可再次记录" : status === "error" ? "发送失败 · 点击重试原记录" : "开始20秒尺寸记录";
  return createPortal(<><style>{`body:has(.mobile-studio-prompt-backdrop:not([hidden])) > .lfn-viewport-diagnostic-control { --viewport-trace-top: 4px; }`}</style><button type="button" className="lfn-viewport-diagnostic-control" data-viewport-diagnostics="true" onClick={status === "error" ? () => void upload() : begin}
    disabled={status === "recording" || status === "uploading"}
    style={{ position: "fixed", zIndex: 2147483000, top: "calc(env(safe-area-inset-top, 0px) + var(--viewport-trace-top, 64px))", left: "50%", transform: "translateX(-50%)", width: "max-content", maxWidth: "90vw", padding: "4px 8px", border: "1px solid #d8d8d8", borderRadius: 7, background: "#fff", color: "#222", fontSize: 11, lineHeight: 1.4, boxShadow: "0 1px 5px #0002" }}>
    <span aria-live="polite">{text}</span><small style={{ display: "block", fontSize: 9 }}>只采集尺寸和滚动事件，不采集输入文字</small>
  </button></>, document.body);
}
