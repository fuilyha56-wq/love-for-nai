import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/runtime-config", () => ({
  runtimeNewApiBaseUrl: async () => "http://assistant-key.test",
}));
const { getChatToken, getStoryToken, refreshChatToken } =
  await import("@/lib/newapi");
type Token = {
  id: number;
  name: string;
  status: number;
  group: string;
  [key: string]: unknown;
};
let userId = 80_000;
const session = () => ({
  userId: ++userId,
  username: "tester",
  displayName: "tester",
  upstreamCookie: "",
  expiresAt: Date.now() + 3600_000,
});
let tokens: Token[];
let groups: string[];
let modelGroups: string[];
type MockFetch = (url: string, init?: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<MockFetch>>;
let creates: number;
const model = "gemini-3.8-flash";
const token = (id = 166, extra: Partial<Token> = {}): Token => ({
  id,
  name: "user-created-key",
  status: 1,
  group: "vip",
  expired_time: -1,
  unlimited_quota: true,
  ...extra,
});

beforeEach(() => {
  tokens = [token()];
  groups = ["vip", "gemini"];
  modelGroups = ["gemini", "vip"];
  creates = 0;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/user/self"))
      return Response.json({ success: true, data: { group: "vip" } });
    if (url.endsWith("/api/user/self/groups"))
      return Response.json({ success: true, data: groups });
    if (url.endsWith("/api/pricing"))
      return Response.json({
        data: [model, "other-chat"].map((model_name) => ({
          model_name,
          enable_groups: modelGroups,
        })),
      });
    if (/\/api\/token\/\d+\/key$/.test(url)) {
      const id = Number(url.match(/token\/(\d+)/)?.[1]);
      return Response.json({ success: true, data: { key: `existing-${id}` } });
    }
    if (url.endsWith("/api/token/") && init?.method === "POST") {
      creates++;
      const body = JSON.parse(init.body as string);
      tokens.push(token(900, body));
      return Response.json({ success: true });
    }
    if (url.includes("/api/token/?")) {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("page_size")).toBe("100");
      const page = Number(parsed.searchParams.get("p"));
      return Response.json({
        success: true,
        data: {
          items: tokens.slice((page - 1) * 100, page * 100),
          total: tokens.length,
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("assistant keys reuse before creation", () => {
  it("keeps explicitly selected groups separate from automatic caches and reuses only that group's key", async () => {
    tokens = [token(166), token(167, { group: "gemini" })];
    const user = session();
    expect(await getChatToken(user, model)).toBe("existing-166");
    expect(await getChatToken(user, model, "gemini")).toBe("existing-167");
    expect(await getChatToken(user, model, "vip")).toBe("existing-166");
    expect(creates).toBe(0);
    await expect(getChatToken(user, model, "private")).rejects.toThrow("所选分组");
    expect(creates).toBe(0);
  });
  it("creates one key only in a selected authorized group when that group has no valid key", async () => {
    const user = session();
    expect(await getChatToken(user, model, "gemini")).toBe("existing-900");
    expect(creates).toBe(1);
    expect(tokens.at(-1)?.group).toBe("gemini");
    expect(await refreshChatToken(user, model, "existing-900", "gemini")).toBe("existing-900");
    expect(creates).toBe(1);
  });
  it("reuses a user-named key from any owned compatible group, not only the first group", async () => {
    expect(await getChatToken(session(), model)).toBe("existing-166");
    expect(creates).toBe(0);
  });

  it("reuses an explicitly model-limited compatible key", async () => {
    tokens = [
      token(166, {
        model_limits_enabled: true,
        model_limits: `other-chat, ${model}`,
      }),
    ];
    expect(await getChatToken(session(), model)).toBe("existing-166");
    expect(creates).toBe(0);
  });

  it("finds a usable key after the first 100 keys without creating another", async () => {
    tokens = Array.from({ length: 101 }, (_, index) =>
      token(index + 1, { status: index === 100 ? 1 : 2 }),
    );
    expect(await getChatToken(session(), model)).toBe("existing-101");
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("/api/token/?")),
    ).toHaveLength(2);
    expect(creates).toBe(0);
  });

  it.each([
    { status: 2 },
    { expired_time: 1 },
    { unlimited_quota: false, remain_quota: 0 },
    { model_limits_enabled: true, model_limits: "other-chat" },
    { allow_ips: "192.0.2.1" },
    { deleted_at: "2026-10-26" },
    { group: "unowned" },
  ])("does not reuse an unusable or unauthorized key %j", async (extra) => {
    tokens = [token(1, extra), token(2)];
    expect(await getChatToken(session(), model)).toBe("existing-2");
    expect(creates).toBe(0);
  });

  it("creates only one key for concurrent models and story calls in the same group", async () => {
    tokens = [];
    const user = session();
    expect(
      await Promise.all([
        getChatToken(user, model),
        getChatToken(user, "other-chat"),
        getStoryToken(user, model),
      ]),
    ).toEqual(["existing-900", "existing-900", "existing-900"]);
    expect(creates).toBe(1);
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url.endsWith("/api/token/") && init?.method === "POST",
    );
    expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
      group: "gemini",
      unlimited_quota: true,
    });
  });

  it("shares the creation lock even across independently imported route modules", async () => {
    tokens = [];
    const user = session();
    vi.resetModules();
    const second = await import("@/lib/newapi");
    await Promise.all([
      getChatToken(user, model),
      second.getChatToken(user, "other-chat"),
    ]);
    expect(creates).toBe(1);
  });

  it("does not create if enumeration fails or pagination cannot finish", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) =>
      url.includes("/api/token/?")
        ? Response.json(
            { success: false, message: "list denied" },
            { status: 403 },
          )
        : original(url, init),
    );
    await expect(getChatToken(session(), model)).rejects.toThrow("list denied");
    expect(creates).toBe(0);
    fetchMock.mockImplementation(async (url, init) =>
      url.includes("/api/token/?")
        ? Response.json({ success: true, data: { total: 2, items: [token()] } })
        : original(url, init),
    );
    await expect(getChatToken(session(), model)).rejects.toThrow("分页异常");
    expect(creates).toBe(0);
  });

  it("refreshes a deleted cached key using another existing key and invalidates related model caches", async () => {
    const user = session();
    expect(await getChatToken(user, model)).toBe("existing-166");
    expect(await getChatToken(user, "other-chat")).toBe("existing-166");
    tokens = [token(200)];
    expect(await refreshChatToken(user, model, "existing-166")).toBe(
      "existing-200",
    );
    expect(await getChatToken(user, "other-chat")).toBe("existing-200");
    expect(creates).toBe(0);
  });

  it("never replaces or duplicates an existing key when its full-key read fails", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) =>
      url.endsWith("/key")
        ? Response.json({ success: true, data: { key: "sk-abc****xyz" } })
        : original(url, init),
    );
    await expect(getChatToken(session(), model)).rejects.toThrow("完整密钥");
    expect(creates).toBe(0);
  });
});
