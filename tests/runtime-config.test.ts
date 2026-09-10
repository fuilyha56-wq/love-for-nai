import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRuntimeSettings,
  isMaskedSecret,
  publicSettings,
  resetRuntimeConfigCache,
  runtimeAffGateway,
  runtimeImageUpstream,
  runtimeNaiAccountUpstream,
  runtimeNaiImageUpstream,
  updateRuntimeSettings,
  upsertRuntimeEndpoint,
} from "@/lib/runtime-config";

const original = process.env.LFN_DATA_DIR;

afterEach(() => {
  resetRuntimeConfigCache();
  if (original == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = original;
});

describe("runtime platform config", () => {
  it("overrides environment values and keeps masked secrets", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-runtime-"));
    process.env.NEWAPI_BASE_URL = "http://env-newapi";
    process.env.LFN_ADMIN_TOKEN = "env-secret-token-1234";
    resetRuntimeConfigCache();
    const first = await getRuntimeSettings();
    expect(first.newApiBaseUrl).toBe("http://env-newapi");
    const next = await updateRuntimeSettings({
      newApiBaseUrl: "http://runtime-newapi",
      newApiAdminToken: "live-secret-token-5678",
    });
    expect(next.newApiBaseUrl).toBe("http://runtime-newapi");
    expect(next.newApiAdminToken).toBe("live-secret-token-5678");
    const masked = publicSettings(next);
    expect(isMaskedSecret(masked.newApiAdminToken)).toBe(true);
    const kept = await updateRuntimeSettings({ newApiAdminToken: masked.newApiAdminToken });
    expect(kept.newApiAdminToken).toBe("live-secret-token-5678");
  });

  it("upserts endpoints without overwriting a masked token", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-runtime-ep-"));
    process.env.LFN_DATA_DIR = dir;
    await mkdir(path.join(dir, "platform"), { recursive: true });
    await writeFile(
      path.join(dir, "platform", "config.json"),
      JSON.stringify({
        settings: {},
        endpoints: [
          {
            id: "gateway-image",
            type: "image",
            adapterType: "gateway",
            name: "Gateway",
            enabled: true,
            config: { baseUrl: "http://gateway", token: "real-token-value" },
            priority: 100,
            createdAt: "2026-09-04T00:00:00.000Z",
            updatedAt: "2026-09-04T00:00:00.000Z",
          },
        ],
      }),
    );
    resetRuntimeConfigCache();
    const updated = await upsertRuntimeEndpoint({
      id: "gateway-image",
      name: "NovelAI Gateway",
      config: { token: "gate••••alue" },
    });
    expect(updated.name).toBe("NovelAI Gateway");
    expect(updated.config.token).toBe("real-token-value");
  });

  it("uses the highest-priority enabled image endpoint, not a leftover Gateway field", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-runtime-image-"));
    process.env.LFN_AFF_GATEWAY_URL = "http://env-gateway";
    process.env.LFN_AFF_GATEWAY_TOKEN = "env-gateway-token";
    resetRuntimeConfigCache();
    await updateRuntimeSettings({
      affGatewayUrl: "http://settings-gateway",
      affGatewayToken: "settings-gateway-token",
    });
    await upsertRuntimeEndpoint({
      id: "compat-image",
      type: "image",
      adapterType: "openai_compat",
      name: "兼容接口",
      enabled: true,
      priority: 200,
      config: { baseUrl: "http://compat-image", token: "compat-token" },
    });
    const upstream = await runtimeImageUpstream();
    expect(upstream).toEqual({
      baseUrl: "http://compat-image",
      token: "compat-token",
      adapterType: "openai_compat",
    });
    expect(await runtimeAffGateway()).toBeNull();
  });

  it("splits NovelAI account and image native endpoints", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-runtime-nai-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({
      naiApiUrl: "http://account-gateway/v1",
      naiApiToken: "account-token",
      naiImageApiUrl: "http://image-gateway",
      naiImageApiToken: "image-token",
    });
    expect(await runtimeNaiAccountUpstream()).toEqual({
      baseUrl: "http://account-gateway",
      token: "account-token",
    });
    expect(await runtimeNaiImageUpstream()).toEqual({
      baseUrl: "http://image-gateway",
      token: "image-token",
    });
  });

  it("reuses the account native endpoint when image site is empty", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-runtime-nai2-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({
      affGatewayUrl: "http://shared-gateway/v1",
      affGatewayToken: "shared-token",
    });
    expect(await runtimeNaiAccountUpstream()).toEqual({
      baseUrl: "http://shared-gateway",
      token: "shared-token",
    });
    expect(await runtimeNaiImageUpstream()).toEqual({
      baseUrl: "http://shared-gateway",
      token: "shared-token",
    });
  });
});
