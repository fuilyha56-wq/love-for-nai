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
      const result = await evaluateImageRisk({ userId, prompt, requestId: `r-${userId}` });
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
});