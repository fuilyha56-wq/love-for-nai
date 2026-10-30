import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => runtime.effects.push(effect),
}));
import { useVisualViewport } from "@/mobile/ui/use-visual-viewport";

function browser(withViewport = true, withKeyboard = false) {
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
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    activeElement: null as null | { matches: (selector: string) => boolean; isContentEditable?: boolean },
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
    doc.activeElement = { matches: () => true };
    doc.dispatchEvent(new Event("focusin"));
    flush();
  }
  function resize() {
    (withViewport ? viewport : win).dispatchEvent(new Event("resize"));
    flush();
  }
  return { properties, root, viewport, keyboard, orientation, win, doc, frames, request, flush, focus, resize };
}

let unmount: () => void;
function mount() {
  // Supply the effect dispatcher without installing a browser/DOM test runtime.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useVisualViewport();
  const cleanup = runtime.effects[0]();
  unmount = typeof cleanup === "function" ? cleanup : () => {};
}

describe("mobile visual viewport", () => {
  beforeEach(() => { runtime.effects = []; unmount = () => {}; vi.useFakeTimers(); });
  afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("follows a visual-only keyboard resize and pan without subtracting the keyboard twice", () => {
    const b = browser();
    mount();
    b.focus();
    b.request.mockClear();
    Object.assign(b.viewport, { height: 370.5, width: 360.5, offsetTop: 45.25, offsetLeft: 4.5 });
    b.viewport.dispatchEvent(new Event("resize"));
    b.viewport.dispatchEvent(new Event("scroll"));
    b.win.dispatchEvent(new Event("resize"));
    expect(b.request).toHaveBeenCalledTimes(1);
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

  it("accepts content resize only when both viewports agree, and never expands visual-only occlusion", () => {
    const b = browser();
    mount();
    b.focus();
    b.win.innerHeight = b.root.clientHeight = 465;
    Object.assign(b.viewport, { height: 465, offsetTop: 0 });
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("465px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("335px");
    expect(b.root.dataset.viewportSource).toBe("layout");
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
