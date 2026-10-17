import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/v1/images/edits/route";
import { verifyWatermark } from "@/lib/image-watermark";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  refund: vi.fn(),
  settings: vi.fn(),
  finish: vi.fn(),
}));

vi.mock("@/lib/newapi-db", () => ({
  resolveExternalApiIdentity: vi.fn(async () => ({ userId: 41, username: "user-41" })),
}));
vi.mock("@/lib/aff", () => ({
  trySpendImageCredits: vi.fn(async () => ({
    cost: 2, samples: 1, packageCost: 2, personalCost: 0,
    packageChargesBySample: [2], personalChargesBySample: [0],
  })),
  refundImageCredits: mocks.refund,
}));
vi.mock("@/lib/newapi", () => ({
  resolvedImageUpstream: vi.fn(async () => ({ baseUrl: "http://gateway.test", token: "gateway-token" })),
}));
vi.mock("@/lib/adapters/registry", () => ({
  registry: { getImageAdapter: vi.fn(async () => null) },
}));
vi.mock("@/lib/model-concurrency", () => ({ fetchWithModelConcurrency: mocks.send }));
vi.mock("@/lib/runtime-config", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/runtime-config")>(),
  isNaiModelEnabled: vi.fn(async () => true),
  getRuntimeSettings: mocks.settings,
}));
vi.mock("@/lib/risk-control", () => ({
  evaluateImageRisk: vi.fn(async () => ({ decision: "allow" })),
}));
vi.mock("@/lib/risk-ip", () => ({ recordIpEvidence: vi.fn(async () => null) }));
vi.mock("@/lib/risk-settlement", () => ({
  createImageSettlement: vi.fn(),
  updateImageSettlement: vi.fn(),
}));
vi.mock("@/lib/gateway-log", () => ({ gatewayLogStart: () => () => undefined }));
vi.mock("@/lib/request-audit", () => ({
  startRequestAudit: vi.fn(async () => ({
    requestId: "request-edits-response",
    requestFingerprint: "fingerprint-edits-response",
    record: { parameters: {} },
    finish: mocks.finish,
    responseHeaders: (init?: HeadersInit) => {
      const headers = new Headers(init);
      headers.set("X-LFN-Request-ID", "request-edits-response");
      return headers;
    },
  })),
}));

const originalDataDir = process.env.LFN_DATA_DIR;
let temporary: string;
let png: Buffer;
let upstreamJson: string;

beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "lfn-edits-response-"));
  vi.stubEnv("LFN_DATA_DIR", temporary);
  png = await sharp(randomBytes(832 * 768 * 3), {
    raw: { width: 832, height: 768, channels: 3 },
  }).png({ compressionLevel: 0 }).toBuffer();
  upstreamJson = JSON.stringify({
    data: [{ b64_json: png.toString("base64") }], usage: { prompt_tokens: 1000 },
  });
});

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
  if (temporary && path.dirname(temporary) === path.resolve(os.tmpdir()))
    await rm(temporary, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({
    watermarkEnabled: true, publicUrl: "https://lfn.test", watermarkIssuer: "LFN", watermarkLabel: "LFN",
    watermarkNote: "Generated through LFN",
  });
  mocks.refund.mockResolvedValue(undefined);
});

function editRequest(encoding: "json" | "multipart" = "json"): Request {
  const fields = { model: "nai-v5-full", prompt: "edit this image", size: "832x768", n: "1" };
  const headers = new Headers({ Authorization: "Bearer sk-test-key" });
  let body: BodyInit;
  if (encoding === "multipart") {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.set(key, value));
    form.set("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "source.png");
    body = form;
  } else {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify({ ...fields, image: `data:image/png;base64,${png.toString("base64")}` });
  }
  return new Request("http://localhost/v1/images/edits", { method: "POST", headers, body });
}

function upstreamResponse(body = upstreamJson, encoding?: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "ETag": '"upstream-image"',
      "X-Anlas-Cost": "20",
      ...(encoding ? { "Content-Encoding": encoding } : {}),
    },
  });
}

// Reading a Web Response in memory ignores Content-Length. Send it over HTTP
// so a stale upstream length actually truncates the JSON seen by the client.
async function readOverHttp(response: Response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  const server = createServer((_request, outgoing) => {
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(bytes);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP test address");
    const received = await fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(5000) });
    return { status: received.status, headers: received.headers, text: await received.text(), sentBytes: bytes.length };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("external image edits response integrity", () => {
  it.each(["json", "multipart"] as const)("delivers a complete large watermarked PNG for %s edits", async (encoding) => {
    mocks.send.mockResolvedValueOnce(upstreamResponse());
    const response = await POST(editRequest(encoding));
    expect(response.status).toBe(200);
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("etag")).toBe(false);
    const received = await readOverHttp(response);
    expect(received.sentBytes).toBeGreaterThan(Buffer.byteLength(upstreamJson));
    expect(received.sentBytes).toBeGreaterThan(1_310_462);
    expect(Buffer.byteLength(received.text)).toBe(received.sentBytes);
    const payload = JSON.parse(received.text);
    const marked = `data:image/png;base64,${payload.data[0].b64_json}`;
    expect(await verifyWatermark(marked)).toMatchObject({ valid: true, shaMatch: true });
    const pixels = await sharp(Buffer.from(payload.data[0].b64_json, "base64")).raw().toBuffer();
    expect(pixels.equals(await sharp(png).raw().toBuffer())).toBe(true);
    expect(received.headers.get("x-anlas-cost")).toBe("20");
    expect(received.headers.get("x-lfn-payment-source")).toBe("package");
    expect(mocks.refund).not.toHaveBeenCalled();
    const [url, init] = mocks.send.mock.calls[0];
    expect(url).toBe("http://gateway.test/v1/images/edits");
    if (encoding === "multipart") {
      expect(init.body.get("image")).toBeInstanceOf(File);
      expect(new Headers(init.headers).has("content-type")).toBe(false);
    } else expect(JSON.parse(init.body).image).toContain("data:image/png;base64,");
  });

  it("removes decoded upstream compression headers when watermarking fails", async () => {
    mocks.send.mockResolvedValueOnce(upstreamResponse(upstreamJson, "gzip"));
    mocks.settings.mockRejectedValueOnce(new Error("Watermark settings unavailable"));
    const response = await POST(editRequest());
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
    const received = await readOverHttp(response);
    expect(received.status).toBe(200);
    expect(JSON.parse(received.text).data[0].b64_json).toBe(png.toString("base64"));
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it.each(["truncated", "disconnected"])("returns a JSON 502 and refunds a %s upstream success response", async (failure) => {
    const upstream = failure === "truncated"
      ? upstreamResponse(upstreamJson.slice(0, 1_310_462))
      : new Response(new ReadableStream({
        start(controller) { controller.error(new Error("Upstream connection closed")); },
      }), { headers: { "Content-Type": "application/json", "X-Anlas-Cost": "20" } });
    mocks.send.mockResolvedValueOnce(upstream);
    const response = await POST(editRequest());
    const received = await readOverHttp(response);
    expect(received.status).toBe(502);
    expect(JSON.parse(received.text).error).toMatchObject({
      type: "api_error", code: "lfn_image_invalid_response",
    });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(41, expect.anything(), 0, {
      settlementId: "settlement:request-edits-response", requestId: "request-edits-response",
    });
    expect(mocks.finish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 502, generatedSamples: 0 }));
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
