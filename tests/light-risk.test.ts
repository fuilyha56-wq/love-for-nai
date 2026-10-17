import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultRiskSettings, getRiskSettings, publishRiskSettings, resetRiskSettingsCache, validateRiskSettings } from "@/lib/risk-settings";
import { assertFreeGrant, evaluateLightRisk, finishLightRisk, moderationFromUpstream, rebindFreeGrant, registerRiskRequest, resetLightRisk, riskUserSnapshot } from "@/lib/light-risk";
import { resolveClientIp } from "@/lib/risk-ip";
import { resetRuntimeConfigCache } from "@/lib/runtime-config";
import { RequestUsageIndex } from "@/lib/request-usage-index";

let directory = "";
const original = { ...process.env };
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-light-risk-"));
  process.env.LFN_DATA_DIR = directory; process.env.LFN_TRUST_PROXY = "true"; process.env.LFN_RISK_HASH_SECRET = "test-risk-key-never-use-in-production";
  resetLightRisk(); resetRiskSettingsCache();
});
afterEach(async () => { vi.useRealTimers(); resetLightRisk(); resetRiskSettingsCache(); for (const key of ["LFN_DATA_DIR", "LFN_TRUST_PROXY", "LFN_RISK_HASH_SECRET"]) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } await rm(directory, { recursive: true, force: true }); });
const request = (ip = "203.0.113.8", cookie = "") => new Request("https://lfn.test/api/images/generate", { headers: { "x-real-ip": ip, ...(cookie ? { cookie } : {}) } });

describe("lightweight policy contract", () => {
  it("exposes typed defaults and seven grades, rejects unsafe and inverted settings", () => {
    const settings = defaultRiskSettings(); expect(settings.levels).toHaveLength(7); expect(settings.rules.find(r => r.id === "C01")?.points).toBe(20);
    expect(() => validateRiskSettings({ ...settings, values: { ...settings.values, "rate.perMinute": -1 } })).toThrow();
    expect(() => validateRiskSettings({ ...settings, values: { ...settings.values, "extensions.semantic": true } })).toThrow();
    settings.levels[1].minimum = 200; expect(() => validateRiskSettings(settings)).toThrow();
    const weak = defaultRiskSettings(); weak.rules[0].strong = true; expect(() => validateRiskSettings(weak)).toThrow();
  });
  it("publishes atomically with expected version, reloads and preserves rollback evidence", async () => {
    const settings = defaultRiskSettings(); settings.values["rate.perMinute"] = 42;
    const published = await publishRiskSettings(settings, (await getRiskSettings()).version, "admin-test", "测试变更");
    expect((await getRiskSettings()).values["rate.perMinute"]).toBe(42);
    await expect(publishRiskSettings(settings, "stale", "admin-test", "不应覆盖")).rejects.toThrow("策略已更新");
    resetRiskSettingsCache(); expect((await getRiskSettings()).version).toBe(published.version);
    const history = JSON.parse(await readFile(path.join(directory, "risk", "policy-history", `${published.version}.json`), "utf8")); expect(history.before.values["rate.perMinute"]).toBe(30);
  });
  it("applies only live scoped exceptions and forbids exemptions to hard controls", () => {
    const settings = defaultRiskSettings(); settings.overrides = [{ userId: 1, expiresAt: new Date(Date.now() + 60000).toISOString(), reason: "合法高频", values: { "grant.enabled": false } }];
    expect(() => validateRiskSettings(settings)).toThrow("例外仅允许");
  });
});

