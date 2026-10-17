import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRequestAudit, recordImageRequestUsage, requestRankings, startRequestAudit } from "@/lib/request-audit";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";
import { dailyImageBillingState } from "@/lib/daily-image-billing";

const originalDataDir = process.env.LFN_DATA_DIR;
const originalSecret = process.env.LFN_RISK_HASH_SECRET;
afterEach(() => {
  resetRuntimeConfigCache();
  if (originalSecret) process.env.LFN_RISK_HASH_SECRET = originalSecret; else delete process.env.LFN_RISK_HASH_SECRET;
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("request audit", () => {
  it("does not add independently billed NewAPI images to local daily tiers", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-paid-audit-"));
    resetRuntimeConfigCache();
    const audit = await startRequestAudit({ request: new Request("https://love-for-nai.test"), source: "api", endpoint: "/v1/images/generations", userId: 19, model: "nai-v5-full", operation: "generate", parameters: { width: 832, height: 1216, steps: 28, n: 1 } });
    await audit.finish({ status: 200, paymentSource: "newapi", generatedSamples: 1 });
    expect((await dailyImageBillingState(19)).counts.v5).toBe(0);
  });
  it("stores a stable safe fingerprint and redacts sensitive/image bodies", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-audit-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ trustProxy: true });
    process.env.LFN_RISK_HASH_SECRET = "audit-test-only-key";
    const request = new Request("https://love-for-nai.test/v1/images/generations", {
      headers: { "x-forwarded-for": "203.0.113.8", "user-agent": "test-agent", authorization: "Bearer secret" },
    });
    const audit = await startRequestAudit({ request, source: "api", endpoint: "/v1/images/generations", userId: 4, parameters: { prompt: "hello", token: "secret", image: "data:image/png;base64,aGVsbG8=" } });
    await audit.finish({ status: 200, historyIds: ["image-1"] });
    const stored = await findRequestAudit(audit.requestId);
    expect(stored).toMatchObject({ requestId: audit.requestId, status: 200, historyIds: ["image-1"] });
    expect(stored?.parameters.token).toBe("[redacted]");
    expect(stored?.parameters.image).toMatchObject({ type: "image", bytes: 5 });
    expect(stored?.clientIpHash).toHaveLength(64);
    expect(audit.responseHeaders().get("X-LFN-Request-ID")).toBe(audit.requestId);
  });

  it("aggregates user, time and model rankings and switches to Anlas metric", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-ranking-"));
    const now = Date.now();
    const make = async (userId: number, model: string, createdAt: string, anlas: number) => {
      const audit = await startRequestAudit({ request: new Request("https://love-for-nai.test"), source: "api", endpoint: "/v1/images/generations", userId, username: `user-${userId}`, model });
      await audit.finish({ createdAt, billing: { gatewayAnlasCost: anlas }, status: 200 });
    };
    await make(1, "nai-v5-full", new Date(now - 60_000).toISOString(), 4);
    await make(1, "nai-v5-full", new Date(now - 120_000).toISOString(), 1);
    await make(2, "gemini-image", new Date(now - 3_600_000).toISOString(), 20);
    await expect(requestRankings(1, "calls", now)).resolves.toMatchObject({ totalCalls: 3, users: [{ userId: 1, calls: 2 }, { userId: 2, calls: 1 }] });
    await expect(requestRankings(1, "anlas", now)).resolves.toMatchObject({ totalAnlas: 25, users: [{ userId: 2, anlas: 20 }, { userId: 1, anlas: 5 }] });
    const timeline = await requestRankings(1, "calls", now);
    expect(timeline.times.flatMap(t => t.users || []).map(u => u.username)).toContain("user-1");
    expect(timeline.times.flatMap(t => t.users || []).reduce((sum,u) => sum+u.calls,0)).toBe(3);
  });

  it("merges usage-only calls, deduplicates request IDs, and leaves unknown Anlas uncovered", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-ranking-usage-"));
    const now = Date.now();
    await recordImageRequestUsage(7, "same-request", now - 2_000, { username: "studio", model: "nai-v5-full", source: "lfn" });
    await recordImageRequestUsage(7, "same-request", now - 1_000, { username: "studio", model: "nai-v5-full", source: "lfn" });
    await recordImageRequestUsage(8, "unknown-anlas", now - 3_000, { username: "api-user", model: "other", source: "api" });
    const rankings = await requestRankings(1, "anlas", now, { source: "lfn" });
    expect(rankings).toMatchObject({ totalCalls: 1, anlasRecords: 0, totalAnlas: 0, users: [{ userId: 7, calls: 1, anlasRecords: 0 }] });
    await expect(requestRankings(1, "calls", now, { source: "api" })).resolves.toMatchObject({ totalCalls: 1, users: [{ userId: 8, calls: 1 }] });
  });

  it("审计完成时保留轻量事件中已经确认的 Anlas", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-ranking-merge-"));
    const audit = await startRequestAudit({ request: new Request("https://love-for-nai.test"), source: "lfn", endpoint: "/api/images/generate", userId: 9, username: "studio", model: "nai-v5-full" });
    expect(audit.requestId).toBeTruthy();
    await recordImageRequestUsage(9, audit.requestId, audit.startedAt, { username: "studio", model: "nai-v5-full", source: "lfn", anlas: 7 });
    await audit.finish({ status: 200 });
    const rankings = await requestRankings(1, "anlas", Date.now());
    expect(rankings).toMatchObject({ anlasRecords: 1, totalAnlas: 7, totalCalls: 1 });
  });
});
