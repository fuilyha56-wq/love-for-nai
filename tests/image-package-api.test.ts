import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const affMocks = vi.hoisted(() => ({
  affStatus: vi.fn(),
  trySpendImageCredits: vi.fn(),
}));
const bindingMocks = vi.hoisted(() => ({
  resolveExternalApiUser: vi.fn(),
}));

const session = {
  userId: 41,
  username: "tester",
  displayName: "tester",
  upstreamCookie: "",
  accessToken: "access-token",
  expiresAt: Date.now() + 3600_000,
};

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => session),
}));
vi.mock("@/lib/aff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aff")>();
  return {
    ...actual,
    affStatus: affMocks.affStatus,
    trySpendImageCredits: affMocks.trySpendImageCredits,
  };
});
vi.mock("@/lib/newapi-db", () => ({
  resolveExternalApiUser: bindingMocks.resolveExternalApiUser,
}));
vi.mock("@/lib/admin-auth", () => ({
  adminToken: vi.fn(() => "admin-token"),
  adminHeaders: vi.fn(() => ({ Authorization: "admin-token" })),
}));
vi.mock("@/lib/newapi", () => ({
  affGateway: vi.fn(() => ({ baseUrl: "http://gateway.test", token: "gateway-token" })),
  newApiBaseUrl: vi.fn(() => "http://newapi.test"),
  userHeaders: vi.fn(() => ({ Authorization: "Bearer access-token" })),
  isUpstreamAuthError: vi.fn(() => false),
  getImageToken: vi.fn(async () => "newapi-token"),
  imageFromResult: vi.fn(() => ["data:image/png;base64,abc"]),
}));

let currentFetch: ReturnType<typeof vi.fn>;
let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lfn-image-package-api-"));
  bindingMocks.resolveExternalApiUser.mockResolvedValue(null);
  affMocks.affStatus.mockResolvedValue({
    balance: 3,
    packageBalance: 400,
    totalBalance: 403,
    packageRateLimitRemaining: 10,
    checkedInToday: false,
    checkInReward: 20,
  });
  affMocks.trySpendImageCredits.mockResolvedValue(null);
  currentFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "http://newapi.test/api/user/41")
      return Response.json({ success: true, data: { quota: 123000000 } });
    if (url === "http://newapi.test/api/user/self")
      return Response.json({
        success: true,
        data: { quota: 123000000, used_quota: 1000000, group: "Draw" },
      });
    if (url === "http://newapi.test/api/user/manage")
      return Response.json({ success: true });
    if (url === "http://newapi.test/v1/images/generations")
      return Response.json({ data: [{ b64_json: "abc" }], usage: {} });
    throw new Error(`unexpected fetch ${url} ${init?.method || "GET"}`);
  });
  vi.stubGlobal("fetch", currentFetch);
  process.env.LFN_DATA_DIR = dataDir;
  process.env.LFN_ADMIN_TOKEN = "admin-token";
  process.env.LFN_AFF_GATEWAY_URL = "http://gateway.test";
  process.env.LFN_AFF_GATEWAY_TOKEN = "gateway-token";
  process.env.NEWAPI_BASE_URL = "http://newapi.test";
  process.env.QUOTA_PER_UNIT = "500000";
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.LFN_DATA_DIR;
  delete process.env.LFN_ADMIN_TOKEN;
  delete process.env.LFN_ADMIN_USER_ID;
  delete process.env.LFN_AFF_GATEWAY_URL;
  delete process.env.LFN_AFF_GATEWAY_TOKEN;
  delete process.env.NEWAPI_BASE_URL;
  delete process.env.QUOTA_PER_UNIT;
});

describe("钱包图包字段", () => {
  it("返回个人 AFF、图包额度和固定商品配置", async () => {
    const { GET } = await import("@/app/api/wallet/route");
    const response = await GET();
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.aff).toMatchObject({ balance: 3, packageBalance: 400, totalBalance: 403 });
    expect(result.imagePackage).toMatchObject({
      balance: 400,
      priceUsd: 200,
      affPerPackage: 400,
      rateLimit: 10,
      purchaseEnabled: true,
    });
  });
});

describe("图包购买请求", () => {
  it("服务端固定价格和额度，忽略客户端传入的价格字段", async () => {
    const { POST } = await import("@/app/api/image-packages/purchase/route");
    const response = await POST(
      new Request("http://localhost/api/image-packages/purchase", {
        method: "POST",
        body: JSON.stringify({
          requestId: "purchase_request_1",
          packageCount: 1,
          priceUsd: 0,
          affAmount: 999999,
          userId: 999,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const manage = currentFetch.mock.calls.find(
      ([url, init]) => url === "http://newapi.test/api/user/manage" && init?.method === "POST",
    );
    expect(JSON.parse(String(manage?.[1]?.body))).toEqual({
      id: 41,
      action: "add_quota",
      value: 100000000,
      mode: "subtract",
    });
  });
});

describe("内部生成 fallback", () => {
  it("AFF 不足时使用 NewAPI 地址和 NewAPI token，不把 token 发给 Gateway", async () => {
    const { POST } = await import("@/app/api/images/generate/route");
    const response = await POST(
      new Request("http://localhost/api/images/generate", {
        method: "POST",
        body: JSON.stringify({
          model: "nai-v4.5-full-limit",
          prompt: "1girl",
          width: 832,
          height: 1216,
          n: 1,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(currentFetch).toHaveBeenCalledWith(
      "http://newapi.test/v1/images/generations",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer newapi-token" }),
      }),
    );
    expect(currentFetch.mock.calls.some(([url]) => String(url).startsWith("http://gateway.test"))).toBe(false);
  });

  it("拒绝非法样本数，不调用 AFF 或上游", async () => {
    affMocks.trySpendImageCredits.mockClear();
    currentFetch.mockClear();
    const { POST } = await import("@/app/api/images/generate/route");
    for (const body of [
      { n: 0 },
      { n: -1 },
      { n: 1.5 },
      { n: 1, n_samples: 2 },
    ]) {
      const response = await POST(
        new Request("http://localhost/api/images/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "nai-v4.5-full-limit",
            prompt: "1girl",
            width: 832,
            height: 1216,
            ...body,
          }),
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(affMocks.trySpendImageCredits).not.toHaveBeenCalled();
    expect(currentFetch).not.toHaveBeenCalled();
  });
});
