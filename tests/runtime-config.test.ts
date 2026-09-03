import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRuntimeSettings,
  isMaskedSecret,
  publicSettings,
  resetRuntimeConfigCache,
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
});
