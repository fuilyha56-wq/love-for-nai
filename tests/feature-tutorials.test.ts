import { afterEach, describe, expect, it, vi } from "vitest";
import { TUTORIAL_RETURN_URL } from "@/lib/feature-tutorials";
import { FEATURE_TUTORIAL_EVENT, FEATURE_TUTORIAL_SESSION_KEY, finishFeatureTutorial, parseTutorialSession, readTutorialProgress, readTutorialResult, readTutorialSession, startFeatureTutorial, writeTutorialSession } from "@/lib/feature-tutorial-session";

function browser() {
  const session = new Map<string, string>();
  const local = new Map<string, string>();
  const storage = (items: Map<string, string>) => ({ getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) });
  const events = new EventTarget();
  vi.stubGlobal("window", { sessionStorage: storage(session), localStorage: storage(local), dispatchEvent: events.dispatchEvent.bind(events) });
  writeTutorialSession(null);
  return { session, local, events };
}

afterEach(() => { writeTutorialSession(null); vi.unstubAllGlobals(); });

describe("功能教程会话与返回", () => {
  it("拒绝损坏、未知和越界的恢复数据", () => {
    browser();
    for (const value of ["bad-json", "null", "[]", '{"tutorialId":"unknown","stepIndex":0}', '{"tutorialId":"inpaint","stepIndex":-1}', '{"tutorialId":"inpaint","stepIndex":999}', '{"tutorialId":"inpaint","stepIndex":0.5}']) expect(parseTutorialSession(value)).toBeNull();
    expect(parseTutorialSession('{"tutorialId":"inpaint","stepIndex":2}')).toEqual({ tutorialId: "inpaint", stepIndex: 2 });
  });

  it("在当前标签页保存步骤并通知跨页面的引导器", () => {
    const { session, events } = browser();
    const listener = vi.fn();
    events.addEventListener(FEATURE_TUTORIAL_EVENT, listener);
    startFeatureTutorial("text-to-image");
    expect(readTutorialSession()).toEqual({ tutorialId: "text-to-image", stepIndex: 0 });
    writeTutorialSession({ tutorialId: "text-to-image", stepIndex: 3 });
    expect(parseTutorialSession(session.get(FEATURE_TUTORIAL_SESSION_KEY)!)).toEqual({ tutorialId: "text-to-image", stepIndex: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
    startFeatureTutorial("unknown");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("完成会记录已学习状态，退出只记录返回结果，两者都清理会话", () => {
    browser();
    startFeatureTutorial("inpaint");
    finishFeatureTutorial(readTutorialSession()!, false);
    expect(readTutorialSession()).toBeNull();
    expect(readTutorialResult()).toEqual({ tutorialId: "inpaint", completed: false });
    expect(readTutorialProgress()).toEqual({});
    startFeatureTutorial("inpaint");
    finishFeatureTutorial(readTutorialSession()!, true);
    expect(readTutorialSession()).toBeNull();
    expect(readTutorialResult()).toEqual({ tutorialId: "inpaint", completed: true });
    expect(readTutorialProgress().inpaint).toBe(true);
    expect(TUTORIAL_RETURN_URL).toBe("/profile#profile-tutorials");
  });

  it("浏览器存储不可用时仍可开始、切换和退出教程", () => {
    browser();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    vi.stubGlobal("window", { sessionStorage: blocked, localStorage: blocked, dispatchEvent: vi.fn() });
    startFeatureTutorial("upscale");
    expect(readTutorialSession()?.tutorialId).toBe("upscale");
    finishFeatureTutorial(readTutorialSession()!, false);
    expect(readTutorialSession()).toBeNull();
  });
});
