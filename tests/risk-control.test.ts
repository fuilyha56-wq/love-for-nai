import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lfn-risk-"));
  process.env.LFN_DATA_DIR = dataDir;
  process.env.LFN_RISK_HASH_SECRET = "risk-test-secret";
  process.env.LFN_IP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.LFN_TRUST_PROXY = "true";
  process.env.LFN_RISK_ENABLED = "true";
});

afterEach(async () => {
  delete process.env.LFN_DATA_DIR;
  delete process.env.LFN_RISK_HASH_SECRET;
  delete process.env.LFN_IP_ENCRYPTION_KEY;
  delete process.env.LFN_TRUST_PROXY;
  delete process.env.LFN_RISK_ENABLED;
  await rm(dataDir, { recursive: true, force: true });
});

describe("风险控制核心", () => {
  it("未配置 HMAC 密钥时旁路，不影响请求", async () => {
    delete process.env.LFN_RISK_HASH_SECRET;
    const { evaluateImageRisk } = await import("@/lib/risk-control");
    await expect(evaluateImageRisk({ userId: 1, prompt: "test prompt" })).resolves.toMatchObject({
      decision: "allow",
      level: "normal",
    });
  });

  it("封禁用户在风控层返回 deny", async () => {
    const { evaluateImageRisk, setRiskBlocked } = await import("@/lib/risk-control");
    await setRiskBlocked(42, true, "测试封禁", "admin");
    await expect(evaluateImageRisk({ userId: 42, prompt: "test prompt" })).resolves.toMatchObject({
      decision: "deny",
      level: "banned",
    });
  });

  it("同一提示词达到跨账号阈值后生成风险信号", async () => {
    const { evaluateImageRisk } = await import("@/lib/risk-control");
    const prompt = "a detailed landscape with a red house";
    for (const [index, userId] of [1, 2, 3, 4, 1].entries()) {
      const result = await evaluateImageRisk({ userId, prompt, requestId: `r-${userId}-${index}` });
      if (index === 4) expect(result.signalIds.some((id) => id.startsWith("duplicate:"))).toBe(true);
    }
  });

  it("统计用户 5 小时、7 天和 30 天调用量，并按请求 ID 去重", async () => {
    const { recordImageRequestUsage, requestUsageByUser } = await import("@/lib/request-audit");
    const now = Date.now();
    await recordImageRequestUsage(71, "req-current", now - 60_000);
    await recordImageRequestUsage(71, "req-current", now - 30_000);
    await recordImageRequestUsage(71, "req-8d", now - 8 * 24 * 60 * 60_000);
    const usage = await requestUsageByUser(now);
    expect(usage.get(71)).toMatchObject({ requests5h: 1, requests7d: 1, requests30d: 2, retainedRecords: 2 });
  });

  it("达到高调用量阈值时创建单窗口 high-frequency 信号", async () => {
    const { recordImageRequestUsage } = await import("@/lib/request-audit");
    const { evaluateImageRisk } = await import("@/lib/risk-control");
    const now = Date.now();
    for (let index = 0; index < 79; index += 1)
      await recordImageRequestUsage(72, `volume-${index}`, now - 1_000 + index);
    const first = await evaluateImageRisk({ userId: 72, requestId: "volume-trigger", now });
    const second = await evaluateImageRisk({ userId: 72, requestId: "volume-next", now: now + 1_000 });
    expect(first.signalIds.some((id) => id.startsWith("volume:72:"))).toBe(true);
    expect(first.usage?.requests5h).toBe(80);
    expect(second.signalIds.some((id) => id.startsWith("volume:72:"))).toBe(false);
  });

  it("保存观察阈值后立即生效，并可在缓存重置后恢复", async () => {
    const { evaluateImageRisk, getRiskPolicy, resetRiskPolicyCache, updateRiskPolicy } = await import("@/lib/risk-control");
    const { recordImageRequestUsage } = await import("@/lib/request-audit");
    const now = Date.now();
    await updateRiskPolicy({ sameUserEnabled: true, sameUserMaxRequests: 2, sameUserAction: "observe", sameUserScore: 25 });
    await evaluateImageRisk({ userId: 73, prompt: "repeat", requestId: "repeat-1", now: now - 1_000 });
    await recordImageRequestUsage(73, "repeat-2", now);
    await expect(evaluateImageRisk({ userId: 73, prompt: "repeat", requestId: "repeat-3", now })).resolves.toMatchObject({ decision: "allow" });
    resetRiskPolicyCache();
    await expect(getRiskPolicy()).resolves.toMatchObject({ sameUserMaxRequests: 2, sameUserAction: "observe" });
  });

  it("高调用量仅观察，关闭自动检测不绕过手动封禁", async () => {
    const { evaluateImageRisk, updateRiskPolicy, setRiskBlocked } = await import("@/lib/risk-control");
    await updateRiskPolicy({ sameUserEnabled: false, highVolume5hRequests: 1, highVolumeAction: "observe" });
    await expect(evaluateImageRisk({ userId: 91, requestId: "one" })).resolves.toMatchObject({ decision: "allow" });
    await expect(evaluateImageRisk({ userId: 91, requestId: "two" })).resolves.toMatchObject({ decision: "allow", signalIds: [] });
    await setRiskBlocked(91, true, "manual");
    await updateRiskPolicy({ enabled: false });
    delete process.env.LFN_RISK_HASH_SECRET;
    await expect(evaluateImageRisk({ userId: 91, requestId: "three" })).resolves.toMatchObject({ decision: "deny" });
  });

  it("拒绝非法动作、布尔值、阈值及倒置分数线", async () => {
    const { updateRiskPolicy } = await import("@/lib/risk-control");
    await expect(updateRiskPolicy({ highVolume5hRequests: 0 })).rejects.toThrow();
    await expect(updateRiskPolicy({ enabled: "false" as never })).rejects.toThrow();
    await expect(updateRiskPolicy({ sameUserAction: "invalid" as never })).rejects.toThrow();
    await expect(updateRiskPolicy({ riskScore: 90, criticalScore: 80 })).rejects.toThrow();
  });
});

