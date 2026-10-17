import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const upstream = vi.hoisted(() => ({ send: vi.fn(), userId: 801 as number | null, configured: true, allowedModels: undefined as string[] | undefined, fallback: vi.fn() }));
vi.mock("@/lib/newapi-db", () => ({ resolveExternalApiIdentity: vi.fn(async () => ({ userId: upstream.userId, username: "billing-test", allowedModels: upstream.allowedModels })), ensureManagedFallbackToken: upstream.fallback }));
vi.mock("@/lib/newapi", () => ({ resolvedImageUpstream: vi.fn(async () => upstream.configured ? { baseUrl: "https://fixture.invalid", token: "fixture-token" } : null), resolvedNewApiBaseUrl: vi.fn(async () => "https://fallback.invalid"), resolvedNaiAccountUpstream: vi.fn(async () => null), resolvedNaiImageUpstream: vi.fn(async () => null) }));
vi.mock("@/lib/model-concurrency", () => ({ fetchWithModelConcurrency: upstream.send }));
vi.mock("@/lib/adapters/registry", () => ({ registry: { getImageAdapter: vi.fn(async () => null) } }));
vi.mock("@/lib/risk-control", () => ({ evaluateImageRisk: vi.fn(async () => ({ decision: "allow", level: "normal", score: 0, signalIds: [] })) }));
vi.mock("@/lib/image-watermark", () => ({ watermarkImages: vi.fn(async (images: string[]) => ({ images, status: "disabled" })) }));
vi.mock("@/lib/gateway-log", () => ({ gatewayLogStart: () => () => undefined, maskKeyForLog: () => "masked" }));
vi.mock("@/lib/runtime-config", async original => ({ ...await original<typeof import("@/lib/runtime-config")>(), isNaiModelEnabled: vi.fn(async () => true) }));
import { POST } from "@/app/v1/images/generations/route";
import { dailyImageBillingState, reserveDailyImageQuote } from "@/lib/daily-image-billing";
import { affStatus } from "@/lib/aff";
import { flushRequestAudits } from "@/lib/request-audit";
import { resetLightRisk } from "@/lib/light-risk";
import { resetRiskSettingsCache } from "@/lib/risk-settings";
import { resetRuntimeConfigCache } from "@/lib/runtime-config";
let directory = "";
const saved = { ...process.env };
const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=";
const invoke = (key: string) => POST(new Request("https://lfn.test/v1/images/generations", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-real-ip": "203.0.113.71" }, body: JSON.stringify({ ...generation, prompt: "billing fixture", size: "832x1216", n: 1 }) }));
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-api-tier-")); process.env.LFN_DATA_DIR = directory; process.env.LFN_TRUST_PROXY = "true"; process.env.LFN_RISK_HASH_SECRET = "test-key-only";
  resetLightRisk(); resetRiskSettingsCache(); resetRuntimeConfigCache(); upstream.userId = 801; upstream.configured = true; upstream.allowedModels = undefined; upstream.send.mockReset(); upstream.fallback.mockReset();
  upstream.send.mockImplementation(async () => Response.json({ data: [{ b64_json: png }] }));
  await mkdir(path.join(directory, "aff"), { recursive: true }); await writeFile(path.join(directory, "aff", "801.json"), JSON.stringify({ balance: 1000, packageBalance: 0, transactions: [], packageUsage: [], packageOrders: [] }));
});
afterEach(async () => { await flushRequestAudits(); resetLightRisk(); resetRiskSettingsCache(); resetRuntimeConfigCache(); for (const key of ["LFN_DATA_DIR", "LFN_TRUST_PROXY", "LFN_RISK_HASH_SECRET"]) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } await rm(directory, { recursive: true, force: true }); });
describe("API tiers with real local wallet and daily reservations", () => {
  it("actually debits across the V5 50th boundary and shares counts across API keys", async () => {
    await reserveDailyImageQuote(801, { ...generation, samples: 30, sequential: true }, "earlier-30"); await reserveDailyImageQuote(801, { ...generation, samples: 19, sequential: true }, "earlier-19");
    const first = await invoke("first-key"); expect(first.status).toBe(200); expect(first.headers.get("X-LFN-Payment-Source")).toBe("personal"); await first.json();
    expect((await affStatus(801)).balance).toBe(996);
    const second = await invoke("second-key"); expect(second.status).toBe(200); await second.json();
    expect((await affStatus(801)).balance).toBe(991.6); expect((await dailyImageBillingState(801)).counts.v5).toBe(51);
    const account = JSON.parse(await readFile(path.join(directory, "aff", "801.json"), "utf8")); expect(account.transactions.filter((t: { type: string }) => t.type === "generation").map((t: { amount: number }) => t.amount)).toEqual([-4.4, -4]);
  });
  it("does not silently charge NewAPI when local credits are insufficient", async () => {
    await writeFile(path.join(directory, "aff", "801.json"), JSON.stringify({ balance: 0, packageBalance: 0, transactions: [] }));
    const response = await invoke("no-balance"); expect(response.status).toBe(402); expect(upstream.send).not.toHaveBeenCalled(); expect(upstream.fallback).not.toHaveBeenCalled();
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it("does not execute an unowned key or missing local channel through a different pricing policy", async () => {
    upstream.userId = null; expect((await invoke("unknown-owner")).status).toBe(503); expect(upstream.send).not.toHaveBeenCalled();
    upstream.userId = 801; upstream.configured = false; expect((await invoke("missing-local-channel")).status).toBe(503); expect(upstream.send).not.toHaveBeenCalled();
  });
  it("refunds a failed upstream at the original tier and releases its daily reservation", async () => {
    upstream.send.mockImplementation(async () => Response.json({ error: { code: "upstream_error" } }, { status: 502 }));
    const response = await invoke("upstream-failure"); expect(response.status).toBe(502); expect((await affStatus(801)).balance).toBe(1000); expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it("refuses a key outside its model scope without touching wallet or upstream", async () => {
    upstream.allowedModels = ["nai-v4.5-full"];
    const response = await invoke("restricted-key"); expect(response.status).toBe(403); expect(upstream.send).not.toHaveBeenCalled();
    expect((await affStatus(801)).balance).toBe(1000); expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });

});
