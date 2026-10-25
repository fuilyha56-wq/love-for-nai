import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTH_POLICY } from "@/lib/auth-policy";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  provider: vi.fn(),
  referral: vi.fn(),
  createUser: vi.fn(),
  sendEmail: vi.fn(),
  consumeEmail: vi.fn(),
  identity: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/runtime-config", () => ({ getRuntimeSettings: mocks.settings }));
vi.mock("@/lib/platform", () => ({ resolvedAuthProviderId: mocks.provider }));
vi.mock("@/lib/referral", () => ({
  findReferralByCode: mocks.referral,
  redeemReferral: vi.fn(),
  canonicalReferralLink: vi.fn(),
}));
vi.mock("@/lib/local-users", () => ({
  createLocalUser: mocks.createUser,
  authenticateLocalUser: vi.fn(),
}));
vi.mock("@/lib/registration-email", () => ({
  sendRegistrationEmail: mocks.sendEmail,
  consumeRegistrationEmail: mocks.consumeEmail,
  smtpConfigured: () => false,
}));
vi.mock("@/lib/registration-identities", () => ({
  withRegistrationIdentity: mocks.identity,
}));
vi.mock("@/lib/newapi", () => ({
  resolvedNewApiBaseUrl: async () => "https://upstream.test",
}));
vi.mock("@/lib/admin-auth", () => ({
  resolvedAdminHeaders: async () => ({ Authorization: "server-only-token" }),
}));
vi.mock("@/lib/login", () => ({
  callNewApi: vi.fn(async () => ({ result: { success: false } })),
}));
vi.mock("@/lib/risk-ip", () => ({
  resolveTrustedClientIp: async () => ({ ip: "" }),
}));

const request = (body: Record<string, unknown>, method = "POST") =>
  new Request("http://localhost/api/auth/register", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "new_person",
      password: "strongpassword",
      email: "person@qq.com",
      ...body,
    }),
  });
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({
    ...DEFAULT_AUTH_POLICY,
    authProvider: "local",
    publicUrl: "",
    smtpHost: "",
    smtpFrom: "",
  });
  mocks.provider.mockResolvedValue("local");
  mocks.referral.mockResolvedValue(null);
  mocks.createUser.mockResolvedValue({ id: 50 });
  mocks.consumeEmail.mockResolvedValue(true);
  mocks.identity.mockImplementation((_email, _username, _verified, create) =>
    create(),
  );
  mocks.fetch.mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal("fetch", mocks.fetch);
});
async function policy(patch: Record<string, unknown>) {
  mocks.settings.mockResolvedValue({ ...(await mocks.settings()), ...patch });
}

