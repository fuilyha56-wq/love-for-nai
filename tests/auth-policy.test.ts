import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AUTH_POLICY,
  normalizeEmailDomains,
  registrationEmailError,
  registrationMethods,
} from "@/lib/auth-policy";
import {
  getRuntimeSettings,
  publicSettings,
  updateRuntimeSettings,
} from "@/lib/runtime-config";
import { parseRuntimeSettingsPatch } from "@/lib/platform-config-input";

describe("registration policy", () => {
  it.each([
    [true, false, ["email"]],
    [false, true, ["invite"]],
    [true, true, ["email", "invite"]],
    [false, false, []],
  ])(
    "exposes only enabled methods (email %s, invite %s)",
    (emailRegistrationEnabled, inviteRegistrationEnabled, expected) => {
      expect(
        registrationMethods({
          ...DEFAULT_AUTH_POLICY,
          emailRegistrationEnabled,
          inviteRegistrationEnabled,
        }),
      ).toEqual(expected);
    },
  );
  it("honors both the registration and password registration master switches", () => {
    expect(
      registrationMethods({
        ...DEFAULT_AUTH_POLICY,
        registrationEnabled: false,
      }),
    ).toEqual([]);
    expect(
      registrationMethods({
        ...DEFAULT_AUTH_POLICY,
        passwordRegistrationEnabled: false,
      }),
    ).toEqual([]);
  });
  it("normalizes domains and rejects URLs, wildcards and mailbox addresses", () => {
    expect(normalizeEmailDomains(" GMAIL.COM\r\nqq.com\n gmail.com\n")).toBe(
      "gmail.com\nqq.com",
    );
    for (const domain of [
      "https://qq.com",
      "*.qq.com",
      "user@qq.com",
      "-bad.com",
    ])
      expect(() => normalizeEmailDomains(domain)).toThrow();
  });
  it("matches exact domains case insensitively and blocks aliases", () => {
    const policy = {
      ...DEFAULT_AUTH_POLICY,
      emailDomainRestrictionEnabled: true,
      blockEmailAliases: true,
    };
    expect(registrationEmailError(policy, "person@GMAIL.COM")).toBeNull();
    expect(registrationEmailError(policy, "person@sub.gmail.com")).toContain(
      "域名",
    );
    expect(registrationEmailError(policy, "person+alias@qq.com")).toContain(
      "别名",
    );
    expect(registrationEmailError(policy, "per.son@gmail.com")).toContain(
      "别名",
    );
    expect(registrationEmailError(policy, "per.son@qq.com")).toBeNull();
  });
});

describe("scoped settings persistence", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "lfn-policy-"));
    vi.stubEnv("LFN_DATA_DIR", directory);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  it("adds an invitation requirement without changing allowed methods or login switches", async () => {
    const before = await getRuntimeSettings();
    const patch = parseRuntimeSettingsPatch({ requireInviteCode: true });
    const after = await updateRuntimeSettings(patch);
    expect(after.requireInviteCode).toBe(true);
    for (const key of ["passwordLoginEnabled", "tokenLoginEnabled", "emailRegistrationEnabled", "inviteRegistrationEnabled"] as const) expect(after[key]).toBe(before[key]);
    expect(registrationMethods(after)).toEqual(registrationMethods(before));
    expect((await getRuntimeSettings()).requireInviteCode).toBe(true);
    expect(() => parseRuntimeSettingsPatch({ requireInviteCode: "true" })).toThrow();
  });
  it("keeps service secrets and unrelated values when saving another page", async () => {
    await updateRuntimeSettings({
      newApiBaseUrl: "https://upstream.test",
      newApiAdminToken: "secret-admin-token",
      imagePackageAffPerPackage: 321,
      smtpPassword: "smtp-secret-password",
    });
    await updateRuntimeSettings(
      parseRuntimeSettingsPatch({
        emailRegistrationEnabled: false,
        inviteRegistrationEnabled: true,
      }),
    );
    const settings = await getRuntimeSettings();
    expect(settings.newApiBaseUrl).toBe("https://upstream.test");
    expect(settings.newApiAdminToken).toBe("secret-admin-token");
    expect(settings.imagePackageAffPerPackage).toBe(321);
    expect(settings.emailRegistrationEnabled).toBe(false);
    expect(settings.inviteRegistrationEnabled).toBe(true);
    expect(publicSettings(settings).smtpPassword).not.toBe(
      "smtp-secret-password",
    );
    await updateRuntimeSettings(
      parseRuntimeSettingsPatch({
        smtpPassword: publicSettings(settings).smtpPassword,
      }),
    );
    expect((await getRuntimeSettings()).smtpPassword).toBe(
      "smtp-secret-password",
    );
  });
  it("rejects malformed booleans and empty enabled domain restrictions", async () => {
    expect(() =>
      parseRuntimeSettingsPatch({ registrationEnabled: "false" }),
    ).toThrow();
    await expect(
      updateRuntimeSettings({
        emailDomainRestrictionEnabled: true,
        allowedEmailDomains: "",
      }),
    ).rejects.toThrow("至少");
    expect((await getRuntimeSettings()).emailDomainRestrictionEnabled).toBe(
      false,
    );
  });
  it("lets admins prepare the domain list while domain restrictions are off", async () => {
    await updateRuntimeSettings(
      parseRuntimeSettingsPatch({
        emailDomainRestrictionEnabled: false,
        allowedEmailDomains: "gmail.com\nexample.org",
      }),
    );
    expect((await getRuntimeSettings()).allowedEmailDomains).toBe(
      "gmail.com\nexample.org",
    );
  });
});
