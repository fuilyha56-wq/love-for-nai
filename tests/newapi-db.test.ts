import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      return { query: poolMocks.query };
    }
  },
}));

const { normalizeNewApiKey, resolveExternalApiUser } = await import(
  "@/lib/newapi-db"
);

describe("NewAPI key 归一化", () => {
  it("与 NewAPI TokenAuth 同规则：去 Bearer、去 sk-、取首个 - 之前", () => {
    expect(normalizeNewApiKey("Bearer sk-abc123")).toBe("abc123");
    expect(normalizeNewApiKey("Bearer abc123-extra")).toBe("abc123");
    expect(normalizeNewApiKey("sk-abc123")).toBe("abc123");
    expect(normalizeNewApiKey("abc123")).toBe("abc123");
  });
});

describe("resolveExternalApiUser", () => {
  beforeEach(() => {
    poolMocks.query.mockReset();
    delete process.env.NEWAPI_DB_URL;
    (
      globalThis as typeof globalThis & { __lfnApiKeyUserCache?: Map<string, unknown> }
    ).__lfnApiKeyUserCache = undefined;
  });

  afterEach(() => {
    delete process.env.NEWAPI_DB_URL;
  });

  it("未配置 NEWAPI_DB_URL 时不查库，直接返回 null", async () => {
    await expect(resolveExternalApiUser("Bearer sk-x")).resolves.toBeNull();
    expect(poolMocks.query).not.toHaveBeenCalled();
  });

  it("有效 token 返回 user_id，且带缓存（同 key 只查一次）", async () => {
    process.env.NEWAPI_DB_URL = "postgresql://test";
    poolMocks.query.mockResolvedValue({ rows: [{ user_id: 41 }] });

    await expect(resolveExternalApiUser("Bearer sk-abc")).resolves.toBe(41);
    await expect(resolveExternalApiUser("Bearer sk-abc")).resolves.toBe(41);
    expect(poolMocks.query).toHaveBeenCalledTimes(1);
  });

  it("停用/过期/软删除 token 返回 null", async () => {
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
});