describe("IP 证据", () => {
  it("加密保存 IP，不在证据文件中写入明文", async () => {
    const { recordIpEvidence, revealIpEvidence } = await import("@/lib/risk-ip");
    const evidence = await recordIpEvidence(
      new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.42" } }),
      "request-1",
      7,
      "tester",
    );
    expect(evidence?.encryptedIp).toBeTruthy();
    const raw = await readFile(path.join(dataDir, "risk", "ip-evidence.json"), "utf8");
    expect(raw).not.toContain("203.0.113.42");
    await expect(revealIpEvidence(evidence!.evidenceId)).resolves.toBe("203.0.113.42");
  });

  it("同一 IP 会保留多个用户归属", async () => {
    const { recordIpEvidence } = await import("@/lib/risk-ip");
    const request = () => new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.42" } });
    const first = await recordIpEvidence(request(), "request-1", 7, "first");
    const second = await recordIpEvidence(request(), "request-2", 8, "second");
    expect(second?.evidenceId).toBe(first?.evidenceId);
    expect(second?.userIds).toEqual([7, 8]);
  });

  it("升级旧单用户证据时不会丢失原归属", async () => {
    const { recordIpEvidence } = await import("@/lib/risk-ip");
    const request = () => new Request("http://localhost", { headers: { "x-forwarded-for": "198.51.100.24" } });
    const first = await recordIpEvidence(request(), "legacy-request-1", 11, "legacy");
    const filePath = path.join(dataDir, "risk", "ip-evidence.json");
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Array<{ userId?: number; userIds?: number[] }>;
    delete raw[0].userIds;
    await (await import("node:fs/promises")).writeFile(filePath, JSON.stringify(raw), "utf8");
    const upgraded = await recordIpEvidence(request(), "legacy-request-2", 12, "new");
    expect(upgraded?.evidenceId).toBe(first?.evidenceId);
    expect(upgraded?.userIds).toEqual([11, 12]);
  });
});