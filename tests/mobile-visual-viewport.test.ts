import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => runtime.effects.push(effect),
}));
import { useVisualViewport } from "@/mobile/ui/use-visual-viewport";

function browser(withViewport = true, withKeyboard = false) {
  const properties = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    dataset: {} as Record<string, string>,
  };
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 800, offsetLeft: 0, offsetTop: 0, scale: 1 });
  const keyboard = Object.assign(new EventTarget(), { boundingRect: { height: 0 }, overlaysContent: false });
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
  beforeEach(() => { runtime.effects = []; unmount = () => {}; });
  afterEach(() => { unmount(); vi.unstubAllGlobals(); });

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
    b.win.innerHeight = 440;
    b.resize();
    expect(b.properties.get("--lfn-viewport-height")).toBe("440px");
    expect(b.properties.get("--lfn-viewport-top")).toBe("0px");
    expect(b.properties.get("--lfn-keyboard-height")).toBe("360px");
    b.win.innerHeight = 800;
    b.resize();
    expect(b.properties.get("--lfn-keyboard-height")).toBe("0px");
    expect(b.root.dataset.keyboardOpen).toBe("false");
  });

  it("prefers reported keyboard geometry but handles an empty API rectangle without enabling overlays", () => {
    const b = browser(true, true);
    mount();
    b.focus();
    b.win.innerHeight = b.viewport.height = 440;
    b.resize();
    expect(b.properties.get("--lfn-keyboard-height")).toBe("360px");
    b.keyboard.boundingRect.height = 220.5;
    b.keyboard.dispatchEvent(new Event("geometrychange"));
    b.flush();
    expect(b.properties.get("--lfn-keyboard-height")).toBe("220.5px");
    expect(b.properties.get("--lfn-viewport-height")).toBe("440px");
    expect(b.keyboard.overlaysContent).toBe(false);
    b.keyboard.boundingRect.height = 0;
    b.win.innerHeight = b.viewport.height = 800;
    b.keyboard.dispatchEvent(new Event("geometrychange"));
    b.flush();
    expect(b.root.dataset.keyboardOpen).toBe("false");
  });

  it("resets stale baselines after rotation and clears the signal after blur", () => {
    const b = browser();
    mount();
    b.focus();
    b.win.innerWidth = b.viewport.width = 800;
    b.win.innerHeight = b.viewport.height = 390;
    b.orientation.dispatchEvent(new Event("change"));
    b.flush();
    expect(b.root.dataset.keyboardOpen).toBe("false");
    b.viewport.height = 200;
    b.resize();
    expect(b.root.dataset.keyboardOpen).toBe("true");
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    b.flush();
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
    expect(b.frames.size).toBe(0);
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
