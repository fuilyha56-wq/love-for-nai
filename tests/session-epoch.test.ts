import { beforeEach, describe, expect, it, vi } from "vitest";

// 会话纪元与保持登录：epoch 嵌入登录 cookie、旧纪元立即失效
// （部署/管理员清理即等效清空全部站内登录状态）、remember 延长会话时长。
// 文件型运行时设置在测试里用 LFN_SESSION_EPOCH 环境变量替代。

let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      (name === "lfn_session" || name === "lfn_2fa") && cookieValue
        ? { value: cookieValue, name }
        : undefined,
  })),
}));

async function importFresh(epoch: string) {
  vi.resetModules();
  process.env.LFN_SESSION_EPOCH = epoch;
  return await import("@/lib/session");
}

const baseSession = () => ({
  userId: 1,
  username: "u",
  displayName: "u",
  upstreamCookie: "",
  expiresAt: Date.now() + 60_000,
});

beforeEach(() => {
  process.env.LFN_SESSION_EPOCH = "1";
  cookieValue = undefined;
});

describe("会话纪元", () => {
  it("encodeSession 嵌入当前纪元", async () => {
    const session = await importFresh("3");
    const encoded = await session.encodeSession(baseSession());
    expect(session.decodeSession(encoded)?.epoch).toBe(3);
  });

  it("同纪元会话通过 getSession 校验", async () => {
    const session = await importFresh("1");
    cookieValue = await session.encodeSession(baseSession());
    expect((await session.getSession())?.userId).toBe(1);
  });

  it("旧纪元 cookie 立即失效（部署/清理即清空全部登录状态）", async () => {
    const previous = await importFresh("1");
    cookieValue = await previous.encodeSession(baseSession());
    const next = await importFresh("2");
    expect(await next.getSession()).toBeNull();
  });

  it("2FA 待定会话同样校验纪元并携带 remember 标记", async () => {
    const previous = await importFresh("1");
    cookieValue = await previous.encodePendingSession({
      flowToken: "flow",
      expiresAt: Date.now() + 60_000,
      remember: true,
    });
    const same = await importFresh("1");
    expect((await same.getPendingSession())?.remember).toBe(true);
    const next = await importFresh("2");
    expect(await next.getPendingSession()).toBeNull();
  });
});

describe("保持登录", () => {
  it("remember 勾选后会话 cookie 延长到 30 天，未勾选仍为 7 天", async () => {
    const session = await importFresh("1");
    expect((await session.resolvedSessionCookie(true)).options.maxAge).toBe(
      2_592_000,
    );
    expect((await session.resolvedSessionCookie(false)).options.maxAge).toBe(
      604_800,
    );
  });

  it("keepLoginTtlMs 与 cookie maxAge 对应", async () => {
    const session = await importFresh("1");
    expect(session.keepLoginTtlMs(true)).toBe(2_592_000_000);
    expect(session.keepLoginTtlMs(false)).toBe(604_800_000);
  });
});