describe("daily authorization and privacy", () => {
  it("creates one daily authorization concurrently; alternate exit needs an explicit rebind", async () => {
    await registerRiskRequest("a", request(), 7); await registerRiskRequest("b", request(), 7);
    await Promise.all([assertFreeGrant(7, "a"), assertFreeGrant(7, "b")]);
    const first = (await riskUserSnapshot(7)).grant; expect(first?.version).toBe(1);
    await registerRiskRequest("c", request("203.0.113.9"), 7);
    await expect(assertFreeGrant(7, "c")).rejects.toMatchObject({ code: "lfn_daily_grant_mismatch" });
    const settings = structuredClone(await getRiskSettings()); settings.values["grant.minRebindSeconds"] = 0;
    await publishRiskSettings(settings, settings.version, "admin-test", "允许测试换网");
    await rebindFreeGrant(7, request("203.0.113.9"), Date.now());
    await expect(assertFreeGrant(7, "c")).resolves.toBeUndefined();
    await expect(assertFreeGrant(7, "a")).rejects.toMatchObject({ code: "lfn_daily_grant_mismatch" });
    expect((await riskUserSnapshot(7)).grant?.rebinds).toBe(1);
    const raw = await readFile(path.join(directory, "risk", "light", "grants", `7-${first!.day}.json`), "utf8"); expect(raw).not.toContain("203.0.113");
  });
  it("does not trust spoofed forwarding when trust is disabled and normalizes IPv6", async () => {
    process.env.LFN_TRUST_PROXY = "false"; resetRuntimeConfigCache(); await registerRiskRequest("unknown", request(), 8);
    await expect(assertFreeGrant(8, "unknown")).rejects.toMatchObject({ status: 503 });
    process.env.LFN_TRUST_PROXY = "true"; resetRuntimeConfigCache();
    expect(resolveClientIp(request("2001:0db8:0:0:0:0:0:1")).ip).toBe("2001:db8::1");
    expect(resolveClientIp(new Request("https://lfn.test", { headers: { "x-real-ip": "203.0.113.2", "x-forwarded-for": "198.51.100.8" } })).ip).toBe("203.0.113.2");
  });
  it("issues a signed device cookie without a separate request, and detects tampering", async () => {
    const first = await registerRiskRequest("device-1", request(), 9), headers = new Headers(); first.apply(headers);
    const cookie = headers.get("set-cookie")!; expect(cookie).toContain("HttpOnly");
    const second = await registerRiskRequest("device-2", request("203.0.113.8", cookie.split(";")[0]), 9), next = new Headers(); second.apply(next); expect(next.get("set-cookie")).toBeNull();
    const third = await registerRiskRequest("device-3", request("203.0.113.8", cookie.split(";")[0].slice(0,-1) + "x"), 9), changed = new Headers(); third.apply(changed); expect(changed.get("set-cookie")).not.toBeNull();
  });
});