describe("registration API policy enforcement", () => {
  it.each([undefined, "email", "invite"])("requires invitations for %s registration and verification without disabling methods", async (method) => {
    await policy({ requireInviteCode: true, emailRegistrationEnabled: true, inviteRegistrationEnabled: true });
    const { POST, PUT } = await import("@/app/api/auth/register/route");
    for (const inviteCode of [undefined, "", "invalid"]) {
      expect((await POST(request({ method, inviteCode }))).status).toBe(400);
      expect((await PUT(request({ method, inviteCode }, "PUT"))).status).toBe(400);
    }
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps email registration available with a valid mandatory invite even when the invite registration mode is closed", async () => {
    await policy({ requireInviteCode: true, emailRegistrationEnabled: true, inviteRegistrationEnabled: false, requireEmailVerification: false });
    mocks.referral.mockResolvedValue({ inviterUserId: 1 });
    const { POST } = await import("@/app/api/auth/register/route");
    expect((await POST(request({ method: "email", inviteCode: "valid" }))).status).toBe(200);
    expect(mocks.createUser).toHaveBeenCalled();
  });

  it("allows email verification after a mandatory invite has been validated", async () => {
    await policy({ requireInviteCode: true });
    mocks.referral.mockResolvedValue({ inviterUserId: 1 });
    const { PUT } = await import("@/app/api/auth/register/route");
    expect((await PUT(request({ method: "email", inviteCode: "valid" }, "PUT"))).status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalled();
  });

  it("creates an ordinary upstream account for a validated invitation without trusting client role fields", async () => {
    mocks.provider.mockResolvedValue("newapi");
    await policy({
      emailRegistrationEnabled: false,
      inviteRegistrationEnabled: true,
      requireEmailVerification: false,
    });
    mocks.referral.mockResolvedValue({ inviterUserId: 1 });
    mocks.fetch.mockImplementation(async () =>
      Response.json({ success: true }),
    );
    const { POST } = await import("@/app/api/auth/register/route");
    expect(
      (
        await POST(
          request({
            method: "invite",
            inviteCode: "valid",
            email: "",
            role: 100,
            group: "admin",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://upstream.test/api/user/",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(new Headers(mocks.fetch.mock.calls[0][1].headers).get("Authorization")).toBe("server-only-token");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      username: "new_person",
      password: "strongpassword",
      display_name: "new_person",
      role: 1,
      group: "default",
    });
  });
  it.each([
    "registrationEnabled",
    "passwordRegistrationEnabled",
    "emailRegistrationEnabled",
  ])("blocks POST and verification PUT when %s is disabled", async (key) => {
    await policy({ [key]: false });
    const { POST, PUT } = await import("@/app/api/auth/register/route");
    expect((await POST(request({ method: "email" }))).status).toBe(403);
    expect((await PUT(request({ method: "email" }, "PUT"))).status).toBe(403);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not let an email client bypass invitation-only registration", async () => {
    await policy({
      emailRegistrationEnabled: false,
      inviteRegistrationEnabled: true,
      requireEmailVerification: false,
    });
    const { POST } = await import("@/app/api/auth/register/route");
    expect((await POST(request({}))).status).toBe(403);
    expect(
      (await POST(request({ method: "email", inviteCode: "valid" }))).status,
    ).toBe(403);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it("rejects absent and invalid invite codes before account creation", async () => {
    await policy({
      inviteRegistrationEnabled: true,
      requireEmailVerification: false,
    });
    const { POST } = await import("@/app/api/auth/register/route");
    expect((await POST(request({ method: "invite", email: "" }))).status).toBe(
      400,
    );
    expect(
      (
        await POST(
          request({ method: "invite", inviteCode: "invalid", email: "" }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it("permits a valid invite without email when verification is disabled", async () => {
    await policy({
      emailRegistrationEnabled: false,
      inviteRegistrationEnabled: true,
      requireEmailVerification: false,
    });
    mocks.referral.mockResolvedValue({ inviterUserId: 1 });
    const { POST } = await import("@/app/api/auth/register/route");
    expect(
      (
        await POST(
          request({ method: "invite", inviteCode: "valid", email: "" }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "" }),
    );
  });
  it("requires and validates email ownership even for invited accounts", async () => {
    await policy({ inviteRegistrationEnabled: true });
    mocks.referral.mockResolvedValue({ inviterUserId: 1 });
    mocks.consumeEmail.mockResolvedValue(false);
    const { POST } = await import("@/app/api/auth/register/route");
    expect(
      (await POST(request({ method: "invite", inviteCode: "valid" }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            method: "invite",
            inviteCode: "valid",
            verificationCode: "000000",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it.each([
    { email: "person+alias@qq.com", blockEmailAliases: true },
    { email: "person@evil.test", emailDomainRestrictionEnabled: true },
  ])(
    "enforces email restrictions on sending and submission: %j",
    async ({ email, ...patch }) => {
      await policy(patch);
      const { POST, PUT } = await import("@/app/api/auth/register/route");
      expect(
        (await POST(request({ email, verificationCode: "123456" }))).status,
      ).toBe(400);
      expect((await PUT(request({ email }, "PUT"))).status).toBe(400);
      expect(mocks.createUser).not.toHaveBeenCalled();
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    },
  );
  it("requires an email on invitation registration when domain restrictions are enabled", async () => {
    await policy({
      inviteRegistrationEnabled: true,
      requireEmailVerification: false,
      emailDomainRestrictionEnabled: true,
    });
    mocks.referral.mockResolvedValue({ inviterUserId: 1 });
    const { POST } = await import("@/app/api/auth/register/route");
    expect(
      (
        await POST(
          request({ method: "invite", inviteCode: "valid", email: "" }),
        )
      ).status,
    ).toBe(400);
  });
  it("fails closed when upstream email verification is disabled", async () => {
    mocks.provider.mockResolvedValue("newapi");
    mocks.fetch.mockImplementation(async () =>
      Response.json({ success: true, data: { email_verification: false } }),
    );
    const { POST } = await import("@/app/api/auth/register/route");
    expect((await POST(request({ verificationCode: "123456" }))).status).toBe(
      503,
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not expose secrets in the public policy", async () => {
    await policy({ newApiAdminToken: "secret", smtpPassword: "mail-secret" });
    const { GET } = await import("@/app/api/auth/policy/route");
    const response = await GET();
    expect(await response.text()).not.toContain("secret");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("disabled login methods", () => {
  it.each(["login", "2fa", "token"])(
    "rejects %s before authenticating or contacting upstream",
    async (route) => {
      await policy({ passwordLoginEnabled: false, tokenLoginEnabled: false });
      const loaders = {
        login: () => import("@/app/api/auth/login/route"),
        "2fa": () => import("@/app/api/auth/2fa/route"),
        token: () => import("@/app/api/auth/token/route"),
      };
      const { POST } = await loaders[route as keyof typeof loaders]();
      expect((await POST(request({ token: "token" }))).status).toBe(403);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
});
