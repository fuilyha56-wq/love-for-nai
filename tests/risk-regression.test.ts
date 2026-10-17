import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { RequestUsageIndex } from "@/lib/request-usage-index";
import { readRiskJson, validRiskMutation } from "@/lib/risk-http";
import { getRiskSettings, publishRiskSettings, resetRiskSettingsCache } from "@/lib/risk-settings";
import { submitRiskAccessRequest, decideRiskAccessRequest } from "@/lib/risk-access";
import { resetLightRisk, evaluateLightRisk, finishLightRisk, riskUserSnapshot, confirmRiskEvidence, releaseRiskRestriction } from "@/lib/light-risk";
import { evaluateImageRisk, setRiskBlocked } from "@/lib/risk-control";
import { recordImageRequestUsage } from "@/lib/request-audit";
import { maintainRiskStorage } from "@/lib/risk-maintenance";
let directory: string;
const original = process.env.LFN_DATA_DIR;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "lfn-risk-regression-")); process.env.LFN_DATA_DIR = directory; resetRiskSettingsCache(); resetLightRisk(); });
afterEach(async () => { process.env.LFN_DATA_DIR = original; if (!original) delete process.env.LFN_DATA_DIR; resetRiskSettingsCache(); resetLightRisk(); await rm(directory, { recursive: true, force: true }); });
describe("risk release regressions", () => {
  it("can disable high-frequency admission and applications without clearing manual bans",async()=>{
    const s=structuredClone(await getRiskSettings());s.values["trust.enabled"]=false;s.values["rate.burst"]=1;
    await publishRiskSettings(s,s.version,"admin","disable optional high frequency gate");
    for(let i=0;i<4;i++)expect((await evaluateLightRisk({userId:716,requestId:`no-gate-${i}`,now:1000000+i})).decision).toBe("allow");
    await expect(submitRiskAccessRequest(716,{reason:"test",perMinute:30,concurrency:2,hours:1})).rejects.toThrow("已关闭");
    await setRiskBlocked(716,true,"manual decision");expect((await evaluateImageRisk({userId:716})).decision).toBe("deny");
  });
  it("starts fresh observation after a reset without deleting old billing usage",async()=>{
    const now=Date.now();for(let i=0;i<85;i++)await recordImageRequestUsage(717,`before-reset-${i}`,now-3600000);
    await mkdir(path.join(directory,"risk"),{recursive:true});await writeFile(path.join(directory,"risk/marks-reset.json"),JSON.stringify({at:new Date(now-60000).toISOString()}));
    const result=await evaluateImageRisk({userId:717,requestId:"after-reset",now});
    expect(result.signalIds).toEqual([]);expect(result.usage?.requests5h).toBe(86);
  });
  it("rejects cookie-only cross-site, absent-origin and malformed-origin writes and oversized JSON", async () => {
    const req = (origin?: string, type = "application/json") => new Request("https://lfn.test/api/admin/risk/settings", { method: "POST", headers: { "content-type": type, ...(origin ? { origin } : {}) }, body: "{}" });
    expect(validRiskMutation(req("https://lfn.test"))).toBe(true);
    for (const r of [req(), req("https://evil.test"), req("null"), req("https://lfn.test", "text/plain")]) expect(validRiskMutation(r)).toBe(false);
    await expect(readRiskJson(new Request("https://lfn.test", { method: "POST", body: "x".repeat(5000) }), 1000)).rejects.toThrow("过大");
  });
  it("matches brute-force exact counts through out-of-order inserts, duplicate timestamps and capacity eviction", () => {
    const capacity = 300, index = new RequestUsageIndex(capacity); const expected: Array<{ user: number; at: number }> = [];
    for (let i = 0; i < 10000; i++) {
      const user = i % 7 + 1, at = i * 13 % 1009; index.add(user, at, String(i)); expected.push({ user, at }); if (expected.length > capacity) expected.shift();
      if (i % 17 === 0) for (let owner = 1; owner <= 7; owner++) expect(index.count(owner, 123, 567)).toBe(expected.filter(e => e.user === owner && e.at >= 444 && e.at <= 567).length);
    }
  });
  it("approves a limited high-frequency grant, expires it and revokes only its own override", async () => {
    const entry = await submitRiskAccessRequest(711, { reason: "正常批量创作", perMinute: 50, concurrency: 10, hours: 2 });
    await expect(submitRiskAccessRequest(711, { reason: "重复", perMinute: 50, concurrency: 10, hours: 2 })).rejects.toThrow("频繁");
    const approved = await decideRiskAccessRequest(entry.id, "approve", "admin", "已核对用途");
    expect(approved.expiresAt).toBeTruthy(); expect((await getRiskSettings(711)).values["rate.perMinute"]).toBe(50);
    await decideRiskAccessRequest(entry.id, "revoke", "admin", "用户结束批量任务");
    expect((await getRiskSettings(711)).values["rate.perMinute"]).toBe(30);
  });
  it("cannot approve high-frequency access for a manually banned account", async () => {
    const entry = await submitRiskAccessRequest(712, { reason: "申请", perMinute: 50, concurrency: 10, hours: 2 });
    await setRiskBlocked(712, true, "已确认滥用", "admin");
    await expect(decideRiskAccessRequest(entry.id, "approve", "admin", "尝试审批")).rejects.toThrow("风险");
  });
  it("audits explicit manual facts without retaining the reference, and releases only the selected restriction", async () => {
    const originalSecret = process.env.LFN_RISK_HASH_SECRET; process.env.LFN_RISK_HASH_SECRET = "regression-only-secret";
    try {
      const s = structuredClone(await getRiskSettings());
      for (const id of ["R01", "G01"]) { const rule = s.rules.find(r => r.id === id)!; rule.mode = "enforce"; rule.action = "deny"; }
      await publishRiskSettings(s, s.version, "admin", "独立核验测试");
      await confirmRiskEvidence(715, "R01", "internal-case-one", 1); await confirmRiskEvidence(715, "G01", "internal-case-two", 1);
      const snapshot = await riskUserSnapshot(715); expect(snapshot.restrictions).toHaveLength(2);
      await releaseRiskRestriction(715, snapshot.restrictions[0].id); expect((await riskUserSnapshot(715)).restrictions).toHaveLength(1);
      await confirmRiskEvidence(715, "R01", "internal-case-one", 1); expect((await riskUserSnapshot(715)).restrictions).toHaveLength(1);
      expect(await readFile(path.join(directory, "risk", "light", "user-715.json"), "utf8")).not.toContain("internal-case-one");
    } finally { if (originalSecret) process.env.LFN_RISK_HASH_SECRET = originalSecret; else delete process.env.LFN_RISK_HASH_SECRET; }
  });
  it("does not create new evidence while global detection is disabled", async () => {
    const s = structuredClone(await getRiskSettings()); s.values["global.enabled"] = false; await publishRiskSettings(s, s.version, "admin", "关闭新检测");
    await finishLightRisk({ userId: 713, requestId: "disabled", status: 403, moderation: "denied", acceptedAt: Date.now() });
    expect((await riskUserSnapshot(713)).evidence).toHaveLength(0);
  });
  it("shares user admission state across isolated module instances", async () => {
    const s = structuredClone(await getRiskSettings()); s.values["rate.burst"] = 1; await publishRiskSettings(s, s.version, "admin", "准入共享验证");
    expect((await evaluateLightRisk({ userId: 714, requestId: "first", now: 1000000 })).decision).toBe("allow");
    // Module reload models independently compiled route bundles in one Node process.
    const { vi } = await import("vitest"); vi.resetModules();
    const fresh = await import("@/lib/light-risk");
    expect((await fresh.evaluateLightRisk({ userId: 714, requestId: "second", now: 1000001 })).decision).toBe("rate-limit");
  });
  it("retains financial data while expiring only owned old diagnostic/grant names", async () => {
    const journal = path.join(directory, "request-audit", "journal"), grants = path.join(directory, "risk", "light", "grants");
    await mkdir(journal, { recursive: true }); await mkdir(grants, { recursive: true });
    await writeFile(path.join(journal, "1000-abcdef.jsonl"), "{}\n"); await writeFile(path.join(journal, "keep.json"), "{}"); await writeFile(path.join(grants, "12-2000-01-01.json"), "{}");
    await writeFile(path.join(directory, "financial-ledger.json"), "{}");
    await maintainRiskStorage(); expect(await readdir(journal)).toEqual(["keep.json"]); expect(await readdir(grants)).toEqual([]); expect(await readFile(path.join(directory, "financial-ledger.json"), "utf8")).toBe("{}");
  });
});
