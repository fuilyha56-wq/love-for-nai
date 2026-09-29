import { beforeEach, describe, expect, it, vi } from "vitest";

// 管理员清理登录状态：递增会话纪元（清 LFN 侧）+ 撤销上游 user_sessions
// （清 NewAPI 侧，解决 409 会话上限）。上游失败时不递增纪元（原子性）。

process.env.NEWAPI_DB_URL = "postgres://db.test/newapi";

const queryMock = vi.fn();
vi.mock("pg", () => ({
  Pool: vi.fn(function Pool() {
    return { query: queryMock };
  }),
}));

const adminMock = vi.fn<(gate?: unknown) => Promise<unknown>>();
vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: (gate?: unknown) => adminMock(gate),
}));

const settingsStore = { sessionEpoch: 1 };
vi.mock("@/lib/runtime-config", () => ({
  getRuntimeSettings: vi.fn(async () => ({ ...settingsStore })),
  updateRuntimeSettings: vi.fn(async (patch: Record<string, unknown>) => {
    Object.assign(settingsStore, patch);
    return { ...settingsStore };
  }),
}));

const { POST, GET } = await import("@/app/api/admin/sessions/route");

function jsonRequest(body: unknown) {
  return new Request("http://lfn.test/api/admin/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  queryMock.mockReset();
  adminMock.mockResolvedValue({});
  settingsStore.sessionEpoch = 1;
});describe("管理员清理登录状态", () => {
  it("全量清理：撤销上游全部活跃会话并递增纪元", async () => {
    queryMock.mockResolvedValue({ rowCount: 42, rows: [] });
    const response = await POST(jsonRequest({ all: true }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ scope: "all", upstreamRevoked: 42, sessionEpoch: 2 });
    expect(settingsStore.sessionEpoch).toBe(2);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("user_sessions");
    expect(sql).toContain("status = 'active'");
    expect(params).toHaveLength(1);
  });

  it("按用户清理：只撤销该用户会话，不递增全局纪元", async () => {
    queryMock.mockResolvedValue({ rowCount: 7, rows: [] });
    const response = await POST(jsonRequest({ userId: 171 }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ scope: "user", userId: 171, upstreamRevoked: 7 });
    expect(settingsStore.sessionEpoch).toBe(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("user_id = $2");
    expect(params).toEqual([expect.any(Number), 171]);
  });

  it("上游清理失败时不递增纪元并返回 502（避免只清一半）", async () => {
    queryMock.mockRejectedValue(new Error("connection refused"));
    const response = await POST(jsonRequest({ all: true }));
    expect(response.status).toBe(502);
    expect(settingsStore.sessionEpoch).toBe(1);
  });

  it("数据库未配置时跳过上游清理，只递增纪元（LFN 侧仍全清）", async () => {
    delete process.env.NEWAPI_DB_URL;
    vi.resetModules();
    const mod = await import("@/app/api/admin/sessions/route");
    const response = await mod.POST(jsonRequest({ all: true }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ scope: "all", upstreamSkipped: true, sessionEpoch: 2 });
    process.env.NEWAPI_DB_URL = "postgres://db.test/newapi";
  });

  it("非管理员拒绝访问", async () => {
    adminMock.mockResolvedValue({ error: "仅管理员可用" });
    const response = await POST(jsonRequest({ all: true }));
    expect(response.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("GET 返回当前纪元与上游活跃会话计数", async () => {
    queryMock.mockResolvedValue({
      rows: [
        { user_id: 171, username: "u171", active_sessions: 51 },
        { user_id: 2, username: "u2", active_sessions: 3 },
      ],
    });
    const response = await GET();
    const result = await response.json();
    expect(result.sessionEpoch).toBe(1);
    expect(result.items[0]).toMatchObject({ userId: 171, activeSessions: 51 });
  });
});
