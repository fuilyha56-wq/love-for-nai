import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveExternalApiIdentity: vi.fn(),
  trySpendImageCredits: vi.fn(),
  refundImageCredits: vi.fn(),
  affGateway: vi.fn(),
  naiImageUpstream: vi.fn(),
  naiAccountUpstream: vi.fn(),
  newApiBaseUrl: vi.fn(),
}));

vi.mock("@/lib/newapi-db", () => ({
  resolveExternalApiIdentity: mocks.resolveExternalApiIdentity,
}));
vi.mock("@/lib/aff", () => ({
  trySpendImageCredits: mocks.trySpendImageCredits,
  refundImageCredits: mocks.refundImageCredits,
}));
vi.mock("@/lib/newapi", () => ({
  affGateway: mocks.affGateway,
  resolvedAffGateway: mocks.affGateway,
  resolvedImageUpstream: mocks.naiImageUpstream,
  resolvedNaiImageUpstream: mocks.naiImageUpstream,
  resolvedNaiAccountUpstream: mocks.naiAccountUpstream,
  resolvedNewApiBaseUrl: mocks.newApiBaseUrl,
  newApiBaseUrl: mocks.newApiBaseUrl,
}));

const charge = {
  cost: 2,
  samples: 1,
  packageCost: 2,
  personalCost: 0,
  packageImages: 1,
  packageImageIndexes: [0],
  packageChargesBySample: [2],
  personalChargesBySample: [0],
  packageUsageIds: ["usage-1"],
  packageRateLimited: false,
  balance: 3,
  packageBalance: 398,
  totalBalance: 401,
};

beforeEach(() => {
  mocks.resolveExternalApiIdentity.mockResolvedValue({ userId: 41, username: "user-41" });
  mocks.trySpendImageCredits.mockResolvedValue(charge);
  mocks.refundImageCredits.mockResolvedValue(undefined);
  mocks.affGateway.mockResolvedValue({
    baseUrl: "http://gateway.test",
    token: "gateway-token",
  });
  mocks.naiImageUpstream.mockResolvedValue({
    baseUrl: "http://image-gateway.test",
    token: "gateway-token",
  });
  mocks.naiAccountUpstream.mockResolvedValue({
    baseUrl: "http://account-gateway.test",
    token: "gateway-token",
  });
  mocks.newApiBaseUrl.mockResolvedValue("http://newapi.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("http://image-gateway.test"))
        return new Response("ZIPDATA", { headers: { "Content-Type": "application/zip" } });
      if (url.startsWith("http://newapi.test"))
        return Response.json({ data: [{ b64_json: "abc" }] });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NovelAI 原生兼容层", () => {
  it("普通用户读取账户接口返回 403，且不请求 Gateway", async () => {
    const { GET } = await import("@/app/user/subscription/route");
    const response = await GET(
      new Request("http://localhost/user/subscription", {
        headers: { Authorization: "Bearer sk-user-key" },
      }),
    );
    expect(response.status).toBe(403);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(0);
  });

  it("encode-vibe 使用服务端 Gateway Token 转发原生路径", async () => {
    const { POST } = await import("@/app/ai/encode-vibe/route");
    const response = await POST(
      new Request("http://localhost/ai/encode-vibe", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image: "base64-image", model: "nai-diffusion-4-5-full" }),
      }),
    );
    expect(response.status).toBe(200);
    const call = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).startsWith("http://image-gateway.test/ai/encode-vibe"),
    );
    expect(call).toBeTruthy();
    expect(new Headers(call?.[1]?.headers).get("Authorization")).toBe("Bearer gateway-token");
    expect(mocks.trySpendImageCredits).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ operation: "encode-vibe" }),
    );
  });

  it("generate-image 配置图像端点后转发官方 JSON，不改写成 OpenAI 格式", async () => {
    const { POST } = await import("@/app/ai/generate-image/route");
    const nativeBody = {
      input: "1girl",
      model: "nai-diffusion-4-5-full",
      action: "generate",
      parameters: { width: 832, height: 1216, n_samples: 1, steps: 28 },
    };
    const response = await POST(
      new Request("http://localhost/ai/generate-image", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nativeBody),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    const call = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url) === "http://image-gateway.test/ai/generate-image",
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      input: "1girl",
      model: "nai-diffusion-4-5-full",
      parameters: { width: 832, height: 1216 },
    });
    expect(new Headers(call?.[1]?.headers).get("Authorization")).toBe("Bearer gateway-token");
  });
});
