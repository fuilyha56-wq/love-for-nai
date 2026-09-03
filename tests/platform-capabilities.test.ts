import { afterEach, describe, expect, it } from "vitest";
import { listAdminModules } from "@/lib/admin-modules";
import { authProviderId, getPlatformCapabilities, imageProviderId } from "@/lib/platform";

const keys = [
  "LFN_AUTH_PROVIDER",
  "NEWAPI_BASE_URL",
  "LFN_AFF_GATEWAY_URL",
  "LFN_AFF_GATEWAY_TOKEN",
  "LFN_IMAGE_PROVIDER_URL",
  "LFN_IMAGE_PROVIDER_TOKEN",
  "LFN_ADMIN_TOKEN",
] as const;

const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (original[key] == null) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("平台能力探测", () => {
  it("默认仍走 NewAPI 账号，不因未配 Gateway 而切换本地账号", () => {
    process.env.LFN_AUTH_PROVIDER = "newapi";
    process.env.NEWAPI_BASE_URL = "http://newapi.test";
    delete process.env.LFN_AFF_GATEWAY_URL;
    delete process.env.LFN_AFF_GATEWAY_TOKEN;
    expect(authProviderId()).toBe("newapi");
    expect(imageProviderId()).toBe("newapi");
    expect(getPlatformCapabilities().wallet.upstreamBalance).toBe(true);
  });

  it("本地账号 + 通用图像上游时关闭上游余额，保留创作额度", () => {
    process.env.LFN_AUTH_PROVIDER = "local";
    process.env.LFN_IMAGE_PROVIDER_URL = "http://image.test/v1";
    process.env.LFN_IMAGE_PROVIDER_TOKEN = "token";
    delete process.env.LFN_AFF_GATEWAY_URL;
    delete process.env.LFN_AFF_GATEWAY_TOKEN;
    expect(authProviderId()).toBe("local");
    expect(imageProviderId()).toBe("openai_compat");
    const capabilities = getPlatformCapabilities();
    expect(capabilities.wallet.upstreamBalance).toBe(false);
    expect(capabilities.wallet.credits).toBe(true);
    expect(capabilities.admin.users).toBe(true);
    expect(capabilities.image.enabled).toBe(true);
    const modules = listAdminModules(capabilities);
    expect(modules.map((item) => item.id)).toEqual([
      "overview",
      "users",
      "credits",
      "announcements",
      "gallery",
      "referrals",
      "platform",
    ]);
    expect(modules.every((item) => item.enabled && item.description)).toBe(true);
  });
});
