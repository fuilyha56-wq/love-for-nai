import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  runtimeAdminToken: vi.fn(),
  runtimeNewApiBaseUrl: vi.fn(),
  getRuntimeSettings: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      return { query: poolMocks.query };
    }
  },
}));

vi.mock("@/lib/runtime-config", () => ({
  runtimeAdminToken: runtimeMocks.runtimeAdminToken,
  runtimeNewApiBaseUrl: runtimeMocks.runtimeNewApiBaseUrl,
  getRuntimeSettings: runtimeMocks.getRuntimeSettings,
}));

const { normalizeNewApiKey, resolveExternalApiUser } = await import(
  "@/lib/newapi-db"
);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("NewAPI key 归一化", () => {
  it("与 NewAPI TokenAuth 同规则：去 Bearer、去 sk-、保留完整 key", () => {
    expect(normalizeNewApiKey("Bearer sk-abc123")).toBe("abc123");
    expect(normalizeNewApiKey("Bearer abc123-extra")).toBe("abc123-extra");
    expect(normalizeNewApiKey("sk-abc123")).toBe("abc123");
    expect(normalizeNewApiKey("abc123")).toBe("abc123");
  });

  it("保留完整 key 内容，避免含连字符的 key 发生归属碰撞", () => {
    expect(normalizeNewApiKey("Bearer sk-abc-123-extra")).toBe("abc-123-extra");
  });
});

describe("resolveExternalApiUser", () => {
  beforeEach(() => {
    poolMocks.query.mockReset();
    runtimeMocks.runtimeAdminToken.mockReset();
    runtimeMocks.runtimeNewApiBaseUrl.mockReset();
    runtimeMocks.getRuntimeSettings.mockReset();
    delete process.env.NEWAPI_DB_URL;
    delete process.env.LFN_ADMIN_USER_ID;
    (
      globalThis as typeof globalThis & { __lfnApiKeyUserCache?: Map<string, unknown> }
    ).__lfnApiKeyUserCache = undefined;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    delete process.env.NEWAPI_DB_URL;
    delete process.env.LFN_ADMIN_USER_ID;
    vi.unstubAllGlobals();
  });

  it("数据库直连时走 SQL，有效 token 返回 user_id 并带缓存", async () => {
    process.env.NEWAPI_DB_URL = "postgresql://test";
    // pg 驱动把 bigint 序列化成字符串，模拟真实返回形态。
    poolMocks.query.mockResolvedValue({ rows: [{ user_id: "41" }] });

    await expect(resolveExternalApiUser("Bearer sk-abc")).resolves.toBe(41);
    await expect(resolveExternalApiUser("Bearer sk-abc")).resolves.toBe(41);
    expect(poolMocks.query).toHaveBeenCalledTimes(1);
  });

  it("数据库直连时停用/过期/软删除 token 返回 null", async () => {
    process.env.NEWAPI_DB_URL = "postgresql://test";
    poolMocks.query.mockResolvedValue({ rows: [] });
    await expect(resolveExternalApiUser("Bearer sk-gone")).resolves.toBeNull();
  });

  it("数据库故障抛错（fail closed，不静默跳过图包扣费）", async () => {
    process.env.NEWAPI_DB_URL = "postgresql://test";
    poolMocks.query.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(resolveExternalApiUser("Bearer sk-abc")).rejects.toThrow(
      "暂时无法连接账号服务",
    );
  });

  it("数据库未配置时走管理 API HTTP 兜底识别", async () => {
    runtimeMocks.runtimeAdminToken.mockReturnValue("admin-token");
    runtimeMocks.runtimeNewApiBaseUrl.mockReturnValue("http://newapi.test");
    runtimeMocks.getRuntimeSettings.mockResolvedValue({ newApiAdminUserId: "3" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [{ user_id: 41, key: "x", status: 1, expired_time: -1, allow_ips: "" }] },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveExternalApiUser("Bearer sk-x")).resolves.toBe(41);
    expect(poolMocks.query).not.toHaveBeenCalled();
    // 一次 token 搜索 + 一次用户状态核验
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/token/?p=1&size=10&keyword=x",
    );
  });

  it("HTTP 兜底无匹配 token 时返回 null（透传给 NewAPI）", async () => {
    runtimeMocks.runtimeAdminToken.mockReturnValue("admin-token");
    runtimeMocks.runtimeNewApiBaseUrl.mockReturnValue("http://newapi.test");
    runtimeMocks.getRuntimeSettings.mockResolvedValue({ newApiAdminUserId: "3" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { items: [] } })));

    await expect(resolveExternalApiUser("Bearer sk-none")).resolves.toBeNull();
  });

  it("HTTP 兜底命中但用户已停用时返回 null", async () => {
    runtimeMocks.runtimeAdminToken.mockReturnValue("admin-token");
    runtimeMocks.runtimeNewApiBaseUrl.mockReturnValue("http://newapi.test");
    runtimeMocks.getRuntimeSettings.mockResolvedValue({ newApiAdminUserId: "3" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [{ user_id: 41, key: "x", status: 1, expired_time: -1, allow_ips: "" }] },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: 2 } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveExternalApiUser("Bearer sk-banned")).resolves.toBeNull();
  });

  it("HTTP 兜底缺管理令牌时直接返回 null，不发起请求", async () => {
    runtimeMocks.runtimeAdminToken.mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveExternalApiUser("Bearer sk-x")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
