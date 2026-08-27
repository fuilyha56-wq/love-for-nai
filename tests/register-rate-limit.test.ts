import { beforeEach, describe, expect, it, vi } from "vitest";

describe("registration verification rate limiting", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true }, { status: 200 })),
    );
  });

  it("limits repeated verification messages to one email", async () => {
    const { PUT } = await import("@/app/api/auth/register/route");
    const request = () =>
      new Request("http://localhost/api/auth/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@example.com" }),
      });

    expect((await PUT(request())).status).toBe(200);
    expect((await PUT(request())).status).toBe(200);
    expect((await PUT(request())).status).toBe(200);
    const blocked = await PUT(request());

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("registration upstream responses", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function registrationRequest(email: string) {
    return new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "new_user",
        password: "password123",
        email,
        verificationCode: "123456",
      }),
    });
  }

  it("forwards the NewAPI registration field names", async () => {
    const upstream = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        void _input;
        void _init;
        return Response.json({ success: true }, { status: 200 });
      },
    );
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("@/app/api/auth/register/route");

    const response = await POST(registrationRequest("fields@example.com"));
    const [, init] = upstream.mock.calls[0];

    expect(response.status).toBe(200);
    expect(JSON.parse(String(init?.body))).toEqual({
      username: "new_user",
      password: "password123",
      password2: "password123",
      email: "fields@example.com",
      verification_code: "123456",
      aff_code: "",
    });
  });

  it("preserves upstream rate limits as a readable JSON error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("", {
            status: 429,
            headers: { "Retry-After": "42" },
          }),
      ),
    );
    const { POST } = await import("@/app/api/auth/register/route");

    const response = await POST(registrationRequest("limited@example.com"));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toEqual({
      message: "注册请求过于频繁，请稍后再试",
    });
  });

  it("preserves a NewAPI registration rejection and its message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: false, message: "邮箱验证码错误或已过期" },
          { status: 200 },
        ),
      ),
    );
    const { POST } = await import("@/app/api/auth/register/route");

    const response = await POST(registrationRequest("rejected@example.com"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "邮箱验证码错误或已过期",
    });
  });

  it("converts malformed successful upstream responses into a gateway error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    const { POST } = await import("@/app/api/auth/register/route");

    const response = await POST(registrationRequest("malformed@example.com"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ message: "注册失败" });
  });
});
