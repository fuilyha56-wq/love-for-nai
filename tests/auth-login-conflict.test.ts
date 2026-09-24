import { beforeEach, describe, expect, it, vi } from "vitest";

// 登录路由会向上游 /api/user/login 发起请求，这里 mock fetch，
// 验证上游 409（会话数上限）时返回友好中文提示而非透传 "Conflict"。

process.env.NEWAPI_BASE_URL = "http://newapi.test";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
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

vi.mock("@/lib/platform", () => ({
  resolvedAuthProviderId: vi.fn(async () => "newapi"),
}));

const { POST: loginPost } = await import("@/app/api/auth/login/route");

function loginRequest() {
  return new Request("http://lfn.test/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "user", password: "pass" }),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("登录上游会话上限提示", () => {
  it("上游 409 时返回友好中文提示与 409 状态码", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers(),
      json: async () => ({
        success: false,
        code: "AUTH_SESSION_LIMIT",
        message: "Conflict",
      }),
    });
    const response = await loginPost(loginRequest());
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("登录会话数已达上限");
  });

  it("普通登录失败仍透传上游 message 与 401", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ success: false, message: "用户名或密码错误" }),
    });
    const response = await loginPost(loginRequest());
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toBe("用户名或密码错误");
  });
});
