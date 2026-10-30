import { afterEach, describe, expect, it, vi } from "vitest";
import { startViewportDiagnosticCapture } from "@/mobile/ui/viewport-diagnostics";
import {
  VIEWPORT_DIAGNOSTIC_COLUMNS as COLUMNS,
  VIEWPORT_DIAGNOSTIC_INDEX as INDEX,
  VIEWPORT_DIAGNOSTIC_EVENT as EVENT,
  VIEWPORT_DIAGNOSTIC_BOUNDS as BOUNDS,
  VIEWPORT_DIAGNOSTIC_MAX_BYTES,
  VIEWPORT_DIAGNOSTIC_MAX_ROWS,
  type ViewportDiagnosticPayload,
} from "@/lib/viewport-diagnostic-schema";

const token = "a".repeat(32);
let cleanup: (() => void) | undefined;

function browser() {
  vi.useFakeTimers();
  let now = 0;
  class Node extends EventTarget {
    scrollTop = 0;
    clientHeight = 740;
    scrollHeight = 740;
    top = 0;
    height = 740;
    inert = false;
    isContentEditable = false;
    dataset: Record<string, string> = {};
    nodes = new Map<string, Node[]>();
    getBoundingClientRect() { return { top: this.top, height: this.height }; }
    closest(selector: string) { return this.inert && selector.includes("[inert]") ? this : null; }
    querySelectorAll(selector: string) { return this.nodes.get(selector) ?? []; }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(node: Node) { return node === textarea; }
    get value(): never { throw new Error("Diagnostics must never read user text"); }
    get textContent(): never { throw new Error("Diagnostics must never read page text"); }
  }
  class Textarea extends Node {}
  class Input extends Node {}
  const root = new Node();
  root.dataset.viewportSource = "visual";
  const body = new Node();
  const backdrop = new Node();
  const dialog = new Node();
  const pane = new Node();
  const panel = new Node();
  const transcript = new Node();
  const composer = new Node();
  const textarea = new Textarea();
  const main = new Node();
  main.inert = true;
  main.height = 880;
  main.scrollHeight = 950;
  const probe = new Node();
  const doc = Object.assign(new Node(), { documentElement: root, body, activeElement: textarea, hidden: false });
  doc.nodes.set(".mobile-studio-prompt-backdrop:not([hidden]):not([inert])", [backdrop]);
  doc.nodes.set("main[data-studio-layout]", [main]);
  doc.nodes.set("[data-viewport-measure]", [probe]);
  doc.nodes.set('meta[name="viewport"]', [Object.assign(new Node(), { content: "width=device-width, interactive-widget=resizes-content" })]);
  backdrop.nodes.set(".mobile-studio-workspace-dialog", [dialog]);
  dialog.nodes.set(".mobile-studio-workspace-content:not([hidden]):not([inert])", [pane]);
  pane.nodes.set(".mobile-tag-assistant-panel", [panel]);
  panel.nodes.set(".assistant-transcript", [transcript]);
  panel.nodes.set(".assistant-composer-area", [composer]);
  const viewport = Object.assign(new EventTarget(), { height: 740, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0 });
  const keyboard = Object.assign(new EventTarget(), { boundingRect: { x: 0, y: 0, width: 0, height: 0 }, overlaysContent: true });
  const win = Object.assign(new EventTarget(), { innerHeight: 740, innerWidth: 390, visualViewport: viewport, scrollY: 0, isSecureContext: true });
  let observerCallback: (entries: Array<{ target: Node }>) => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: typeof observerCallback) { observerCallback = callback; }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = disconnect;
  });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("HTMLElement", Node);
  vi.stubGlobal("HTMLTextAreaElement", Textarea);
  vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { virtualKeyboard: keyboard });
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => name.endsWith("height") ? "740px" : "0px" }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  function frame(milliseconds = 16) {
    now += milliseconds;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  }
  function finish() { now = 20_000; vi.advanceTimersByTime(20_000); }
  return { root, body, doc, pane, main, viewport, keyboard, win, frames, frame, finish, disconnect, resize: () => observerCallback([{ target: root }, { target: body }, { target: backdrop }]) };
}

afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("numeric viewport diagnostic recorder", () => {
  it("records synchronous events and the following animation frame without reading text", () => {
    const b = browser();
    let output: ViewportDiagnosticPayload | undefined;
    cleanup = startViewportDiagnosticCapture(token, { onProgress: vi.fn(), onComplete: payload => { output = payload; } });
    b.frame();
    b.viewport.height = 360;
    b.viewport.dispatchEvent(new Event("resize"));
    b.viewport.height = 350;
    b.frame();
    b.doc.dispatchEvent(new Event("compositionstart"));
    b.doc.dispatchEvent(new Event("compositionend"));
    b.doc.dispatchEvent(new Event("selectionchange"));
    b.resize();
    b.frame();
    b.finish();
    expect(output?.capture).toBe(token);
    const rows = output!.rows;
    expect(rows.every(row => row.length === COLUMNS.length && row.every(Number.isFinite))).toBe(true);
    expect(rows.every(row => row.every((value, index) => value >= BOUNDS[index][0] && value <= BOUNDS[index][1]))).toBe(true);
    expect(rows.find(row => row[INDEX.event_mask] === EVENT.visual_resize)?.[INDEX.vv_height]).toBe(360);
    expect(rows.find(row => row[INDEX.event_mask] === (EVENT.visual_resize | EVENT.after_event_frame))?.[INDEX.vv_height]).toBe(350);
    expect(rows.some(row => row[INDEX.event_mask] === EVENT.composition_start)).toBe(true);
    expect(rows.some(row => row[INDEX.event_mask] === EVENT.composition_end)).toBe(true);
    expect(rows.some(row => row[INDEX.event_mask] === EVENT.selection_change)).toBe(true);
    expect(rows.some(row => row[INDEX.event_mask] === (EVENT.root_resize | EVENT.body_resize | EVENT.portal_resize))).toBe(true);
    expect(rows[0][INDEX.main_height]).toBe(880);
    expect(rows[0][INDEX.main_scroll_height]).toBe(950);
    expect(rows[0][INDEX.meta_resizes_content]).toBe(1);
    expect(rows.at(-1)?.[INDEX.event_mask]).toBe(EVENT.end);
    expect(b.disconnect).toHaveBeenCalledOnce();
    expect(b.frames.size).toBe(0);
  });

  it("keeps an event storm below both protocol limits while preserving the final sample", () => {
    const b = browser();
    let output: ViewportDiagnosticPayload | undefined;
    cleanup = startViewportDiagnosticCapture(token, { onProgress: vi.fn(), onComplete: payload => { output = payload; } });
    for (let index = 0; index < 1800; index++) {
      b.win.scrollY = index + 123456.78;
      b.doc.dispatchEvent(new Event("selectionchange"));
    }
    b.finish();
    expect(output!.rows.length).toBeLessThanOrEqual(VIEWPORT_DIAGNOSTIC_MAX_ROWS);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(VIEWPORT_DIAGNOSTIC_MAX_BYTES);
    expect(output!.rows.at(-1)?.[INDEX.event_mask]).toBe(EVENT.end);
    expect(output!.rows.at(-1)?.[INDEX.window_scroll_y]).toBe(125255.78);
  });

  it("reports unsupported browser measurements as finite sentinels on HTTP", () => {
    const b = browser();
    Object.assign(b.win, { visualViewport: null, isSecureContext: false });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    b.doc.nodes.delete("[data-viewport-measure]");
    let output: ViewportDiagnosticPayload | undefined;
    cleanup = startViewportDiagnosticCapture(token, { onProgress: vi.fn(), onComplete: payload => { output = payload; } });
    b.finish();
    const first = output!.rows[0];
    expect(first[INDEX.secure_context]).toBe(0);
    expect(first[INDEX.vk_available]).toBe(0);
    for (const field of ["vv_height", "vv_page_top", "dvh_height", "applied_height", "vk_y", "vk_height", "vk_overlay"] as const) {
      expect(first[INDEX[field]]).toBe(-1);
    }
    expect(first.every(Number.isFinite)).toBe(true);
  });

  it("cancels timers, observers and event listeners without completing on unmount", () => {
    const b = browser();
    const complete = vi.fn();
    cleanup = startViewportDiagnosticCapture(token, { onProgress: vi.fn(), onComplete: complete });
    cleanup();
    Object.defineProperty(b.doc, "activeElement", { get() { throw new Error("Listener survived cleanup"); } });
    b.doc.dispatchEvent(new Event("focusin"));
    b.viewport.dispatchEvent(new Event("resize"));
    b.finish();
    expect(complete).not.toHaveBeenCalled();
    expect(b.frames.size).toBe(0);
    expect(b.disconnect).toHaveBeenCalled();
  });
});
