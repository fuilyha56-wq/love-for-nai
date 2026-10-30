import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useLayoutEffect: (effect: () => void | (() => void)) => runtime.effects.push(effect),
}));
import { getWorkspaceViewport, useWorkspaceKeyboard } from "@/mobile/ui/use-workspace-keyboard";

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
  const root = { clientHeight: 800, style: style({ overflow: ["clip", "important"] }), dataset: {} as Record<string, string> };
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
  vi.stubGlobal("getComputedStyle", (node: typeof root) => node.style);
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

function phoneBrowser() {
  const b = browser(false);
  b.win.innerWidth = 406;
  b.viewport.width = 406.67;
  b.viewport.height = b.win.innerHeight = b.root.clientHeight = 864;
  b.root.style.setProperty("--lfn-viewport-height", "864px");
  return b;
}

function expectPhoneRest(b: ReturnType<typeof phoneBrowser>, height: number) {
  expect(getWorkspaceViewport()).toEqual({ height, width: 406 });
  expect(b.root.style.getPropertyValue("--lfn-workspace-rest-height")).toBe(`${height}px`);
  expect(b.body.style.getPropertyValue("height")).toBe(`${height}px`);
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
  afterEach(() => { unmount(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it("retains the pre-input height through the phone's 754→484.67→864 sequence and blur", () => {
    const b = browser(false);
    b.win.innerWidth = 406;
    b.viewport.width = 406.67;
    b.win.innerHeight = b.root.clientHeight = b.viewport.height = 754;
    b.root.style.setProperty("--lfn-viewport-height", "754px");
    mount();
    expect(getWorkspaceViewport()).toEqual({ height: 754, width: 406 });
    expect(b.root.dataset.workspaceViewport).toBe("true");
    expect(b.root.style.getPropertyValue("--lfn-workspace-rest-height")).toBe("754px");
    expect(b.body.style.getPropertyValue("height")).toBe("754px");
    expect(b.body.style.getPropertyValue("min-height")).toBe("0");

    b.focus();
    for (const height of [484.67, 864, 754, 484.67, 864]) {
      b.viewport.height = height;
      b.win.innerHeight = b.root.clientHeight = Math.floor(height);
      b.root.style.setProperty("--lfn-viewport-height", `${height}px`);
      b.win.dispatchEvent(new Event("resize"));
      b.viewport.dispatchEvent(new Event("resize"));
      expect(getWorkspaceViewport()).toEqual({ height: 754, width: 406 });
      expect(b.root.style.getPropertyValue("--lfn-workspace-rest-height")).toBe("754px");
      expect(b.body.style.getPropertyValue("height")).toBe("754px");
    }
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    expect(getWorkspaceViewport()).toEqual({ height: 754, width: 406 });
    expect(b.body.style.getPropertyValue("height")).toBe("754px");

    unmount();
    expect(getWorkspaceViewport()).toBeFalsy();
    expect(b.root.dataset.workspaceViewport).toBeUndefined();
    expect(b.root.style.getPropertyValue("--lfn-workspace-rest-height")).toBe("");
    b.root.style.setProperty("--lfn-viewport-height", "710px");
    b.viewport.height = b.win.innerHeight = b.root.clientHeight = 710;
    mount();
    expect(getWorkspaceViewport()).toEqual({ height: 710, width: 406 });
    expect(b.body.style.getPropertyValue("height")).toBe("710px");
  });

  it.each(["window", "visual"] as const)("corrects an early 864px snapshot to 754px on %s resize before editing, then freezes it", source => {
    const b = phoneBrowser();
    mount();
    expectPhoneRest(b, 864);
    b.viewport.height = b.win.innerHeight = b.root.clientHeight = 754;
    // The applied viewport variable may still contain the previous frame.
    (source === "window" ? b.win : b.viewport).dispatchEvent(new Event("resize"));
    expectPhoneRest(b, 754);
    expect(vi.getTimerCount()).toBe(0);

    // Browser controls hiding must not increase the calibrated ceiling.
    b.viewport.height = 864;
    b.viewport.dispatchEvent(new Event("resize"));
    expectPhoneRest(b, 754);
    b.focus();
    b.root.dataset.keyboardOpen = "true";
    for (const height of [374.67, 484.67]) {
      b.viewport.height = b.win.innerHeight = b.root.clientHeight = height;
      b.win.dispatchEvent(new Event("resize"));
      b.viewport.dispatchEvent(new Event("resize"));
      expectPhoneRest(b, 754);
    }
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    b.root.dataset.keyboardOpen = "false";
    for (const height of [864, 700, 754]) {
      b.viewport.height = b.win.innerHeight = b.root.clientHeight = height;
      b.win.dispatchEvent(new Event("resize"));
      b.viewport.dispatchEvent(new Event("resize"));
      expectPhoneRest(b, 754);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes one final small toolbar correction on the first text focus when its resize has not fired", () => {
    const b = phoneBrowser();
    mount();
    b.viewport.height = 754;
    b.focus();
    expectPhoneRest(b, 754);
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    b.viewport.height = 700;
    b.focus();
    expectPhoneRest(b, 754);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["focus", "keyboard", "large shrink", "pan", "zoom", "width", "zero", "invalid"] as const)("does not learn a smaller rest height during %s", mode => {
    const b = phoneBrowser();
    mount();
    if (mode === "focus") b.focus();
    b.viewport.height = 754;
    if (mode === "keyboard") b.root.dataset.keyboardOpen = "true";
    if (mode === "large shrink") b.viewport.height = 484.67;
    if (mode === "pan") b.viewport.offsetTop = 3;
    if (mode === "zoom") b.viewport.scale = 1.2;
    if (mode === "width") b.win.innerWidth = b.viewport.width = 600;
    if (mode === "zero") b.viewport.height = 0;
    if (mode === "invalid") b.viewport.height = Number.NaN;
    b.viewport.dispatchEvent(new Event("resize"));
    b.win.dispatchEvent(new Event("resize"));
    if (mode === "width") {
      expect(getWorkspaceViewport()).toBeUndefined();
      b.win.innerWidth = 406;
      b.viewport.width = 406.67;
      b.viewport.height = 864;
      b.win.dispatchEvent(new Event("resize"));
    }
    expectPhoneRest(b, 864);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["keyboard", "large shrink", "pan", "zoom", "width"] as const)("keeps the first-focus correction guarded during %s", mode => {
    const b = phoneBrowser();
    mount();
    b.viewport.height = mode === "large shrink" ? 484.67 : 754;
    if (mode === "keyboard") b.root.dataset.keyboardOpen = "true";
    if (mode === "pan") b.viewport.offsetTop = 3;
    if (mode === "zoom") b.viewport.scale = 1.2;
    if (mode === "width") b.win.innerWidth = 600;
    b.focus();
    b.win.innerWidth = 406;
    expectPhoneRest(b, 864);
  });

  it("rejects a shrink exactly at the keyboard threshold", () => {
    const b = browser(false);
    mount();
    b.viewport.height = 680;
    b.viewport.dispatchEvent(new Event("resize"));
    expect(getWorkspaceViewport()).toEqual({ height: 800, width: 390 });
    expect(b.body.style.getPropertyValue("height")).toBe("800px");
  });

  it("locks the initial editor focus for the whole visit, even after blur", () => {
    const b = phoneBrowser();
    b.focus();
    mount();
    b.doc.activeElement = null;
    b.doc.dispatchEvent(new Event("focusout"));
    b.viewport.height = 754;
    b.viewport.dispatchEvent(new Event("resize"));
    b.win.dispatchEvent(new Event("resize"));
    expectPhoneRest(b, 864);
  });

  it("allows toolbar calibration after a non-editable control received focus", () => {
    const b = phoneBrowser();
    mount();
    b.doc.activeElement = { matches: () => false };
    b.doc.dispatchEvent(new Event("focusin"));
    b.viewport.height = 754;
    b.viewport.dispatchEvent(new Event("resize"));
    expectPhoneRest(b, 754);
  });

  it("removes every viewport listener and the calibrated baseline on close", () => {
    const b = phoneBrowser();
    const added = vi.spyOn(b.viewport, "addEventListener");
    const removed = vi.spyOn(b.viewport, "removeEventListener");
    const bodyBefore = [...b.body.style.values];
    const rootBefore = [...b.root.style.values];
    mount();
    b.viewport.height = 754;
    b.viewport.dispatchEvent(new Event("resize"));
    expectPhoneRest(b, 754);
    unmount();
    for (const [event, listener] of added.mock.calls) {
      expect(removed).toHaveBeenCalledWith(event, listener);
    }
    expect(getWorkspaceViewport()).toBeUndefined();
    b.viewport.height = 700;
    b.viewport.dispatchEvent(new Event("resize"));
    b.win.dispatchEvent(new Event("resize"));
    b.focus();
    expect([...b.body.style.values]).toEqual(bodyBefore);
    expect([...b.root.style.values]).toEqual(rootBefore);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["754px", 864, 754],
    ["864px", 754, 754],
    ["0px", 754, 754],
    ["-20px", 754, 754],
    ["", 754, 754],
    ["invalid", 754, 754],
  ])("selects the smallest valid pre-input measurement from CSS %s and visual height %s", (cssHeight, visualHeight, expected) => {
    const b = browser(false);
    b.root.style.setProperty("--lfn-viewport-height", cssHeight);
    b.viewport.height = visualHeight;
    mount();
    expect(getWorkspaceViewport()).toEqual({ height: expected, width: 390 });
    expect(b.body.style.getPropertyValue("height")).toBe(`${expected}px`);
  });

  it.each(["zoom", "keyboard"] as const)("does not save a reduced height when a workspace opens during %s", mode => {
    const b = browser(false);
    b.root.style.setProperty("--lfn-viewport-height", "374px");
    b.viewport.height = b.win.innerHeight = b.root.clientHeight = 374;
    if (mode === "zoom") b.viewport.scale = 2;
    else b.root.dataset.keyboardOpen = "true";
    mount();
    expect(getWorkspaceViewport()).toBeFalsy();

    b.viewport.scale = 1;
    b.root.dataset.keyboardOpen = "false";
    b.viewport.height = b.win.innerHeight = b.root.clientHeight = 754;
    b.root.style.setProperty("--lfn-viewport-height", "754px");
    b.viewport.dispatchEvent(new Event("resize"));
    expect(getWorkspaceViewport()).toBeFalsy();
    unmount();
    mount();
    expect(getWorkspaceViewport()).toEqual({ height: 754, width: 390 });
  });

  it("does not apply the portrait limit to landscape and reuses it on returning to its original width", () => {
    const b = browser(false);
    b.root.style.setProperty("--lfn-viewport-height", "754px");
    b.viewport.height = b.win.innerHeight = b.root.clientHeight = 754;
    mount();
    b.win.innerWidth = b.viewport.width = 844;
    b.viewport.height = b.win.innerHeight = b.root.clientHeight = 390;
    b.root.style.setProperty("--lfn-viewport-height", "390px");
    b.win.dispatchEvent(new Event("resize"));
    expect(getWorkspaceViewport()).toBeFalsy();
    expect(b.body.style.getPropertyValue("height")).toBe("390px");
    expect(b.root.style.getPropertyValue("--lfn-workspace-rest-height")).toBe("390px");

    b.win.innerWidth = b.viewport.width = 390;
    b.viewport.height = b.win.innerHeight = b.root.clientHeight = 864;
    b.root.style.setProperty("--lfn-viewport-height", "864px");
    b.win.dispatchEvent(new Event("resize"));
    expect(getWorkspaceViewport()).toEqual({ height: 754, width: 390 });
    expect(b.body.style.getPropertyValue("height")).toBe("754px");
    expect(b.root.style.getPropertyValue("--lfn-workspace-rest-height")).toBe("754px");
  });

  it("restores previous workspace metadata, fixed dimensions and their priorities exactly", () => {
    const b = browser(false);
    b.body.style.setProperty("height", "90%", "important");
    b.body.style.setProperty("min-height", "27px", "important");
    b.root.style.setProperty("--lfn-workspace-rest-height", "620px", "important");
    b.root.dataset.workspaceViewport = "previous-owner";
    b.root.dataset.keyboardOpen = "false";
    const bodyBefore = [...b.body.style.values];
    const rootBefore = [...b.root.style.values];
    const dataBefore = { ...b.root.dataset };
    mount();
    expect(b.root.dataset.workspaceViewport).toBe("true");
    expect(b.body.style.getPropertyValue("min-height")).toBe("0");
    b.viewport.height = 754;
    b.viewport.dispatchEvent(new Event("resize"));
    expect(b.body.style.getPropertyValue("height")).toBe("754px");
    unmount();
    expect([...b.body.style.values]).toEqual(bodyBefore);
    expect([...b.root.style.values]).toEqual(rootBefore);
    expect(b.root.dataset).toEqual(dataBefore);
    expect(getWorkspaceViewport()).toBeFalsy();
    b.win.innerWidth = 900;
    b.win.dispatchEvent(new Event("resize"));
    expect([...b.body.style.values]).toEqual(bodyBefore);
    expect([...b.root.style.values]).toEqual(rootBefore);
  });
});
