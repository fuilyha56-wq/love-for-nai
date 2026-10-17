import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import { decode, encode } from "@msgpack/msgpack";
const upstream = vi.hoisted(() => ({
  send: vi.fn(),
  userId: 801 as number | null,
  configured: true,
  native: false,
  allowedModels: undefined as string[] | undefined,
  fallback: vi.fn(),
}));
vi.mock("@/lib/newapi-db", () => ({
  resolveExternalApiIdentity: vi.fn(async () => ({
    userId: upstream.userId,
    username: "billing-test",
    allowedModels: upstream.allowedModels,
  })),
  ensureManagedFallbackToken: upstream.fallback,
}));
vi.mock("@/lib/newapi", () => ({
  resolvedImageUpstream: vi.fn(async () =>
    upstream.configured
      ? { baseUrl: "https://fixture.invalid", token: "fixture-token" }
      : null,
  ),
  resolvedNewApiBaseUrl: vi.fn(async () => "https://fallback.invalid"),
  resolvedNaiAccountUpstream: vi.fn(async () => null),
  resolvedNaiImageUpstream: vi.fn(async () =>
    upstream.native
      ? { baseUrl: "https://native.invalid", token: "fixture-token" }
      : null,
  ),
}));
vi.mock("@/lib/model-concurrency", () => ({
  fetchWithModelConcurrency: upstream.send,
}));
vi.mock("@/lib/adapters/registry", () => ({
  registry: { getImageAdapter: vi.fn(async () => null) },
}));
vi.mock("@/lib/risk-control", () => ({
  evaluateImageRisk: vi.fn(async () => ({
    decision: "allow",
    level: "normal",
    score: 0,
    signalIds: [],
  })),
}));
vi.mock("@/lib/gateway-log", () => ({
  gatewayLogStart: () => () => undefined,
  maskKeyForLog: () => "masked",
}));
vi.mock("@/lib/runtime-config", async (original) => ({
  ...(await original<typeof import("@/lib/runtime-config")>()),
  isNaiModelEnabled: vi.fn(async () => true),
}));
import { POST } from "@/app/v1/images/generations/route";
import { POST as nativePOST } from "@/app/ai/generate-image/route";
import {
  dailyImageBillingState,
  reserveDailyImageQuote,
} from "@/lib/daily-image-billing";
import { affStatus } from "@/lib/aff";
import { flushRequestAudits } from "@/lib/request-audit";
import {
  freeGrantReadiness,
  resetLightRisk,
  riskUserSnapshot,
} from "@/lib/light-risk";
import { resetRiskSettingsCache } from "@/lib/risk-settings";
import { resetRuntimeConfigCache } from "@/lib/runtime-config";
import { verifyWatermark } from "@/lib/image-watermark";
let directory = "";
const saved = { ...process.env };
const generation = {
  model: "nai-v5-full",
  width: 832,
  height: 1216,
  steps: 28,
  samples: 1,
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=";
const invoke = (key: string) =>
  POST(
    new Request("https://lfn.test/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-real-ip": "203.0.113.71",
      },
      body: JSON.stringify({
        ...generation,
        prompt: "billing fixture",
        size: "832x1216",
        n: 1,
      }),
    }),
  );
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "lfn-api-tier-"));
  process.env.LFN_DATA_DIR = directory;
  process.env.LFN_TRUST_PROXY = "true";
  process.env.LFN_RISK_HASH_SECRET = "test-key-only";
  resetLightRisk();
  resetRiskSettingsCache();
  resetRuntimeConfigCache();
  upstream.userId = 801;
  upstream.configured = true;
  upstream.native = false;
  upstream.allowedModels = undefined;
  upstream.send.mockReset();
  upstream.fallback.mockReset();
  upstream.send.mockImplementation(async () =>
    Response.json({ data: [{ b64_json: png }] }),
  );
  await mkdir(path.join(directory, "aff"), { recursive: true });
  await writeFile(
    path.join(directory, "aff", "801.json"),
    JSON.stringify({
      balance: 1000,
      packageBalance: 0,
      transactions: [],
      packageUsage: [],
      packageOrders: [],
    }),
  );
});
afterEach(async () => {
  await flushRequestAudits();
  resetLightRisk();
  resetRiskSettingsCache();
  resetRuntimeConfigCache();
  for (const key of [
    "LFN_DATA_DIR",
    "LFN_TRUST_PROXY",
    "LFN_RISK_HASH_SECRET",
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await rm(directory, { recursive: true, force: true });
});
describe("API tiers with real local wallet and daily reservations", () => {
  it("returns a cryptographically valid signature through the actual OpenAI image route", async () => {
    const response = await invoke("signed-key"),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-lfn-watermark")).toBe("embedded");
    expect(
      await verifyWatermark(`data:image/png;base64,${body.data[0].b64_json}`),
    ).toMatchObject({ valid: true, shaMatch: true, payload: { userId: 801 } });
  });
  it("also signs the generic NewAPI image response without debiting the local AFF wallet", async () => {
    const response = await POST(
      new Request("https://lfn.test/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer generic-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: "signed fixture",
          size: "1024x1024",
          n: 1,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      await verifyWatermark(`data:image/png;base64,${body.data[0].b64_json}`),
    ).toMatchObject({
      valid: true,
      shaMatch: true,
      payload: { userId: 801, model: "gpt-image-2" },
    });
    expect((await affStatus(801)).balance).toBe(1000);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it.each([false, true])(
    "signs actual native API output, stream=%s, while settling the real wallet",
    async (stream) => {
      upstream.native = true;
      const bytes = new Uint8Array(Buffer.from(png, "base64"));
      if (stream) {
        const payload = encode({
            event_type: "final",
            samp_ix: 0,
            image: bytes,
          }),
          framed = new Uint8Array(4 + payload.length);
        new DataView(framed.buffer).setUint32(0, payload.length, false);
        framed.set(payload, 4);
        upstream.send.mockImplementation(
          async () =>
            new Response(framed, {
              headers: { "content-type": "application/x-msgpack" },
            }),
        );
      } else {
        const zip = new Uint8Array(
          await new JSZip()
            .file("image_0.png", bytes)
            .generateAsync({ type: "uint8array" }),
        );
        upstream.send.mockImplementation(
          async () =>
            new Response(zip, {
              headers: { "content-type": "application/zip" },
            }),
        );
      }
      const response = await nativePOST(
        new Request(
          `https://lfn.test/ai/generate-image${stream ? "-stream" : ""}`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer native-signed-key",
              "content-type": "application/json",
              "x-real-ip": "203.0.113.71",
            },
            body: JSON.stringify({
              input: "signed fixture",
              model: "nai-diffusion-4-5-full",
              action: "generate",
              parameters: { width: 832, height: 1216, steps: 28, n_samples: 1 },
            }),
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = new Uint8Array(await response.arrayBuffer());
      const image = stream
        ? (decode(body.subarray(4)) as { image: Uint8Array }).image
        : await (
            await JSZip.loadAsync(body)
          )
            .file("image_0.png")!
            .async("uint8array");
      expect(
        await verifyWatermark(
          `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
        ),
      ).toMatchObject({
        valid: true,
        shaMatch: true,
        payload: { userId: 801 },
      });
      expect((await dailyImageBillingState(801)).counts.v45).toBe(1);
      expect((await affStatus(801)).balance).toBeLessThan(1000);
    },
  );
  it("preserves trusted ingress through the native API's OpenAI compatibility path", async () => {
    const response = await nativePOST(
      new Request("https://lfn.test/ai/generate-image", {
        method: "POST",
        headers: {
          authorization: "Bearer native-test-key",
          "content-type": "application/json",
          "x-real-ip": "203.0.113.71",
        },
        body: JSON.stringify({
          input: "native billing fixture",
          model: "nai-diffusion-4-5-full",
          action: "generate",
          parameters: { width: 832, height: 1216, steps: 28, n_samples: 1 },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    await response.arrayBuffer();
    expect(upstream.send).toHaveBeenCalledTimes(1);
    expect((await riskUserSnapshot(801)).grant?.exits).toBe(1);
    expect((await dailyImageBillingState(801)).counts.v45).toBe(1);
  });
  it("detects a stale proxy configuration before release and restores real API admission after restart", async () => {
    const platform = path.join(directory, "platform", "config.json");
    await mkdir(path.dirname(platform), { recursive: true });
    await writeFile(
      platform,
      JSON.stringify({ settings: { trustProxy: false } }),
    );
    const probe = new Request("https://lfn.test/api/health", {
      headers: { "x-real-ip": "203.0.113.71" },
    });
    expect(await freeGrantReadiness(probe)).toBe(false);
    const blocked = await invoke("known-account-key");
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).error.code).toBe("lfn_source_unavailable");
    expect((await affStatus(801)).balance).toBe(1000);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
    expect(upstream.send).not.toHaveBeenCalled();

    // An offline file migration does not invalidate the live process's cache.
    await writeFile(
      platform,
      JSON.stringify({ settings: { trustProxy: true } }),
    );
    expect(await freeGrantReadiness(probe)).toBe(false);
    expect((await invoke("known-account-key")).status).toBe(503);

    // Recreating the service loads the migrated settings before accepting traffic.
    resetRuntimeConfigCache();
    expect(await freeGrantReadiness(probe)).toBe(true);
    const restored = await invoke("known-account-key");
    expect(restored.status).toBe(200);
    await restored.arrayBuffer();
    expect(upstream.send).toHaveBeenCalledTimes(1);
    expect((await affStatus(801)).balance).toBe(996);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(1);
    expect((await riskUserSnapshot(801)).grant?.exits).toBe(1);
  });
  it("actually debits across the V5 50th boundary and shares counts across API keys", async () => {
    await reserveDailyImageQuote(
      801,
      { ...generation, samples: 30, sequential: true },
      "earlier-30",
    );
    await reserveDailyImageQuote(
      801,
      { ...generation, samples: 19, sequential: true },
      "earlier-19",
    );
    const first = await invoke("first-key");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-LFN-Payment-Source")).toBe("personal");
    await first.json();
    expect((await affStatus(801)).balance).toBe(996);
    const second = await invoke("second-key");
    expect(second.status).toBe(200);
    await second.json();
    expect((await affStatus(801)).balance).toBe(991.6);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(51);
    const account = JSON.parse(
      await readFile(path.join(directory, "aff", "801.json"), "utf8"),
    );
    expect(
      account.transactions
        .filter((t: { type: string }) => t.type === "generation")
        .map((t: { amount: number }) => t.amount),
    ).toEqual([-4.4, -4]);
  });
  it("does not silently charge NewAPI when local credits are insufficient", async () => {
    await writeFile(
      path.join(directory, "aff", "801.json"),
      JSON.stringify({ balance: 0, packageBalance: 0, transactions: [] }),
    );
    const response = await invoke("no-balance");
    expect(response.status).toBe(402);
    expect(upstream.send).not.toHaveBeenCalled();
    expect(upstream.fallback).not.toHaveBeenCalled();
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it("does not execute an unowned key or missing local channel through a different pricing policy", async () => {
    upstream.userId = null;
    expect((await invoke("unknown-owner")).status).toBe(503);
    expect(upstream.send).not.toHaveBeenCalled();
    upstream.userId = 801;
    upstream.configured = false;
    expect((await invoke("missing-local-channel")).status).toBe(503);
    expect(upstream.send).not.toHaveBeenCalled();
  });
  it("refunds a failed upstream at the original tier and releases its daily reservation", async () => {
    upstream.send.mockImplementation(async () =>
      Response.json({ error: { code: "upstream_error" } }, { status: 502 }),
    );
    const response = await invoke("upstream-failure");
    expect(response.status).toBe(502);
    expect((await affStatus(801)).balance).toBe(1000);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it("refuses a key outside its model scope without touching wallet or upstream", async () => {
    upstream.allowedModels = ["nai-v4.5-full"];
    const response = await invoke("restricted-key");
    expect(response.status).toBe(403);
    expect(upstream.send).not.toHaveBeenCalled();
    expect((await affStatus(801)).balance).toBe(1000);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
});
