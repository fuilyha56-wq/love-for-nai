import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ getResolvedPlatformCapabilities: async () => ({}) }));
import { GET } from "@/app/api/health/route";
import { getRiskSettings, publishRiskSettings, resetRiskSettingsCache } from "@/lib/risk-settings";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-health-admission-"));
  vi.stubEnv("LFN_DATA_DIR", directory);
  vi.stubEnv("LFN_TRUST_PROXY", "true");
  vi.stubEnv("LFN_RISK_HASH_SECRET", "health-test-key");
  vi.stubEnv("LFN_SESSION_SECRET", "");
  resetRiskSettingsCache(); resetRuntimeConfigCache();
});
afterEach(async () => {
  resetRiskSettingsCache(); resetRuntimeConfigCache(); vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
const probe = (headers?: HeadersInit) => GET(new Request("https://lfn.test/api/health", { headers }));

describe("edge free-image admission readiness", () => {
  it("keeps liveness separate and refuses missing, invalid or untrusted visitor headers", async () => {
    for (const headers of [undefined, { "x-real-ip": "invalid" }]) {
      const response = await probe(headers);
      expect(response.status).toBe(200);
      expect((await response.json()).readiness.freeImageAdmission).toBe("unavailable");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    await updateRuntimeSettings({ trustProxy: false });
    expect((await (await probe({ "x-real-ip": "203.0.113.71" })).json()).readiness.freeImageAdmission).toBe("unavailable");
  });
  it("checks the runtime override, digest secret and real ingress without disclosing addresses", async () => {
    const headers = { "x-real-ip": "203.0.113.71" };
    const response = await probe(headers), body = await response.text();
    expect(JSON.parse(body).readiness.freeImageAdmission).toBe("ready");
    expect(body).not.toContain("203.0.113.71");
    vi.stubEnv("LFN_RISK_HASH_SECRET", "");
    expect((await (await probe(headers)).json()).readiness.freeImageAdmission).toBe("unavailable");
    vi.stubEnv("LFN_SESSION_SECRET", "fallback-test-key");
    expect((await (await probe(headers)).json()).readiness.freeImageAdmission).toBe("ready");
  });
  it("honors an explicitly published observe-only source policy", async () => {
    const settings = structuredClone(await getRiskSettings());
    settings.values["grant.unknownIp"] = "observe";
    await publishRiskSettings(settings, settings.version, "test", "source observation policy");
    expect((await (await probe()).json()).readiness.freeImageAdmission).toBe("ready");
  });
});
