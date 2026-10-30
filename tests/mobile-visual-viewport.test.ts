import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => runtime.effects.push(effect),
}));
import { useVisualViewport } from "@/mobile/ui/use-visual-viewport";
import * as workspaceKeyboard from "@/mobile/ui/use-workspace-keyboard";

function browser(withViewport = true, withKeyboard = false, withDynamicViewport = false) {
  const properties = new Map<string, string>();
  const root = {
    clientHeight: 800,
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    dataset: {} as Record<string, string>,
  };
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 800, offsetLeft: 0, offsetTop: 0, scale: 1 });
  const keyboard = Object.assign(new EventTarget(), { boundingRect: { x: 0, y: 0, width: 0, height: 0 }, overlaysContent: false });
  const orientation = new EventTarget();
  const win = Object.assign(new EventTarget(), {
    innerWidth: 390, innerHeight: 800, visualViewport: withViewport ? viewport : undefined, screen: { orientation },
    matchMedia: vi.fn(() => ({ matches: false })),
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    activeElement: null as null | {
      matches: (selector: string) => boolean; isContentEditable?: boolean;
      isConnected?: boolean; closest?: (selector: string) => object | null;
    },
  });
  const dynamic = { height: 800, notify: () => {} };
  const probe = {
    style: { cssText: "" }, setAttribute: vi.fn(), remove: vi.fn(),
    getBoundingClientRect: () => ({ height: dynamic.height }),
  };
  const disconnect = vi.fn();
  Object.assign(doc, { createElement: () => probe, body: { appendChild: vi.fn() } });
  vi.stubGlobal("CSS", { supports: () => withDynamicViewport });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { dynamic.notify = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { virtualKeyboard: withKeyboard ? keyboard : undefined });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  function flush() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  }
  function focus() {
    doc.activeElement = { matches: () => true, isConnected: true, closest: () => null };
    doc.dispatchEvent(new Event("focusin"));
    flush();
    return doc.activeElement;
  }
  function resize() {
    (withViewport ? viewport : win).dispatchEvent(new Event("resize"));
    flush();
  }
  return { properties, root, viewport, keyboard, orientation, win, doc, frames, request, flush, focus, resize, dynamic, probe, disconnect };
}

let unmount: () => void;
function mount() {
  // Supply the effect dispatcher without installing a browser/DOM test runtime.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useVisualViewport();
  const cleanup = runtime.effects[0]();
  unmount = typeof cleanup === "function" ? cleanup : () => {};
}

function workspaceBrowser() {
  const b = browser(true, false, true);
  b.win.innerWidth = 406;
  b.viewport.width = 406.67;
  b.win.innerHeight = b.root.clientHeight = b.viewport.height = b.dynamic.height = 754;
  const workspace = vi.spyOn(workspaceKeyboard, "getWorkspaceViewport").mockReturnValue({ height: 754, width: 406 });
  const writes = vi.spyOn(b.root.style, "setProperty");
  function setGeometry(height: number, dynamicHeight = height) {
    b.win.innerHeight = b.root.clientHeight = Math.floor(height);
    b.viewport.height = height;
    b.dynamic.height = dynamicHeight;
  }
  function resize(height: number, dynamicHeight = height) {
    setGeometry(height, dynamicHeight);
    b.resize();
  }
  const appliedHeight = () => Number.parseFloat(b.properties.get("--lfn-viewport-height")!);
  const writtenHeights = () => writes.mock.calls.filter(([name]) => name === "--lfn-viewport-height")
    .map(([, value]) => Number.parseFloat(value));
  return { ...b, workspace, setGeometry, resize, appliedHeight, writtenHeights };
}

