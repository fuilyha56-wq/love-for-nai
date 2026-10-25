import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { DEFAULT_AUTH_POLICY } from "@/lib/auth-policy";
import type { RuntimeSettings } from "@/lib/runtime-config";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  provider: vi.fn(),
  referral: vi.fn(),
  redeem: vi.fn(),
  fetch: vi.fn(),
  adminHeaders: vi.fn(),
  login: vi.fn(),
  establish: vi.fn(),
  session: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/lib/runtime-config", () => ({ getRuntimeSettings: mocks.settings }));
vi.mock("@/lib/platform", () => ({ resolvedAuthProviderId: mocks.provider }));
vi.mock("@/lib/referral", () => ({
  findReferralByCode: mocks.referral,
  redeemReferral: mocks.redeem,
  canonicalReferralLink: (origin: string, code: string) =>
    `${origin}/sign-in?invite=${code}`,
  referralForInviter: mocks.publish,
  referralInvitedCount: () => 0,
  referralReward: async () => 10,
}));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/newapi", () => ({
  resolvedNewApiBaseUrl: async () => "https://newapi.test",
  userHeaders: () => ({
    Authorization: "inviter-session",
    "New-Api-User": "3",
  }),
}));
vi.mock("@/lib/admin-auth", () => ({
  resolvedAdminHeaders: mocks.adminHeaders,
  resolvedAdminTokenValue: async () => null,
}));
vi.mock("@/lib/local-users", () => ({ createLocalUser: vi.fn() }));
vi.mock("@/lib/registration-email", () => ({
  smtpConfigured: (settings: RuntimeSettings) =>
    Boolean(settings.smtpHost && settings.smtpFrom),
  consumeRegistrationEmail: vi.fn(),
  sendRegistrationEmail: vi.fn(),
}));
vi.mock("@/lib/registration-identities", () => ({
  withRegistrationIdentity: (
    _e: string,
    _u: string,
    _v: boolean,
    create: () => Promise<Response>,
  ) => create(),
}));
vi.mock("@/lib/login", async (original) => ({
  ...(await original<typeof import("@/lib/login")>()),
  callNewApi: mocks.login,
  establishSession: mocks.establish,
}));
vi.mock("@/lib/risk-ip", () => ({
  resolveTrustedClientIp: async () => ({ ip: "" }),
}));

const baseSettings = () =>
  ({
    ...DEFAULT_AUTH_POLICY,
    authProvider: "newapi",
    publicUrl: "https://lfn.test",
    smtpHost: "",
    smtpFrom: "",
    enableReferral: true,
  }) as RuntimeSettings;
const status = (patch = {}) =>
  Response.json({
    success: true,
    data: {
      email_verification: true,
      register_enabled: true,
      password_register_enabled: true,
      invite_only_register_enabled: true,
      ...patch,
    },
  });
