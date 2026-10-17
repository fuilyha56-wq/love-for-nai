import { expect, it } from "vitest";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { RequestUsageIndex } from "@/lib/request-usage-index";
import { evaluateLightRisk, finishLightRisk, registerRiskRequest, resetLightRisk } from "@/lib/light-risk";
import { getRiskSettings, publishRiskSettings, resetRiskSettingsCache } from "@/lib/risk-settings";

it("records bounded hot-account and light-admission microbenchmarks without a flaky timing gate", async () => {
  const index = new RequestUsageIndex(100000), start = performance.now();
  for (let i = 0; i < 200000; i++) { index.add(1, i, String(i)); index.count(1, 1000, i); }
  const counterMs = performance.now() - start;
  expect(index.summary(1, 200000).retainedRecords).toBe(100000);
  const original = { dir: process.env.LFN_DATA_DIR, secret: process.env.LFN_RISK_HASH_SECRET }, directory = await mkdtemp(path.join(os.tmpdir(), "lfn-risk-bench-"));
  try {
    process.env.LFN_DATA_DIR = directory; process.env.LFN_RISK_HASH_SECRET = "benchmark-only-not-a-real-key"; resetRiskSettingsCache(); resetLightRisk();
    const settings = structuredClone(await getRiskSettings()); settings.values["rate.perMinute"] = 10000; settings.values["rate.burst"] = 1000; await publishRiskSettings(settings, settings.version, "benchmark", "测量准入开销");
    const times: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const before = performance.now(), userId = i % 50 + 1, requestId = `benchmark-${i}`;
      await registerRiskRequest(requestId, new Request("http://localhost/api/images/generate"), userId);
      expect((await evaluateLightRisk({ userId, requestId, prompt: "synthetic fixture repeated prompt" })).decision).toBe("allow");
      await finishLightRisk({ userId, requestId, acceptedAt: Date.now(), status: 200 }); times.push(performance.now() - before);
    }
    times.sort((a,b) => a-b);
    const result = { counter: { operations: 200000, capacity: 100000, totalMs: counterMs, meanMicroseconds: counterMs * 1000 / 200000 }, light: { operations: times.length, activeAccounts: 50, p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], p99Ms: times[Math.floor(times.length * .99)] }, scope: "local warm process; excludes upstream, legacy case persistence, TLS and real network latency" };
    await mkdir(path.resolve(".tmp"), { recursive: true }); await writeFile(path.resolve(".tmp", "risk-benchmark.json"), JSON.stringify(result, null, 2));
  } finally {
    if (original.dir) process.env.LFN_DATA_DIR = original.dir; else delete process.env.LFN_DATA_DIR;
    if (original.secret) process.env.LFN_RISK_HASH_SECRET = original.secret; else delete process.env.LFN_RISK_HASH_SECRET;
    resetRiskSettingsCache(); resetLightRisk(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