describe("mobile visual viewport", () => {
  beforeEach(() => { runtime.effects = []; unmount = () => {}; vi.useFakeTimers(); });
  afterEach(() => { unmount(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("follows a visual-only keyboard resize and pan without subtracting the keyboard twice", () => {
    const b = browser();
    mount();
    b.focus();
    b.request.mockClear();
    Object.assign(b.viewport, { height: 370.5, width: 360.5, offsetTop: 45.25, offsetLeft: 4.5 });
    b.viewport.dispatchEvent(new Event("resize"));
    b.viewport.dispatchEvent(new Event("scroll"));
    b.win.dispatchEvent(new Event("resize"));
    expect(b.frames.size).toBe(1);
    b.flush();
    expect(b.win.innerHeight).toBe(800);
    expect(Object.fromEntries(b.properties)).toEqual({
      "--lfn-viewport-height": "370.5px", "--lfn-viewport-width": "360.5px",
      "--lfn-viewport-top": "45.25px", "--lfn-viewport-left": "4.5px",
      "--lfn-keyboard-height": "429.5px",
    });
    expect(b.root.dataset.keyboardOpen).toBe("true");
  });

  it("updates layout while zoomed and distinguishes pinch zoom from additional keyboard occlusion", () => {
    const b = browser();
    mount();
    b.focus();
    Object.assign(b.viewport, { height: 400, width: 195, offsetTop: 80, scale: 2 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("400px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
    b.viewport.height = 250;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("250px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("300px");
    expect(b.root.dataset.keyboardOpen).toBe("true");
  });

  it("does not report browser chrome or an unfocused window resize as a keyboard", () => {
    const b = browser();
    mount();
    b.focus();
    b.viewport.height = 720;
    b.resize();
    expect(b.root.dataset.keyboardOpen).toBe("false");
    b.doc.activeElement = null;
    b.viewport.height = 400;
    b.resize();
    expect(b.root.dataset.keyboardOpen).toBe("false");
  });

  it("uses window dimensions without VisualViewport and retains the before-focus resize baseline", () => {
    const b = browser(false);
    mount();
    b.focus();
    b.win.innerHeight = b.root.clientHeight = 440;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("440px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("360px");
    b.win.innerHeight = b.root.clientHeight = 800;
    b.resize();
    expect(b.properties.get("--lfn-keyboard-height")).toBe("0px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
  });

  it("uses the native docked keyboard edge when the visual viewport understates usable space", () => {
    const b = browser(true, true);
    mount();
    b.focus();
    b.keyboard.overlaysContent = true;
    b.viewport.height = 360;
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 335 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("465px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("335px");
    expect(b.root.dataset.viewportSource).toBe("keyboard");
    Object.assign(b.keyboard.boundingRect, { y: 400, height: 400 });
    b.keyboard.dispatchEvent(new Event("geometrychange"));
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("400px");
    Object.assign(b.keyboard.boundingRect, { y: 0, width: 0, height: 0 });
    b.viewport.height = 800;
    b.keyboard.dispatchEvent(new Event("geometrychange"));
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
  });

  it("does not remove a page-wide strip for floating keyboards or invalid native rectangles", () => {
    const b = browser(true, true);
    mount();
    b.focus();
    b.keyboard.overlaysContent = true;
    Object.assign(b.keyboard.boundingRect, { x: 40, y: 500, width: 280, height: 240 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    expect(b.root.dataset.viewportSource).toBe("visual");
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 600 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
  });

  it("restores the same visible height after native dismissal with browser toolbars expanded", () => {
    const b = browser(true, true, true);
    b.win.innerHeight = b.root.clientHeight = 844;
    b.viewport.height = b.dynamic.height = 739;
    mount();
    expect(b.properties.get("--lfn-viewport-height")).toBe("739px");
    b.focus();
    const focused = b.doc.activeElement;
    b.keyboard.overlaysContent = true;
    Object.assign(b.viewport, { height: 360, offsetTop: 20 });
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 379 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("445px");
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 0, width: 0, height: 0 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("739px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
    expect(b.doc.activeElement).toBe(focused);
    // The visual viewport recovers only to the area above browser controls.
    Object.assign(b.viewport, { height: 739, offsetTop: 0 });
    b.resize();
    expect(b.root.dataset.viewportSource).toBe("visual");
    // Reopening with retained focus must not reuse a latched full height.
    b.viewport.height = 360;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
  });

  it("bounds stale HTTP visual metrics by the current dynamic viewport without limiting real expansion", () => {
    const b = browser(true, false, true);
    b.win.innerHeight = b.root.clientHeight = 844;
    b.viewport.height = b.dynamic.height = 739;
    mount();
    b.focus();
    for (let visit = 0; visit < 3; visit++) {
      b.viewport.height = 360;
      b.resize();
      expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
      // Edge may restore the toolbar-hidden height before browser chrome.
      b.viewport.height = 844;
      b.resize();
      expect(b.properties.get("--lfn-viewport-height")).toBe("739px");
    }
    vi.advanceTimersByTime(1000);
    b.flush();
    expect(b.frames.size).toBe(0);
    // Toolbars can move later, without a VisualViewport notification.
    b.dynamic.height = 700;
    b.dynamic.notify();
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("700px");
    b.dynamic.height = 844;
    b.dynamic.notify();
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("844px");
    unmount();
    expect(b.disconnect).toHaveBeenCalledOnce();
    expect(b.probe.remove).toHaveBeenCalledOnce();
    unmount = () => {};
  });

  it.each(["visual", "window"])("shrinks the workspace inside the %s resize event before any animation frame", target => {
    const b = workspaceBrowser();
    mount();
    const focused = b.focus();
    b.setGeometry(374.67);
    (target === "visual" ? b.viewport : b.win).dispatchEvent(new Event("resize"));
    // Holding 754 here leaves the phone's composer behind the already-open IME.
    // Deliberately do not flush RAF: the event itself must publish the shrink.
    expect(b.appliedHeight()).toBe(374.67);
    expect(b.appliedHeight()).toBeLessThanOrEqual(b.viewport.height);
    expect(b.doc.activeElement).toBe(focused);
    vi.advanceTimersByTime(16);
    b.flush();
    expect(b.appliedHeight()).toBe(374.67);
  });

  it.each([16, 32])("eases a phone correction arriving after %sms within 80ms without exceeding the visible area", gap => {
    const b = workspaceBrowser();
    mount();
    const focused = b.focus();
    b.resize(374.67);
    expect(b.appliedHeight()).toBe(374.67);
    expect(Number.parseFloat(b.properties.get("--lfn-keyboard-height")!)).toBeCloseTo(379.33);
    vi.advanceTimersByTime(gap);
    b.resize(484.67);
    expect(b.appliedHeight()).toBe(374.67);

    const recovery = [b.appliedHeight()];
    for (let frame = 0; frame < 5; frame++) {
      // Keyboard state follows raw geometry, even while layout is interpolating.
      expect(Number.parseFloat(b.properties.get("--lfn-keyboard-height")!)).toBeCloseTo(269.33);
      expect(b.root.dataset.keyboardOpen).toBe("true");
      vi.advanceTimersByTime(16);
      b.flush();
      recovery.push(b.appliedHeight());
      expect(b.appliedHeight()).toBeLessThanOrEqual(b.viewport.height);
      expect(b.appliedHeight()).toBeGreaterThanOrEqual(recovery.at(-2)!);
    }
    expect(recovery[1]).toBeGreaterThan(374.67);
    expect(recovery[1]).toBeLessThan(484.67);
    expect(recovery.at(-1)).toBe(484.67);
    expect(b.doc.activeElement).toBe(focused);
    vi.advanceTimersByTime(200);
    b.flush();
    expect(b.appliedHeight()).toBe(484.67);
  });

  it("keeps repeated retained-focus dismissals within the workspace even when both viewport sources overstate it", () => {
    const b = workspaceBrowser();
    mount();
    const focused = b.focus();
    for (let visit = 0; visit < 3; visit++) {
      b.resize(484.67);
      expect(b.appliedHeight()).toBe(484.67);
      b.resize(864);
      expect(b.appliedHeight()).toBe(754);
      vi.advanceTimersByTime(34);
      b.dynamic.height = 974;
      b.dynamic.notify();
      expect(b.appliedHeight()).toBe(754);
      vi.advanceTimersByTime(900);
      b.flush();
      expect(b.appliedHeight()).toBe(754);
      expect(b.doc.activeElement).toBe(focused);
      expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
      b.resize(754);
    }
    expect(Math.max(...b.writtenHeights())).toBe(754);
  });

  it("keeps the workspace ceiling through blur and restores dismissal without a merge delay", () => {
    const b = workspaceBrowser();
    mount();
    b.focus();
    b.resize(484.67);
    expect(b.appliedHeight()).toBe(484.67);

    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    b.flush();
    // Blur by itself does not prove that the keyboard has finished closing.
    expect(b.appliedHeight()).toBe(484.67);
    b.resize(864, 974);
    expect(b.appliedHeight()).toBe(754);
    vi.advanceTimersByTime(1000);
    b.resize(864, 974);
    expect(b.appliedHeight()).toBe(754);
    expect(Math.max(...b.writtenHeights())).toBe(754);
  });

  it("applies a single-stage opening immediately and does not animate later clipboard resizing", () => {
    const b = workspaceBrowser();
    mount();
    b.focus();
    b.resize(400);
    expect(b.appliedHeight()).toBe(400);
    vi.advanceTimersByTime(200);
    b.flush();
    b.resize(440);
    expect(b.appliedHeight()).toBe(440);
    b.resize(360);
    expect(b.appliedHeight()).toBe(360);
  });

  it.each(["dismissal", "smaller viewport", "smaller target", "zoom", "width", "blur"])("cancels an upward correction on %s without later replaying its old target", change => {
    const b = workspaceBrowser();
    mount();
    b.focus();
    b.resize(374.67);
    vi.advanceTimersByTime(16);
    b.resize(484.67);
    vi.advanceTimersByTime(16);
    b.flush();
    expect(b.appliedHeight()).toBeGreaterThan(374.67);
    expect(b.appliedHeight()).toBeLessThan(484.67);

    let expected: number;
    if (change === "dismissal") {
      b.setGeometry(864, 974);
      b.viewport.dispatchEvent(new Event("resize"));
      expected = 754;
      // Closing must be synchronous too, rather than finishing the animation.
      expect(b.appliedHeight()).toBe(expected);
      expect(b.root.dataset.keyboardOpen).toBe("false");
    } else if (change === "smaller viewport" || change === "smaller target") {
      // 450 is below the former target but still above the current animation.
      // It must cancel that target just as a shrink below the current height does.
      expected = change === "smaller viewport" ? 350 : 450;
      b.setGeometry(expected);
      b.viewport.dispatchEvent(new Event("resize"));
      expect(b.appliedHeight()).toBe(expected);
    } else if (change === "zoom") {
      Object.assign(b.viewport, { width: 203.33, offsetTop: 80, scale: 2 });
      b.resize(300, 200);
      expected = 300;
      expect(b.properties.get("--lfn-viewport-top")).toBe("80px");
    } else if (change === "width") {
      b.win.innerWidth = b.viewport.width = 600;
      // The getter owns width matching and invalidates the old snapshot.
      b.workspace.mockReturnValue(undefined);
      b.resize(900);
      expected = 900;
    } else {
      b.doc.activeElement = null;
      b.doc.dispatchEvent(new Event("focusout"));
      expected = 484.67;
    }
    b.flush();
    expect(b.appliedHeight()).toBe(expected);
    const writesAfterCancellation = b.writtenHeights().length;
    vi.advanceTimersByTime(200);
    b.flush();
    expect(b.appliedHeight()).toBe(expected);
    expect(b.writtenHeights()).toHaveLength(writesAfterCancellation);
  });

  it("does not apply the unscaled workspace ceiling during pinch zoom", () => {
    const b = workspaceBrowser();
    mount();
    b.focus();
    Object.assign(b.viewport, { width: 203.33, offsetTop: 80, scale: 2 });
    b.resize(800, 200);
    expect(b.appliedHeight()).toBe(800);
    expect(b.properties.get("--lfn-viewport-top")).toBe("80px");
    b.resize(400, 200);
    expect(b.appliedHeight()).toBe(400);
    Object.assign(b.viewport, { width: 406.67, offsetTop: 0, scale: 1 });
    b.resize(864, 974);
    expect(b.appliedHeight()).toBe(754);
  });

  it.each(["hidden", "disconnected"])("coalesces the recorded closing undershoot only after the old editor is %s", disappearance => {
    const b = workspaceBrowser();
    mount();
    const editor = b.focus();
    b.resize(484.67);
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    if (disappearance === "hidden") editor.closest = () => ({});
    else editor.isConnected = false;
    // trace2: the reverse shrink arrives 95ms after blur, not at blur itself.
    vi.advanceTimersByTime(95);
    b.resize(374.67);
    expect(b.appliedHeight()).toBe(484.67);
    vi.advanceTimersByTime(30);
    b.setGeometry(754);
    b.viewport.dispatchEvent(new Event("resize"));
    expect(b.appliedHeight()).toBe(754);
    vi.advanceTimersByTime(100);
    b.flush();
    expect(b.writtenHeights()).toEqual([754, 484.67, 754]);
  });

  it("does not postpone a persistent hidden-editor shrink beyond 50ms or restart for further shrinkage", () => {
    const b = workspaceBrowser();
    mount();
    const editor = b.focus();
    b.resize(484.67);
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    editor.closest = () => ({});
    vi.advanceTimersByTime(95);
    b.resize(374.67);
    vi.advanceTimersByTime(49);
    b.flush();
    expect(b.appliedHeight()).toBe(484.67);
    vi.advanceTimersByTime(1);
    b.flush();
    expect(b.appliedHeight()).toBe(374.67);
    b.resize(350);
    expect(b.appliedHeight()).toBe(350);
    vi.advanceTimersByTime(16);
    b.resize(320);
    expect(b.appliedHeight()).toBe(320);
    vi.advanceTimersByTime(100);
    b.flush();
    expect(b.appliedHeight()).toBe(320);
  });

  it.each(["offsetTop", "offsetLeft"] as const)("cancels hidden-editor waiting on a changed %s without starting a new wait", axis => {
    const b = workspaceBrowser();
    mount();
    const editor = b.focus();
    b.resize(484.67);
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    editor.closest = () => ({});
    vi.advanceTimersByTime(95);
    b.resize(374.67);
    expect(b.appliedHeight()).toBe(484.67);

    vi.advanceTimersByTime(20);
    b.viewport[axis] = 12;
    b.setGeometry(360);
    b.viewport.dispatchEvent(new Event("scroll"));
    expect(b.appliedHeight()).toBe(360);
    expect(b.properties.get(axis === "offsetTop" ? "--lfn-viewport-top" : "--lfn-viewport-left")).toBe("12px");
    // Another contraction must not restart the cancelled editor's allowance.
    b.resize(340);
    expect(b.appliedHeight()).toBe(340);
    vi.advanceTimersByTime(100);
    b.flush();
    expect(b.appliedHeight()).toBe(340);
  });

  it("never holds an offscreen editor merely because it blurred while still visible", () => {
    const b = workspaceBrowser();
    mount();
    const editor = b.focus();
    b.resize(484.67);
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    vi.advanceTimersByTime(95);
    b.setGeometry(374.67);
    b.viewport.dispatchEvent(new Event("resize"));
    expect(editor.isConnected).toBe(true);
    expect(editor.closest?.("[hidden], [inert]")).toBeNull();
    expect(b.appliedHeight()).toBe(374.67);
  });

  it("applies upward corrections immediately when reduced motion is requested", () => {
    const b = workspaceBrowser();
    b.win.matchMedia.mockReturnValue({ matches: true });
    mount();
    b.focus();
    b.resize(374.67);
    expect(b.appliedHeight()).toBe(374.67);
    vi.advanceTimersByTime(16);
    b.resize(484.67);
    expect(b.appliedHeight()).toBe(484.67);
    vi.advanceTimersByTime(16);
    b.flush();
    expect(b.writtenHeights()).toEqual([754, 374.67, 484.67]);
  });

  it("ignores invalid dynamic measurements and does not mix CSS dvh with pinch zoom", () => {
    const b = browser(true, false, true);
    b.dynamic.height = 0;
    mount();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    b.dynamic.height = 200;
    Object.assign(b.viewport, { height: 400, width: 195, offsetTop: 80, scale: 2 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("400px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("80px");
    Object.assign(b.viewport, { height: 800, width: 390, offsetTop: 0, scale: 1 });
    b.dynamic.height = 739;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("739px");
  });

  it.each([false, true])("does not expand stale native dismissal without usable dvh (support=%s)", support => {
    const b = browser(true, true, support);
    b.dynamic.height = 0;
    mount();
    b.focus();
    b.keyboard.overlaysContent = true;
    Object.assign(b.viewport, { height: 360, offsetTop: 20 });
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 335 });
    b.resize();
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 0, width: 0, height: 0 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("20px");
    expect(b.root.dataset.viewportSource).toBe("visual");
  });

  it("restores on confirmed native dismissal while focus and visual height/pan are still stale", () => {
    const b = browser(true, true, true);
    mount();
    b.focus();
    const focused = b.doc.activeElement;
    b.keyboard.overlaysContent = true;
    Object.assign(b.viewport, { height: 360, offsetTop: 20 });
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 335 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("445px");
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 0, width: 0, height: 0 });
    b.keyboard.dispatchEvent(new Event("geometrychange"));
    b.flush();
    expect(b.doc.activeElement).toBe(focused);
    expect(b.viewport.height).toBe(360);
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("0px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
    // Late visual events must not reapply the old keyboard rectangle.
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    // A new focus starts a new opening; the old empty rect cannot prove that
    // keyboard is still closed when the browser already reports occlusion.
    b.focus();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    expect(b.root.dataset.keyboardOpen).toBe("true");
  });

  it("does not infer dismissal from blur or an API that has never supplied valid geometry", () => {
    const b = browser(true, true);
    mount();
    b.focus();
    b.keyboard.overlaysContent = true;
    b.viewport.height = 360;
    b.resize();
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    b.keyboard.dispatchEvent(new Event("geometrychange"));
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    expect(b.root.dataset.keyboardOpen).toBe("true");
  });

  it("ignores stale native occlusion after returning ownership to browser resizing", () => {
    const b = browser(true, true);
    mount();
    b.focus();
    b.keyboard.overlaysContent = true;
    b.viewport.height = 360;
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 335 });
    b.resize();
    b.keyboard.overlaysContent = false;
    b.viewport.height = 800;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("0px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
    // Starting a new overlay visit with an empty rect must not reuse the old
    // session's successful geometry to expand a genuinely occluded viewport.
    b.keyboard.overlaysContent = true;
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 0, width: 0, height: 0 });
    b.viewport.height = 360;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    expect(b.root.dataset.keyboardOpen).toBe("true");
  });

  it("does not reuse a completed native dismissal when the same focused input reopens the keyboard", () => {
    const b = browser(true, true, true);
    mount();
    b.focus();
    b.keyboard.overlaysContent = true;
    b.viewport.height = 360;
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 335 });
    b.resize();
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 0, width: 0, height: 0 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    b.viewport.height = 800;
    b.resize();
    b.viewport.height = 360;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    expect(b.root.dataset.keyboardOpen).toBe("true");
  });

  it("uses the visual rectangle for content resize and never expands visual-only occlusion", () => {
    const b = browser();
    mount();
    b.focus();
    b.win.innerHeight = b.root.clientHeight = 465;
    Object.assign(b.viewport, { height: 465, offsetTop: 0 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("465px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("335px");
    expect(b.root.dataset.viewportSource).toBe("visual");
    // A split-screen/window resize can shrink layout while the IME separately
    // occludes the visual viewport, even when the input remains focused.
    b.viewport.height = 360;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    expect(b.root.dataset.viewportSource).toBe("visual");
    // An unchanged layout viewport must never extend the page under the IME.
    b.win.innerHeight = b.root.clientHeight = 800;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    expect(b.root.dataset.viewportSource).toBe("visual");
  });

  it("keeps one geometry source through opening, closing and clipboard-height threshold crossings", () => {
    const b = browser();
    mount();
    b.focus();
    const heights = [800, 720, 690, 670, 650, 465, 400, 360, 320, 240, 320, 465, 650, 670, 690, 720, 800, 465, 440, 465];
    const observed: number[] = [];
    for (const height of heights) {
      b.viewport.height = height;
      b.resize();
      observed.push(Number.parseFloat(b.properties.get("--lfn-viewport-height")!));
      expect(b.root.dataset.viewportSource).toBe("visual");
      expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
    }
    expect(observed).toEqual(heights);
  });

  it("does not zero the visual pan when content/visual animation rounding crosses two pixels", () => {
    const b = browser();
    mount();
    b.focus();
    b.win.innerHeight = b.root.clientHeight = 465;
    for (const height of [462, 464, 462.5, 465, 463, 464.5]) {
      Object.assign(b.viewport, { height, offsetTop: 12 });
      b.resize();
      expect(b.properties.get("--lfn-viewport-height")).toBe(`${height}px`);
      expect(b.properties.get("--lfn-viewport-top")).toBe("12px");
      expect(b.root.dataset.viewportSource).toBe("visual");
    }
  });

  it("reads settled keyboard geometry even if there is no second resize notification", () => {
    const b = browser();
    mount();
    b.focus();
    b.viewport.height = 360;
    b.resize();
    b.viewport.height = 465;
    vi.advanceTimersByTime(180);
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("465px");
    vi.advanceTimersByTime(1000);
    b.flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(b.frames.size).toBe(0);
  });

  it("follows fallback dismiss/reopen metrics on the next paint without waiting for a timer", () => {
    const b = browser();
    mount();
    b.focus();
    const focused = b.doc.activeElement;
    b.viewport.height = 360;
    b.resize();
    // The browser's event preceded the actual closing animation. There is no
    // native API and no second event when these metrics finally catch up.
    vi.advanceTimersByTime(16);
    b.viewport.height = 800;
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
    expect(b.doc.activeElement).toBe(focused);
    // A clipboard/keyboard swap can immediately shrink it again while the
    // same input keeps focus; never latch the full-height restoration.
    vi.advanceTimersByTime(16);
    Object.assign(b.viewport, { height: 465, offsetTop: 15 });
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("465px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("15px");
    expect(b.root.dataset.keyboardOpen).toBe("true");
    vi.advanceTimersByTime(1000);
    b.flush();
    expect(b.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues tracking after a transient empty viewport report", () => {
    const b = browser();
    mount();
    b.focus();
    b.viewport.height = 360;
    b.resize();
    vi.advanceTimersByTime(16);
    b.viewport.height = 0;
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("360px");
    vi.advanceTimersByTime(16);
    b.viewport.height = 800;
    b.flush();
    expect(b.properties.get("--lfn-viewport-height")).toBe("800px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
  });

  it("resets stale baselines after rotation and retains them through keyboard dismissal", () => {
    const b = browser();
    mount();
    b.focus();
    b.win.innerWidth = b.viewport.width = 800;
    b.win.innerHeight = b.root.clientHeight = b.viewport.height = 390;
    b.orientation.dispatchEvent(new Event("change"));
    b.flush();
    expect(b.root.dataset.keyboardOpen).toBe("false");
    b.viewport.height = 200;
    b.resize();
    expect(b.root.dataset.keyboardOpen).toBe("true");
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    b.flush();
    expect(b.root.dataset.keyboardOpen).toBe("true");
    b.viewport.height = 390;
    b.resize();
    expect(b.root.dataset.keyboardOpen).toBe("false");
  });

  it("removes properties, pending frames and all event subscriptions on unmount", () => {
    const b = browser(true, true);
    mount();
    b.focus();
    b.viewport.dispatchEvent(new Event("resize"));
    expect(b.frames.size).toBe(1);
    unmount();
    expect(b.properties.size).toBe(0);
    expect(b.root.dataset.keyboardOpen).toBeUndefined();
    expect(b.root.dataset.viewportSource).toBeUndefined();
    expect(b.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const [target, events] of [
      [b.viewport, ["resize", "scroll"]], [b.win, ["resize", "pageshow", "orientationchange"]],
      [b.doc, ["focusin", "focusout"]], [b.orientation, ["change"]], [b.keyboard, ["geometrychange"]],
    ] as Array<[EventTarget, string[]]>) {
      events.forEach(event => target.dispatchEvent(new Event(event)));
    }
    expect(b.frames.size).toBe(0);
    b.flush();
    expect(b.properties.size).toBe(0);
  });
});