const request = (patch = {}, method = "POST") =>
  new Request("https://lfn.test/api/auth/register", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "new_person",
      password: "strongpassword",
      email: "person@qq.com",
      verificationCode: "82aefc",
      inviteCode: "lfn-invite",
      remember: true,
      ...patch,
    }),
  });

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue(baseSettings());
  mocks.provider.mockResolvedValue("newapi");
  mocks.referral.mockResolvedValue({ inviterUserId: 3 });
  mocks.adminHeaders.mockResolvedValue({
    Authorization: "server-secret",
    "New-Api-User": "1",
  });
  mocks.redeem.mockResolvedValue({ reward: 10, applied: true });
  mocks.session.mockResolvedValue({ userId: 3 });
  mocks.publish.mockResolvedValue({ code: "lfn-invite" });
  mocks.login.mockResolvedValue({
    result: {
      success: true,
      data: { user: { id: 52, username: "new_person" } },
    },
    response: new Response(),
  });
  mocks.establish.mockImplementation(async () => {
    const response = NextResponse.json({ user: { id: 52 } });
    response.cookies.set("lfn_session", "test-session", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
    return response;
  });
  mocks.fetch.mockImplementation(async (input: string) => {
    if (input.endsWith("/api/status")) return status();
    if (input.endsWith("/api/user/3"))
      return Response.json({
        success: true,
        data: { id: 3, status: 1, aff_code: "n3ai", DeletedAt: null },
      });
    if (input.endsWith("/api/user/aff"))
      return Response.json({ success: true, data: "n3ai" });
    if (input.endsWith("/api/user/register"))
      return Response.json({ success: true });
    throw new Error(`Unexpected endpoint: ${input}`);
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("LFN to NewAPI registration bridge", () => {
  it("maps the LFN inviter server-side, preserves email verification and establishes a browser session", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const response = await POST(
      request({ affCode: "attacker-selected", role: 100, group: "admin" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      signedIn: true,
      referralReward: 10,
      referralApplied: true,
    });
    expect(response.headers.get("set-cookie")).toContain(
      "lfn_session=test-session",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    const [, init] = mocks.fetch.mock.calls.find(([url]) =>
      url.endsWith("/api/user/register"),
    )!;
    expect(JSON.parse(init.body)).toEqual({
      username: "new_person",
      password: "strongpassword",
      password2: "strongpassword",
      email: "person@qq.com",
      verification_code: "82aefc",
      aff_code: "n3ai",
    });
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(mocks.establish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
    );
    expect(mocks.redeem).toHaveBeenCalledWith(
      "lfn-invite",
      52,
      expect.anything(),
    );
    expect(JSON.stringify(body)).not.toContain("server-secret");
    expect(
      mocks.fetch.mock.calls.some(([url]) => url.endsWith("/api/user/")),
    ).toBe(false);
  });

  it("does not claim registration failed when only automatic sign-in fails", async () => {
    mocks.establish.mockRejectedValue(new Error("session unavailable"));
    const { POST } = await import("@/app/api/auth/register/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      signedIn: false,
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.redeem).toHaveBeenCalled();
  });

  it("keeps the NewAPI two-factor challenge from becoming a signed-in session", async () => {
    mocks.login.mockResolvedValue({
      result: {
        success: true,
        data: { require_2fa: true, flow_token: "challenge", user: { id: 52 } },
      },
      response: new Response(),
    });
    const { POST } = await import("@/app/api/auth/register/route");
    const response = await POST(request());
    expect(await response.json()).toMatchObject({
      success: true,
      signedIn: false,
    });
    expect(mocks.establish).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a missing LFN invite even if a client supplies a raw NewAPI code", async () => {
    const { POST, PUT } = await import("@/app/api/auth/register/route");
    for (const run of [POST, PUT])
      expect(
        (
          await run(
            request(
              { inviteCode: "", affCode: "n3ai" },
              run === POST ? "POST" : "PUT",
            ),
          )
        ).status,
      ).toBe(400);
    expect(
      mocks.fetch.mock.calls.every(([url]) => url.endsWith("/api/status")),
    ).toBe(true);
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("returns the upstream verification rejection without admin creation or login", async () => {
    const defaultFetch = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((input, init) =>
      input.endsWith("/api/user/register")
        ? Response.json({ success: false, message: "邮箱验证码错误或已过期" })
        : defaultFetch(input, init),
    );
    const { POST } = await import("@/app/api/auth/register/route");
    const response = await POST(request({ verificationCode: "wrong" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "邮箱验证码错误或已过期",
    });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("checks NewAPI's 20-character username limit before sending a registration", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const response = await POST(request({ username: "x".repeat(21) }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("3–20");
    expect(
      mocks.fetch.mock.calls.some(([url]) =>
        url.endsWith("/api/user/register"),
      ),
    ).toBe(false);
  });

  it.each([false, true])(
    "respects upstream registration shutdown (password only: %s)",
    async (passwordOnly) => {
      mocks.fetch.mockImplementation(async () =>
        status(
          passwordOnly
            ? { password_register_enabled: false }
            : { register_enabled: false },
        ),
      );
      const { POST, PUT } = await import("@/app/api/auth/register/route");
      expect((await POST(request())).status).toBe(403);
      expect((await PUT(request({}, "PUT"))).status).toBe(403);
      expect(mocks.login).not.toHaveBeenCalled();
    },
  );
});

describe("upstream invite lifecycle", () => {
  it("uses the service account's own affiliate endpoint for its LFN code", async () => {
    mocks.referral.mockResolvedValue({ inviterUserId: 1 });
    const { newApiRegistrationAffCode } =
      await import("@/lib/newapi-registration");
    expect(await newApiRegistrationAffCode("root-invite")).toBe("n3ai");
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://newapi.test/api/user/aff",
    );
  });
  it.each([
    { id: 3, status: 2, aff_code: "n3ai" },
    { id: 99, status: 1, aff_code: "n3ai" },
    { id: 3, status: 1, aff_code: "n3ai", DeletedAt: "2026-10-25" },
    { id: 3, status: 1, aff_code: "" },
  ])("rejects unusable or unprepared inviters: %j", async (data) => {
    mocks.fetch.mockResolvedValue(Response.json({ success: true, data }));
    const { newApiRegistrationAffCode } =
      await import("@/lib/newapi-registration");
    await expect(newApiRegistrationAffCode("lfn-invite")).rejects.toThrow();
  });
  it("fails closed when inviter lookup is unavailable", async () => {
    mocks.fetch.mockRejectedValue(new Error("network"));
    const { newApiRegistrationAffCode } =
      await import("@/lib/newapi-registration");
    await expect(newApiRegistrationAffCode("lfn-invite")).rejects.toMatchObject(
      { status: 503 },
    );
  });
  it("prepares the inviter's upstream code before returning a LFN link", async () => {
    const { GET } = await import("@/app/api/aff/referral/route");
    const response = await GET(
      new Request("https://lfn.test/api/aff/referral"),
    );
    expect(await response.json()).toMatchObject({
      code: "lfn-invite",
      link: "https://lfn.test/sign-in?invite=lfn-invite",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://newapi.test/api/user/aff",
      expect.objectContaining({
        headers: { Authorization: "inviter-session", "New-Api-User": "3" },
      }),
    );
    expect(mocks.adminHeaders).not.toHaveBeenCalled();
  });
  it("does not publish a broken invitation when upstream preparation fails", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ success: false }));
    const { GET } = await import("@/app/api/aff/referral/route");
    expect(
      (await GET(new Request("https://lfn.test/api/aff/referral"))).status,
    ).toBe(503);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe("effective public registration policy", () => {
  it("shows the LFN invite field when NewAPI requires invitations, without exposing upstream codes", async () => {
    const { GET } = await import("@/app/api/auth/policy/route");
    const response = await GET();
    expect(await response.json()).toMatchObject({
      provider: "newapi",
      policy: { requireInviteCode: true, passwordLoginEnabled: true },
    });
  });
  it("keeps login available when registration policy cannot be read", async () => {
    mocks.fetch.mockRejectedValue(new Error("unavailable"));
    const { GET } = await import("@/app/api/auth/policy/route");
    expect(await (await GET()).json()).toMatchObject({
      policy: {
        registrationEnabled: false,
        passwordLoginEnabled: true,
        tokenLoginEnabled: true,
      },
    });
  });
});
