import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE_LAUNCHER_KEY, GUIDE_OPEN_EVENT, GUIDE_VISIBILITY_EVENT, guideLauncherVisible, openOnboardingGuide, setGuideLauncherVisible, subscribeGuideVisibility } from "@/lib/guide-preferences";

afterEach(() => vi.unstubAllGlobals());

function browserStorage() {
  const values = new Map<string, string>();
  const events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
  });
  return { values, events };
}

describe("指南入口隐藏与恢复", () => {
  it("服务端及初次访问显示入口", () => {
    expect(guideLauncherVisible()).toBe(true);
    browserStorage();
    expect(guideLauncherVisible()).toBe(true);
  });
  it("隐藏状态持久保存并立即通知当前页面，恢复时也通知", () => {
    const { values } = browserStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeGuideVisibility(listener);
    expect(setGuideLauncherVisible(false)).toBe(true);
    expect(values.get(GUIDE_LAUNCHER_KEY)).toBe("false");
    expect(guideLauncherVisible()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    setGuideLauncherVisible(true);
    expect(guideLauncherVisible()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new Event(GUIDE_VISIBILITY_EVENT));
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("其他标签页改变本地偏好会通知，隐藏时仍可重新打开教程", () => {
    const { events, values } = browserStorage();
    const listener = vi.fn();
    const open = vi.fn();
    const unsubscribe = subscribeGuideVisibility(listener);
    events.addEventListener(GUIDE_OPEN_EVENT, open);
    values.set(GUIDE_LAUNCHER_KEY, "false");
    events.dispatchEvent(new Event("storage"));
    expect(listener).toHaveBeenCalledOnce();
    expect(guideLauncherVisible()).toBe(false);
    openOnboardingGuide();
    expect(open).toHaveBeenCalledOnce();
    unsubscribe();
  });
  it("本地存储不可用时保留默认入口并报告写入失败", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    expect(guideLauncherVisible()).toBe(true);
    expect(setGuideLauncherVisible(false)).toBe(false);
  });
});
