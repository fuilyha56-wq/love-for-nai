import JSZip from "jszip";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/images/operate/route";

const mocks = vi.hoisted(() => ({
  spend: vi.fn(), refund: vi.fn(), token: vi.fn(), send: vi.fn(),
  auth: vi.fn(), native: vi.fn(), history: vi.fn(), finish: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ userId: 316, username: "user-316" }) }));
// Legacy alternate-wallet product remains opt-in; default strict mode is covered by api-tier-billing.
vi.mock("@/lib/daily-image-billing", async (original) => ({
  ...await original<typeof import("@/lib/daily-image-billing")>(),
  dailyImagePolicy: async () => ({ strictApiBilling: false }),
}));
vi.mock("@/lib/aff", () => ({ trySpendImageCredits: mocks.spend, refundImageCredits: mocks.refund }));
vi.mock("@/lib/newapi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/newapi")>(),
  getImageToken: mocks.token,
  resolvedNewApiBaseUrl: async () => "http://newapi.test",
  resolvedNaiImageUpstream: mocks.native,
}));
vi.mock("@/lib/platform", () => ({ resolvedAuthProviderId: mocks.auth }));
vi.mock("@/lib/runtime-config", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/runtime-config")>(),
  isNaiModelEnabled: async () => true,
}));
vi.mock("@/lib/model-concurrency", () => ({ fetchWithModelConcurrency: mocks.send }));
vi.mock("@/lib/history", () => ({ saveHistory: mocks.history }));
vi.mock("@/lib/risk-control", () => ({ evaluateImageRisk: async () => ({ decision: "allow" }) }));
vi.mock("@/lib/gateway-log", () => ({ gatewayLogStart: () => () => undefined }));
vi.mock("@/lib/request-audit", () => ({ startRequestAudit: async () => ({
  requestId: "upscale-request", record: {}, finish: mocks.finish,
  responseHeaders: (init?: HeadersInit) => new Headers(init),
}) }));

let input: string;
let output: string;
let archive: Uint8Array;
beforeAll(async () => {
  const source = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } }).png().toBuffer();
  const enlarged = await sharp(source).resize(128, 128).png().toBuffer();
  input = `data:image/png;base64,${source.toString("base64")}`;
  output = `data:image/png;base64,${enlarged.toString("base64")}`;
  archive = await new JSZip().file("image_0.png", enlarged).generateAsync({ type: "uint8array" });
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockResolvedValue({ baseUrl: "http://gateway.test", token: "gateway-token" });
  mocks.auth.mockResolvedValue("newapi");
  mocks.spend.mockResolvedValue(null);
  mocks.token.mockResolvedValue("user-image-token");
  mocks.history.mockResolvedValue([{ id: "history-upscale" }]);
  mocks.send.mockImplementation(async () => Response.json({ data: [{ b64_json: output.split(",")[1] }] }, { headers: { "X-Anlas-Cost": "1" } }));
});
const request = (upscaleModel = "nai-diffusion-5-full") => new Request("http://localhost/api/images/operate", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ operation: "upscale", model: "nai-v5-full-limit", upscale_model: upscaleModel, image: input }),
});
const charge = (packageCost: number, personalCost: number) => ({ cost: 1, packageCost, personalCost, balance: 0, packageBalance: 0, totalBalance: 0 });

describe("upscale payment fallback", () => {
  it.each([
    ["nai-diffusion-5-full", "nai-v5-full"],
    ["nai-diffusion-5-curated", "nai-v5-curated"],
  ])("uses station balance for %s when package and personal AFF are insufficient", async (model, billingModel) => {
    const response = await POST(request(model));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image: output, width: 128, height: 128, payment: "newapi", paymentSource: "newapi", aff: null });
    expect(response.headers.get("x-lfn-payment-source")).toBe("newapi");
    expect(mocks.token).toHaveBeenCalledWith(expect.objectContaining({ userId: 316 }), billingModel);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.send.mock.calls[0];
    expect(url).toBe("http://newapi.test/v1/images/generations");
    expect(JSON.parse(init.body)).toEqual({ model: billingModel, image: input.split(",")[1], novelai_operation: "upscale", response_format: "b64_json", n: 1 });
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer user-image-token");
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenLastCalledWith(expect.objectContaining({ paymentSource: "newapi", generatedSamples: 1, billing: { gatewayAnlasCost: 1 } }));
  });

  it.each([[1, 0, "package"], [0, 1, "personal"], [0.4, 0.6, "mixed"]] as const)("preserves AFF payment from package=%s personal=%s", async (packageCost, personalCost, source) => {
    mocks.spend.mockResolvedValueOnce(charge(packageCost, personalCost));
    mocks.send.mockResolvedValueOnce(new Response(new Uint8Array(archive)));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image: output, payment: "aff", paymentSource: source, aff: { cost: 1 } });
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith("http://gateway.test/ai/upscale", expect.anything());
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("preserves the station balance rejection without reporting AFF shortage or retrying", async () => {
    mocks.send.mockResolvedValueOnce(Response.json({ error: { message: "站内余额不足" } }, { status: 402 }));
    const response = await POST(request());
    expect(response.status).toBe(402);
    expect((await response.json()).message).toContain("站内余额不足");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it.each([false, true])("refunds only the actual AFF payment after an upstream failure (AFF=%s)", async (aff) => {
    if (aff) mocks.spend.mockResolvedValueOnce(charge(1, 0));
    mocks.send.mockRejectedValueOnce(new Error("Upstream disconnected"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(mocks.refund).toHaveBeenCalledTimes(aff ? 1 : 0);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("retains the paid output when history storage fails", async () => {
    mocks.history.mockRejectedValueOnce(new Error("Storage unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image: output, warning: expect.any(String), paymentSource: "newapi" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("supports station balance even when a direct native upstream is unavailable", async () => {
    mocks.native.mockResolvedValueOnce(null);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.spend).not.toHaveBeenCalled();
    expect(mocks.token).toHaveBeenCalled();
  });

  it("does not attempt station balance for local accounts without AFF", async () => {
    mocks.auth.mockResolvedValueOnce("local");
    const response = await POST(request());
    expect(response.status).toBe(402);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });
});
