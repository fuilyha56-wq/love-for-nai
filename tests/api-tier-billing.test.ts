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
  adapter: undefined as import("@/lib/adapters/types").ImageAdapter | undefined,
}));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ userId:801,username:"billing-test" }) }));
vi.mock("@/lib/newapi-db", () => ({
  resolveExternalApiIdentity: vi.fn(async () => ({
    userId: upstream.userId,
    username: "billing-test",
    allowedModels: upstream.allowedModels,
  })),
  ensureManagedFallbackToken: upstream.fallback,
}));
vi.mock("@/lib/newapi", () => ({
  getImageToken: async () => "managed-fixture-key",
  imageFromResult: (result:{data?:Array<{b64_json?:string}>}) => (result.data||[]).flatMap(item=>item.b64_json?[`data:image/png;base64,${item.b64_json}`]:[]),
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
  registry: { getImageAdapter: vi.fn(async () => upstream.adapter ?? null) },
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
import { POST as streamPOST } from "@/app/ai/generate-image-stream/route";
import { POST as editsPOST } from "@/app/v1/images/edits/route";
import { POST as upscalePOST } from "@/app/ai/upscale/route";
import { POST as encodePOST } from "@/app/ai/encode-vibe/route";
import { POST as augmentPOST } from "@/app/ai/augment-image/route";
import { POST as operatePOST } from "@/app/api/images/operate/route";
import {
  dailyImageBillingState,
  reserveDailyImageQuote,
  saveDailyImagePolicy,
} from "@/lib/daily-image-billing";
import { DEFAULT_DAILY_IMAGE_POLICY } from "@/lib/daily-image-pricing";
import { affStatus } from "@/lib/aff";
import { flushRequestAudits, listUserImageUsage } from "@/lib/request-audit";
import {
  freeGrantReadiness,
  resetLightRisk,
  riskUserSnapshot,
} from "@/lib/light-risk";
import { getRiskSettings, publishRiskSettings, resetRiskSettingsCache } from "@/lib/risk-settings";
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
function jsonRequest(endpoint: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`https://lfn.test${endpoint}`, { method: "POST", headers: {
    authorization: "Bearer coverage-key", "content-type": "application/json", "x-real-ip": "203.0.113.71", ...headers,
  }, body: JSON.stringify(body) });
}
async function nativeResult(stream = false) {
  const bytes = Uint8Array.from(Buffer.from(png, "base64"));
  if (stream) {
    const payload = encode({ event_type: "final", samp_ix: 0, image: bytes });
    const frame = new Uint8Array(4 + payload.length);
    new DataView(frame.buffer).setUint32(0, payload.length, false);
    frame.set(payload, 4);
    upstream.send.mockImplementation(async () => new Response(frame, { headers: { "content-type": "application/x-msgpack" } }));
  } else {
    const zip = await new JSZip().file("image_0.png", bytes).generateAsync({ type: "uint8array" });
    upstream.send.mockImplementation(async () => new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip" } }));
  }
}
function largePngHeader() {
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(2048, 16);
  bytes.writeUInt32BE(1536, 20);
  return bytes.toString("base64");
}
async function enableGrantChecks() {
  const settings = await getRiskSettings();
  await publishRiskSettings(
    { ...settings, values: { ...settings.values, "grant.enabled": true } },
    settings.version,
    "test",
    "Enable the grant policy explicitly for admission fixtures",
  );
}
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
  (globalThis as typeof globalThis & { __lfnImageRequestLimiter?: { clear(): void } }).__lfnImageRequestLimiter?.clear();
  upstream.userId = 801;
  upstream.configured = true;
  upstream.native = false;
  upstream.allowedModels = undefined;
  upstream.adapter = undefined;
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
describe("API pricing coverage: final wallet debits for the approved prices", () => {
  it.each([
    ["V5 text", { model: "nai-v5-full" }, 455],
    ["V4.5 text", { model: "nai-v4.5-full" }, 241],
    ["V5 img2img", { model: "nai-v5-full", novelai_operation: "img2img", image: png }, 320],
    ["V5 img2img 0.55", { model: "nai-v5-full", novelai_operation: "img2img", image: png, strength: "0.55" }, 255],
    ["Medium img2img", { model: "nai-v5-full-medium", novelai_operation: "img2img", image: png, steps: 14 }, 181],
    ["infill string strength", { model: "nai-v5-inpaint", novelai_operation: "inpainting", image: png, mask: png, inpaintImg2ImgStrength: "0.55" }, 255],
    ["precise reference", { model: "nai-v5-full", novelai_operation: "precise-reference", references: [{ reference_image: png }] }, 480],
    ["unconditional scale", { model: "nai-v5-full", uncond_scale: "0.5" }, 230],
  ] as const)("charges %s through /v1/images/generations", async (_name, fields, cost) => {
    const response = await POST(jsonRequest("/v1/images/generations", { prompt: "billing", size: "2048x1536", steps: 28, n: 1, ...fields }));
    expect(response.status, await response.clone().text()).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(1000 - cost);
    expect((await listUserImageUsage(801))[0]).toMatchObject({ charged_aff: cost });
  });
  it("includes the fifth cached Vibe reference fee", async () => {
    const references = Array.from({ length: 5 }, () => ({ cache_secret_key: "cached-vibe-fixture" }));
    const response = await POST(jsonRequest("/v1/images/generations", { model: "nai-v5-full", prompt: "billing", size: "1024x1024", steps: 23, reference_image_multiple_cached: references }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(855);
  });
  it.each([false, true])("quotes and forwards the same header overrides, NewAPI fallback=%s", async fallback => {
    if (fallback) {
      await writeFile(path.join(directory, "aff/801.json"), JSON.stringify({ balance: 0, packageBalance: 0, transactions: [] }));
      upstream.fallback.mockResolvedValue("managed-fixture-key");
    }
    const response = await POST(jsonRequest("/v1/images/generations", { model: "nai-v5-full", prompt: "billing", size: "1024x1024", steps: 23, extra_params: { steps: 26 } }, {
      "x-novelai-extra-params": JSON.stringify({ width: 2048, height: 1536, steps: 27 }), "x-steps": "28",
    }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(JSON.parse(upstream.send.mock.calls[0][1].body)).toMatchObject({ width: 2048, height: 1536, steps: 28 });
    expect(JSON.parse(upstream.send.mock.calls[0][1].body)).not.toHaveProperty("extra_params");
    expect((await affStatus(801)).balance).toBe(fallback ? 0 : 545);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(fallback ? 0 : 1);
  });
  it("uses an operation supplied in headers when quoting and forwarding", async () => {
    const response = await POST(jsonRequest("/v1/images/generations", { model: "nai-v5-full", prompt: "billing", size: "2048x1536", steps: 28, image: png, strength: 0.55 }, { "x-novelai-operation": "img2img" }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(745);
    expect(JSON.parse(upstream.send.mock.calls[0][1].body).novelai_operation).toBe("img2img");
  });
  it.each([false, true])("charges exact editing strength for JSON/multipart=%s", async multipart => {
    const fields = { model: "nai-v5-inpaint", prompt: "billing", size: "2048x1536", steps: "28", inpaintImg2ImgStrength: "0.55" };
    let request: Request;
    if (multipart) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set("image", new Blob([Buffer.from(png, "base64")], { type: "image/png" }), "image.png");
      request = new Request("https://lfn.test/v1/images/edits", { method: "POST", headers: { authorization: "Bearer edit-key", "x-real-ip": "203.0.113.71" }, body: form });
    } else request = jsonRequest("/v1/images/edits", { ...fields, image: png });
    const response = await editsPOST(request);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(745);
  });
  it.each([false, true])("charges the native generation and dedicated stream endpoints, stream=%s", async stream => {
    upstream.native = true;
    await nativeResult(stream);
    const endpoint = `/ai/generate-image${stream ? "-stream" : ""}`;
    const response = await (stream ? streamPOST : nativePOST)(jsonRequest(endpoint, { model: "nai-diffusion-5-full", input: "billing", action: "img2img", parameters: { width: 2048, height: 1536, steps: 28, n_samples: 1, strength: 0.55, image: png } }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(745);
    expect((await listUserImageUsage(801))[0]).toMatchObject({ charged_aff: 255 });
  });
  it.each([false, true])("charges upscale by the input PNG, dedicated native=%s", async native => {
    upstream.native = native;
    if (native) await nativeResult();
    const response = native
      ? await upscalePOST(jsonRequest("/ai/upscale", { model: "nai-diffusion-5-full", image: largePngHeader(), width: 1024, height: 1024 }))
      : await POST(jsonRequest("/v1/images/generations", { model: "nai-v5-full", novelai_operation: "upscale", image: largePngHeader(), size: "1024x1024", width: 1024, height: 1024 }));
    expect(response.status, await response.clone().text()).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(980);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it.each([["lineart", 20], ["bg-removal", 260]] as const)("charges Director %s without an image base fee", async (req_type, cost) => {
    upstream.native = true;
    await nativeResult();
    const response = await augmentPOST(jsonRequest("/ai/augment-image", { req_type, image: png, width: 1024, height: 1024 }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(1000 - cost);
    expect((await dailyImageBillingState(801)).counts).toEqual({ v45: 0, v5: 0 });
  });
  it("settles successful binary Vibe encoding instead of refunding it as an invalid image", async () => {
    upstream.native = true;
    upstream.send.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "application/octet-stream" } }));
    const response = await encodePOST(jsonRequest("/ai/encode-vibe", { model: "nai-diffusion-5-full", image: png }));
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect((await affStatus(801)).balance).toBe(990);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it("rejects Limit overrides before reserving a wallet charge", async () => {
    const response = await POST(jsonRequest("/v1/images/generations", { model: "nai-v5-full-limit", prompt: "billing", size: "1024x1024" }, { "x-novelai-extra-params": JSON.stringify({ width: 2048, height: 1536 }) }));
    expect(response.status).toBe(400);
    expect(upstream.send).not.toHaveBeenCalled();
    expect((await affStatus(801)).balance).toBe(1000);
  });
  it("applies the persisted 75-image daily boundary to API requests", async () => {
    await saveDailyImagePolicy({ ...DEFAULT_DAILY_IMAGE_POLICY, v5: [
      { afterImages: 0, baseCny: 0.04, anlasMultiplier: 1, totalMultiplier: 1 },
      { afterImages: 75, baseCny: 0.04, anlasMultiplier: 1.1, totalMultiplier: 1.1 },
    ] });
    for (const samples of [30, 30, 15]) await reserveDailyImageQuote(801, { ...generation, samples, sequential: true }, `previous-${samples}-${Math.random()}`);
    const response = await POST(jsonRequest("/v1/images/generations", { model: "nai-v5-full", prompt: "billing", size: "2048x1536", steps: 28 }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(450);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(76);
  });
  it("preserves native multipart parsing and its final stream charge", async () => {
    upstream.native = true;
    await nativeResult(true);
    const form = new FormData();
    form.set("request", JSON.stringify({ model: "nai-diffusion-5-full", input: "billing", action: "img2img", parameters: { width: 2048, height: 1536, steps: 28, n_samples: 1, strength: 0.55, image: "image" } }));
    form.set("image", new Blob([Buffer.from(png, "base64")], { type: "image/png" }), "image.png");
    const response = await streamPOST(new Request("https://lfn.test/ai/generate-image-stream", { method: "POST", headers: { authorization: "Bearer multipart-native", "x-real-ip": "203.0.113.71" }, body: form }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(745);
  });
  it("refunds an empty Vibe encoding response", async () => {
    upstream.native = true;
    upstream.send.mockImplementation(async () => new Response(new Uint8Array(), { headers: { "content-type": "application/octet-stream" } }));
    const response = await encodePOST(jsonRequest("/ai/encode-vibe", { model: "nai-diffusion-5-full", image: png }));
    expect(response.status).toBe(502);
    expect((await affStatus(801)).balance).toBe(1000);
  });
  it("rejects a batch for the single-image Vibe encoding endpoint", async () => {
    upstream.native = true;
    const response = await encodePOST(jsonRequest("/ai/encode-vibe", { images: [png, png] }));
    expect(response.status).toBe(400);
    expect(upstream.send).not.toHaveBeenCalled();
    expect((await affStatus(801)).balance).toBe(1000);
  });
  it("preserves billed inpaint parameters when a configured adapter handles the API", async () => {
    const generate = vi.fn(async (request: import("@/lib/adapters/types").ImageGenerationRequest) => { void request; return { images: [{ b64_json: png }] }; });
    upstream.adapter = { type: "openai_compat", name: "fixture", generate };
    const response = await POST(jsonRequest("/v1/images/generations", { model: "nai-v5-inpaint", novelai_operation: "inpainting", prompt: "billing", image: png, mask: png, size: "2048x1536", inpaintImg2ImgStrength: 0.55 }));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect((await affStatus(801)).balance).toBe(745);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ extra: { image: png, mask: png, inpaintImg2ImgStrength: 0.55, width: 2048, height: 1536 } });
    expect(upstream.send).not.toHaveBeenCalled();
  });
});
describe("API tiers with real local wallet and daily reservations", () => {
  it("retains the real studio payment and final charge for the usage filter",async()=>{
    const response=await operatePOST(new Request("https://lfn.test/api/images/operate",{method:"POST",headers:{"content-type":"application/json","x-real-ip":"203.0.113.71"},body:JSON.stringify({model:"nai-v5-full",operation:"generate",prompt:"billing fixture",width:832,height:1216,steps:28,n:1})}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({paymentSource:"personal"});
    expect((await listUserImageUsage(801))[0]).toMatchObject({payment_source:"personal",charged_aff:5,status:"success"});
    expect((await dailyImageBillingState(801)).counts.v5).toBe(1);
  });
  it("keeps a studio NewAPI fallback out of local daily counts and local payment rows",async()=>{
    await writeFile(path.join(directory,"aff/801.json"),JSON.stringify({balance:0,packageBalance:0,transactions:[]}));
    const response=await operatePOST(new Request("https://lfn.test/api/images/operate",{method:"POST",headers:{"content-type":"application/json","x-real-ip":"203.0.113.71"},body:JSON.stringify({model:"nai-v5-full",operation:"generate",prompt:"billing fixture",width:832,height:1216,steps:28,n:1})}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({paymentSource:"newapi"});
    expect(upstream.send.mock.calls[0][0]).toBe("https://fallback.invalid/v1/images/generations");
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);expect(await listUserImageUsage(801)).toEqual([]);
  });
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
    await enableGrantChecks();
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
    await enableGrantChecks();
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
    expect((await affStatus(801)).balance).toBe(995);
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
    expect((await affStatus(801)).balance).toBe(995);
    const second = await invoke("second-key");
    expect(second.status).toBe(200);
    await second.json();
    expect((await affStatus(801)).balance).toBe(989.5);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(51);
    const account = JSON.parse(
      await readFile(path.join(directory, "aff", "801.json"), "utf8"),
    );
    expect(
      account.transactions
        .filter((t: { type: string }) => t.type === "generation")
        .map((t: { amount: number }) => t.amount),
    ).toEqual([-5.5, -5]);
  });
  it("does not silently charge NewAPI when local credits are insufficient", async () => {
    await saveDailyImagePolicy({ ...DEFAULT_DAILY_IMAGE_POLICY, strictApiBilling: true });
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
    await saveDailyImagePolicy({ ...DEFAULT_DAILY_IMAGE_POLICY, strictApiBilling: true });
    upstream.userId = null;
    expect((await invoke("unknown-owner")).status).toBe(503);
    expect(upstream.send).not.toHaveBeenCalled();
    upstream.userId = 801;
    upstream.configured = false;
    expect((await invoke("missing-local-channel")).status).toBe(503);
    expect(upstream.send).not.toHaveBeenCalled();
  });
  it("defaults to an actual NewAPI generation when AFF is insufficient, leaving the local count unchanged", async () => {
    await writeFile(path.join(directory, "aff", "801.json"), JSON.stringify({ balance: 1, packageBalance: 0, transactions: [] }));
    upstream.fallback.mockResolvedValue("managed-fixture-key");
    const response = await invoke("newapi-balance");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-LFN-Payment-Source")).toBe("newapi");
    expect(response.headers.get("X-LFN-Watermark")).toBe("embedded");
    const body = await response.json();
    expect(await verifyWatermark(`data:image/png;base64,${body.data[0].b64_json}`)).toMatchObject({ valid: true });
    expect(upstream.send).toHaveBeenCalledTimes(1);
    expect(upstream.send.mock.calls[0][0]).toBe("https://fallback.invalid/v1/images/generations");
    expect((await affStatus(801)).balance).toBe(1);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
  });
  it.each(["nai-v5-full", "nai-v5-full-limit", "nai-v4.5-full-limit"])("uses real NewAPI for %s with both local wallets at zero", async (model) => {
    await writeFile(path.join(directory,"aff/801.json"),JSON.stringify({balance:0,packageBalance:0,transactions:[]}));
    upstream.fallback.mockResolvedValue("managed-fixture-key");
    const response=await POST(new Request("https://lfn.test/v1/images/generations",{method:"POST",headers:{authorization:"Bearer owned", "content-type":"application/json","x-real-ip":"203.0.113.71"},body:JSON.stringify({model,prompt:"billing fixture",size:"832x1216",steps:28,n:1})}));
    expect(response.status).toBe(200);expect(response.headers.get("X-LFN-Payment-Source")).toBe("newapi");await response.json();
    expect(upstream.send.mock.calls[0][0]).toBe("https://fallback.invalid/v1/images/generations");
    expect((await affStatus(801)).balance).toBe(0);expect((await dailyImageBillingState(801)).counts).toEqual({v45:0,v5:0});
  });
  it("still rejects an unowned key when independent NewAPI billing is allowed", async () => {
    upstream.userId = null;
    expect((await invoke("unowned-key")).status).toBe(503);
    expect(upstream.send).not.toHaveBeenCalled();
  });
  it.each([false, true])("preserves NewAPI billing and signatures in native fallback, stream=%s", async (stream) => {
    upstream.native = true;
    upstream.fallback.mockResolvedValue("managed-fixture-key");
    await writeFile(path.join(directory, "aff", "801.json"), JSON.stringify({ balance: 1, packageBalance: 0, transactions: [] }));
    const response = await nativePOST(new Request(`https://lfn.test/ai/generate-image${stream ? "-stream" : ""}`, {
      method: "POST", headers: { authorization: "Bearer paid-native", "content-type": "application/json", "x-real-ip": "203.0.113.71" },
      body: JSON.stringify({ input: "billing fixture", model: "nai-diffusion-5-full", action: "generate", parameters: { width: 832, height: 1216, steps: 28, n_samples: 1 } }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-LFN-Payment-Source")).toBe("newapi");
    const body = new Uint8Array(await response.arrayBuffer());
    const image = stream ? (decode(body.subarray(4)) as { image: Uint8Array }).image : await (await JSZip.loadAsync(body)).file("image_0.png")!.async("uint8array");
    expect(await verifyWatermark(`data:image/png;base64,${Buffer.from(image).toString("base64")}`)).toMatchObject({ valid: true });
    expect(upstream.send).toHaveBeenCalledTimes(1);
    expect(upstream.send.mock.calls[0][0]).toBe("https://fallback.invalid/v1/images/generations");
    expect((await affStatus(801)).balance).toBe(1);
    expect((await dailyImageBillingState(801)).counts.v5).toBe(0);
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
