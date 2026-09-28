import { beforeEach, describe, expect, it, vi } from "vitest";

// logout 路由会读取 cookies() 并向上游发起撤销请求，这里全部 mock 掉，
// 只验证：登出时是否携带正确凭据撤销上游会话、撤销失败是否阻塞登出。

process.env.NEWAPI_BASE_URL = "http://newapi.test";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let sessionValue: Record<string, unknown> | null = null;

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
    getSession: vi.fn(async () => sessionValue),
    resolvedSessionCookie: vi.fn(async () => ({
      name: "lfn_session",
      options: { path: "/" },
    })),
    resolvedPendingCookie: vi.fn(async () => ({
      name: "lfn_2fa",
      options: { path: "/" },
    })),
  };
});

vi.mock("@/lib/newapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/newapi")>();
  return {
    ...actual,
    resolvedNewApiBaseUrl: vi.fn(async () => "http://newapi.test"),
  };
});

const { POST: logoutPost } = await import("@/app/api/auth/logout/route");

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

beforeEach(() => {
  sessionValue = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ success: true }));
});

describe("登出撤销上游会话", () => {
  it("密码登录会话登出时携带 cookie 与 Bearer 撤销上游会话", async () => {
    sessionValue = {
      userId: 147,
      username: "tester",
      displayName: "tester",
      upstreamCookie: "new_api_refresh=sid.secret",
      accessToken: "access-token",
      expiresAt: Date.now() + 3600_000,
    };
    const response = await logoutPost();
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://newapi.test/api/user/auth/logout");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "New-Api-User": "147",
      Cookie: "new_api_refresh=sid.secret",
      Authorization: "Bearer access-token",
    });
  });

  it("只有 refresh cookie 时仍能撤销（access token 过期场景）", async () => {
    sessionValue = {
      userId: 1,
      username: "tester",
      displayName: "tester",
      upstreamCookie: "new_api_refresh=sid.secret",
      expiresAt: Date.now() + 3600_000,
    };
    await logoutPost();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ Cookie: "new_api_refresh=sid.secret" });
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("系统访问令牌登录没有上游会话，跳过撤销", async () => {
    sessionValue = {
      userId: 1,
      username: "tester",
      displayName: "tester",
      upstreamCookie: "",
      systemToken: "sk-sys",
      expiresAt: Date.now() + 3600_000,
    };
    const response = await logoutPost();
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上游撤销失败不阻塞登出", async () => {
    sessionValue = {
      userId: 1,
      username: "tester",
      displayName: "tester",
      upstreamCookie: "new_api_refresh=sid.secret",
      expiresAt: Date.now() + 3600_000,
    };
    fetchMock.mockRejectedValue(new Error("upstream down"));
    const response = await logoutPost();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean };
    expect(payload.success).toBe(true);
  });

  it("无会话时登出仍然清除 cookie", async () => {
    const response = await logoutPost();
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const setCookies = response.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.startsWith("lfn_session="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("lfn_2fa="))).toBe(true);
  });
});
