import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: gate }));
import { GET, POST } from "@/app/api/admin/risk/settings/route";
import {
  defaultRiskSettings,
  resetRiskSettingsCache,
} from "@/lib/risk-settings";
import { resetRuntimeConfigCache } from "@/lib/runtime-config";
const original = process.env.LFN_DATA_DIR;
let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "risk-config-api-"));
  process.env.LFN_DATA_DIR = directory;
  resetRiskSettingsCache();
  resetRuntimeConfigCache();
  gate.mockResolvedValue({ session: { userId: 1 }, role: 100 });
});
afterEach(async () => {
  resetRiskSettingsCache();
  resetRuntimeConfigCache();
  if (original) process.env.LFN_DATA_DIR = original;
  else delete process.env.LFN_DATA_DIR;
  await rm(directory, { recursive: true, force: true });
});
const req = (body: unknown, origin = "http://public.test:41800") =>
  new Request("http://internal:3000/api/admin/risk/settings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "public.test:41800",
      origin,
    },
    body: JSON.stringify(body),
  });
describe("online risk policy editing", () => {
  it("accepts valid public Host including its port, rejects cross-site writes", async () => {
    expect(
      (await POST(req({ action: "validate", settings: defaultRiskSettings() })))
        .status,
    ).toBe(200);
    expect(
      (
        await POST(
          req(
            { action: "validate", settings: defaultRiskSettings() },
            "http://other.test:41800",
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("persists and exposes a draft without publishing it, then applies a reasoned publish", async () => {
    const settings = defaultRiskSettings();
    settings.values["global.scoreCap"] = 250;
    const saved = await (
      await POST(req({ action: "draft", settings, reason: "draft fixture" }))
    ).json();
    expect(saved.draft.savedAt).toBeTruthy();
    const snapshot = await (await GET()).json();
    expect(snapshot.settings.values["global.scoreCap"]).toBe(200);
    expect(snapshot.draft.settings.values["global.scoreCap"]).toBe(250);
    expect(
      JSON.parse(
        await readFile(
          path.join(directory, "risk/settings-draft.json"),
          "utf8",
        ),
      ).reason,
    ).toBe("draft fixture");
    const published = await POST(
      req({
        action: "publish",
        settings,
        reason: "reviewed fixture",
        expectedVersion: snapshot.settings.version,
      }),
    );
    expect(published.status).toBe(200);
    expect(
      (await (await GET()).json()).settings.values["global.scoreCap"],
    ).toBe(250);
    expect(
      (
        await POST(
          req({
            action: "publish",
            settings,
            reason: "stale",
            expectedVersion: snapshot.settings.version,
          }),
        )
      ).status,
    ).toBe(409);
  });
  it("still requires administrator permission", async () => {
    gate.mockResolvedValue({ error: "仅管理员可用" });
    expect(
      (await POST(req({ action: "validate", settings: defaultRiskSettings() })))
        .status,
    ).toBe(403);
  });
});
