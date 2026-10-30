import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useLayoutEffect: (effect: () => void | (() => void)) => runtime.effects.push(effect),
}));
import { useWorkspaceKeyboard } from "@/mobile/ui/use-workspace-keyboard";

function style(initial: Record<string, [string, string]> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getPropertyValue: (name: string) => values.get(name)?.[0] ?? "",
    getPropertyPriority: (name: string) => values.get(name)?.[1] ?? "",
    setProperty: (name: string, value: string, priority = "") => values.set(name, [value, priority]),
    removeProperty: (name: string) => values.delete(name),
  };
}

function browser(withKeyboard = true) {
  const body = { style: style({ top: ["12px", "important"], overflow: ["auto", ""], color: ["red", ""] }) };
  const root = { clientHeight: 800, style: style({ overflow: ["clip", "important"] }) };
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 800, offsetTop: 0, scale: 1 });
  const keyboard = Object.assign(new EventTarget(), {
    boundingRect: { x: 0, y: 0, width: 0, height: 0 }, overlaysContent: false,
  });
  const win = Object.assign(new EventTarget(), {
    innerWidth: 390, innerHeight: 800, visualViewport: viewport, scrollX: 7, scrollY: 160, scrollTo: vi.fn(),
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root, body,
    activeElement: null as null | { matches: (selector: string) => boolean; isContentEditable?: boolean },
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { virtualKeyboard: withKeyboard ? keyboard : undefined });
  function focus() {
    doc.activeElement = { matches: () => true };
    doc.dispatchEvent(new Event("focusin"));
  }
  function geometry(rect = { x: 0, y: 465, width: 390, height: 335 }) {
    Object.assign(keyboard.boundingRect, rect);
    keyboard.dispatchEvent(new Event("geometrychange"));
  }
  return { body, root, viewport, keyboard, win, doc, focus, geometry };
}

let unmount: () => void;
function mount(open = true) {
  // Run the lifecycle without installing an additional browser test runtime.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useWorkspaceKeyboard(open);
  const cleanup = runtime.effects.at(-1)?.();
  unmount = () => {
    unmount = () => {};
    if (typeof cleanup === "function") cleanup();
  };
}

describe("mobile workspace keyboard ownership", () => {
  beforeEach(() => { runtime.effects = []; unmount = () => {}; vi.useFakeTimers(); });
  afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("only opts in while open and restores exact styles, priorities and scroll on close", () => {
    const b = browser();
    const bodyBefore = [...b.body.style.values];
    const rootBefore = [...b.root.style.values];
    mount(false);
    expect(b.keyboard.overlaysContent).toBe(false);
    expect([...b.body.style.values]).toEqual(bodyBefore);
    unmount();
    mount();
    expect(b.keyboard.overlaysContent).toBe(true);
    expect(b.body.style.getPropertyValue("position")).toBe("fixed");
    expect(b.body.style.getPropertyValue("top")).toBe("-160px");
    expect(b.body.style.getPropertyValue("left")).toBe("-7px");
    expect(b.root.style.getPropertyValue("overflow")).toBe("hidden");
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(b.keyboard.overlaysContent).toBe(false);
    expect([...b.body.style.values]).toEqual(bodyBefore);
    expect([...b.root.style.values]).toEqual(rootBefore);
    expect(b.win.scrollTo).toHaveBeenCalledExactlyOnceWith(7, 160);
  });

  it("keeps scroll locking usable without the native keyboard API", () => {
    const b = browser(false);
    mount();
    b.focus();
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(b.body.style.getPropertyValue("position")).toBe("fixed");
    unmount();
    expect(b.body.style.getPropertyValue("position")).toBe("");
  });

  it("never opts in during an initially zoomed workspace visit", () => {
    const b = browser();
    b.viewport.scale = 1.5;
    mount();
    expect(b.keyboard.overlaysContent).toBe(false);
    b.viewport.scale = 1;
    b.viewport.dispatchEvent(new Event("resize"));
    b.focus();
    b.geometry();
    vi.advanceTimersByTime(1000);
    expect(b.keyboard.overlaysContent).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns ownership after zooming and latches the fallback until the next opening", () => {
    const b = browser();
    mount();
    b.focus();
    b.geometry();
    b.viewport.scale = 2;
    b.viewport.dispatchEvent(new Event("resize"));
    expect(b.keyboard.overlaysContent).toBe(false);
    b.viewport.scale = 1;
    b.viewport.dispatchEvent(new Event("resize"));
    b.focus();
    expect(b.keyboard.overlaysContent).toBe(false);
    unmount();
    mount();
    expect(b.keyboard.overlaysContent).toBe(true);
  });

  it("gives native geometry 900ms then restores browser resizing without repeated opt-ins", () => {
    const b = browser();
    mount();
    b.focus();
    vi.advanceTimersByTime(899);
    b.win.dispatchEvent(new Event("resize"));
    expect(b.keyboard.overlaysContent).toBe(true);
    vi.advanceTimersByTime(1);
    expect(b.keyboard.overlaysContent).toBe(false);
    b.geometry();
    b.focus();
    vi.advanceTimersByTime(1000);
    expect(b.keyboard.overlaysContent).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts delayed native geometry and does not mistake focused keyboard dismissal for failure", () => {
    const b = browser();
    mount();
    b.focus();
    vi.advanceTimersByTime(850);
    b.geometry();
    expect(vi.getTimerCount()).toBe(0);
    b.geometry({ x: 0, y: 0, width: 0, height: 0 });
    b.focus();
    vi.advanceTimersByTime(2000);
    expect(b.keyboard.overlaysContent).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks the final native rect even without a second geometry event", () => {
    const b = browser();
    mount();
    b.focus();
    Object.assign(b.keyboard.boundingRect, { x: 0, y: 465, width: 390, height: 335 });
    vi.advanceTimersByTime(900);
    expect(b.keyboard.overlaysContent).toBe(true);
    b.geometry({ x: 0, y: 0, width: 0, height: 0 });
    vi.advanceTimersByTime(1000);
    expect(b.keyboard.overlaysContent).toBe(true);
  });

  it("does not accept an invalid or floating rectangle as working docked geometry", () => {
    const b = browser();
    mount();
    b.focus();
    b.geometry({ x: 40, y: 400, width: 280, height: 250 });
    vi.advanceTimersByTime(900);
    expect(b.keyboard.overlaysContent).toBe(false);
  });

  it("cancels verification after blur and removes pending timers and listeners on close", () => {
    const b = browser();
    mount();
    b.focus();
    expect(vi.getTimerCount()).toBe(1);
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(b.keyboard.overlaysContent).toBe(true);
    b.focus();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const resize = vi.fn();
    b.win.addEventListener("resize", resize);
    b.viewport.scale = 2;
    b.viewport.dispatchEvent(new Event("resize"));
    b.focus();
    b.geometry();
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(resize).not.toHaveBeenCalled();
    expect(b.keyboard.overlaysContent).toBe(false);
  });

  it("restores an existing overlay policy instead of overwriting another owner's original value", () => {
    const b = browser();
    b.keyboard.overlaysContent = true;
    mount();
    unmount();
    expect(b.keyboard.overlaysContent).toBe(true);
  });
});