describe("evidence, recovery and reliable outcomes", () => {
  it("applies a configured B03 action when the post-generation time-distribution detector fires", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T01:00:00Z"));
    const settings = structuredClone(await getRiskSettings()); settings.values["quota.baselineDays"] = 2; settings.values["quota.updateSeconds"] = 60; settings.values["behavior.minimumRecent"] = 10; settings.values["behavior.minimumHistory"] = 20;
    Object.assign(settings.rules.find(r => r.id === "B03")!, { mode: "enforce", action: "rate-limit", durationSeconds: 10 });
    await publishRiskSettings(settings, settings.version, "admin", "Configure time-distribution feedback");
    const calls = (hour: number, count: number) => Array.from({ length: 24 }, (_, i) => i === hour ? count : 0);
    await mkdir(path.join(directory, "risk/light"), { recursive: true });
    await writeFile(path.join(directory, "risk/light/user-82.json"), JSON.stringify({ baseline: { "2026-10-16": { calls: calls(0, 10), cost: 0, settlements: 10 }, "2026-10-17": { calls: calls(0, 10), cost: 0, settlements: 10 }, "2026-10-18": { calls: calls(9, 9), cost: 0, settlements: 9 } } }));
    await finishLightRisk({ userId: 82, requestId: "first", acceptedAt: Date.now(), status: 200 });
    vi.setSystemTime(Date.now() + 60001); await finishLightRisk({ userId: 82, requestId: "next", acceptedAt: Date.now(), status: 200 });
    const snapshot = await riskUserSnapshot(82); expect(snapshot.restrictions).toMatchObject([{ rule: "B03", action: "rate-limit" }]); expect(snapshot.evidence.find(e => e.rule === "B03")?.strong).toBe(false);
  });
  for (const action of ["rate-limit", "deny"] as const) it(`executes an administrator-configured ${action} for a repeated-prompt rule without upgrading evidence strength`, async () => {
    vi.useFakeTimers(); const start = Date.now();
    const settings = structuredClone(await getRiskSettings()); settings.values["rate.enabled"] = false; settings.values["prompt.minSamples"] = 2; settings.values["prompt.repeatPercent"] = 50;
    const rule = settings.rules.find(r => r.id === "B01")!; Object.assign(rule, { mode: "enforce", action, durationSeconds: 10, cooldownSeconds: 0 });
    await publishRiskSettings(settings, settings.version, "admin", "Configure a short repeated-prompt action");
    expect((await evaluateLightRisk({ userId: 80, requestId: "one", prompt: "blue sky" })).decision).toBe("allow");
    vi.setSystemTime(start + 1000); expect((await evaluateLightRisk({ userId: 80, requestId: "two", prompt: "blue sky" })).decision).toBe(action);
    const snapshot = await riskUserSnapshot(80); expect(snapshot.evidence[0].strong).toBe(false); const expires = snapshot.restrictions[0].expiresAt;
    vi.setSystemTime(start + 2000); await evaluateLightRisk({ userId: 80, requestId: "retry", prompt: "blue sky" }); expect((await riskUserSnapshot(80)).restrictions[0].expiresAt).toBe(expires);
    resetLightRisk(); expect((await evaluateLightRisk({ userId: 80, requestId: "restart" })).decision).toBe(action);
    vi.setSystemTime(expires + 1); expect((await evaluateLightRisk({ userId: 80, requestId: "expired" })).decision).toBe("allow");
  });
  it("keeps a configured action inactive while the rule is in observation mode", async () => {
    const settings = structuredClone(await getRiskSettings()); settings.values["rate.enabled"] = false; settings.values["prompt.minSamples"] = 2; settings.values["prompt.repeatPercent"] = 50;
    Object.assign(settings.rules.find(r => r.id === "B01")!, { mode: "observe", action: "deny" });
    await publishRiskSettings(settings, settings.version, "admin", "Observe the rule before enforcing it");
    await evaluateLightRisk({ userId: 81, requestId: "one", prompt: "blue sky" });
    expect((await evaluateLightRisk({ userId: 81, requestId: "two", prompt: "blue sky" })).decision).toBe("allow"); expect((await riskUserSnapshot(81)).restrictions).toHaveLength(0);
  });
  it("compares exact hashes across independent operations, never stores raw prompts or punishes duplication alone", async () => {
    const prompt = "private text 928374 keep out of persisted diagnostics";
    const settings = structuredClone(await getRiskSettings()); settings.values["rate.enabled"] = false;
    await publishRiskSettings(settings, settings.version, "admin-test", "测试精确摘要");
    let last;
    for (let i = 0; i < 5; i++) last = await evaluateLightRisk({ userId: i % 3 + 20, requestId: `unique-${i}`, prompt });
    expect(last?.signals.some(s => s.rule === "B02")).toBe(true); expect(last?.decision).toBe("allow");
    const raw = await readFile(path.join(directory, "risk", "light", `user-${(4 % 3) + 20}.json`), "utf8"); expect(raw).not.toContain(prompt);
    const repeated = await evaluateLightRisk({ userId: 21, requestId: "unique-4", prompt }); expect(repeated.signals).toHaveLength(0);
  });
  it("only counts trusted explicit moderation; 403, 429 and 5xx do not manufacture violations", async () => {
    expect(await moderationFromUpstream({ error: { code: "upstream_403" } })).toBeUndefined();
    expect(await moderationFromUpstream({ error: { code: "content_policy_violation" } })).toBe("denied");
    for (const [i, status] of [403, 429, 500, 503].entries()) await finishLightRisk({ userId: 30, requestId: `ordinary-${i}`, status, acceptedAt: Date.now() });
    expect((await riskUserSnapshot(30)).evidence).toHaveLength(0);
  });
  it("applies a fixed cooldown after independent confirmed denials, survives restart, and never extends on retries", async () => {
    vi.useFakeTimers(); const start = Date.now();
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(start + i * 2000); const acceptedAt = Date.now();
      vi.setSystemTime(acceptedAt + 100); await finishLightRisk({ userId: 31, requestId: `denial-${i}`, status: 403, acceptedAt, moderation: "denied" });
    }
    const before = await riskUserSnapshot(31); expect(before.restrictions).toHaveLength(1); const expiresAt = before.restrictions[0].expiresAt;
    for (let i = 0; i < 4; i++) { vi.setSystemTime(start + 10000 + i * 1000); expect((await evaluateLightRisk({ userId: 31, requestId: `blocked-${i}` })).decision).toBe("deny"); }
    expect((await riskUserSnapshot(31)).restrictions[0].expiresAt).toBe(expiresAt);
    resetLightRisk(); expect((await evaluateLightRisk({ userId: 31, requestId: "after-restart" })).decision).toBe("deny");
    const settings = structuredClone(await getRiskSettings()); settings.values["global.enabled"] = false; await publishRiskSettings(settings, settings.version, "admin-test", "关闭新检测不解除旧处置");
    expect((await evaluateLightRisk({ userId: 31, requestId: "disabled-detector" })).decision).toBe("deny");
    vi.setSystemTime(expiresAt + 1); expect((await evaluateLightRisk({ userId: 31, requestId: "expired" })).decision).toBe("allow");
  });
  it("does not label already in-flight requests as attempts after feedback", async () => {
    vi.useFakeTimers(); const acceptedAt = Date.now();
    for (let i = 0; i < 6; i++) { vi.setSystemTime(acceptedAt + 1000 + i * 1000); await finishLightRisk({ userId: 32, requestId: `inflight-${i}`, acceptedAt, status: 403, moderation: "denied" }); }
    expect((await riskUserSnapshot(32)).restrictions).toHaveLength(0);
  });
  it("counts retained usage windows with duplicate and out-of-order events", () => {
    const index = new RequestUsageIndex(); const now = Date.now(); index.add(5, now, "now"); index.add(5, now - 8 * 86400000, "old"); index.add(5, now + 1000, "future"); index.add(5, now, "now");
    expect(index.summary(5, now)).toMatchObject({ requests5h: 1, requests7d: 1, requests30d: 2, retainedRecords: 2 });
  });
});
