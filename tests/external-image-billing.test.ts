import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveExternalApiIdentity: vi.fn(),
  ensureManagedFallbackToken: vi.fn(),
  trySpendImageCredits: vi.fn(),
  refundImageCredits: vi.fn(),
  affGateway: vi.fn(),
  newApiBaseUrl: vi.fn(),
}));

vi.mock("@/lib/newapi-db", () => ({
  resolveExternalApiIdentity: mocks.resolveExternalApiIdentity,
  ensureManagedFallbackToken: mocks.ensureManagedFallbackToken,
}));
vi.mock("@/lib/aff", () => ({
  trySpendImageCredits: mocks.trySpendImageCredits,
  refundImageCredits: mocks.refundImageCredits,
}));
vi.mock("@/lib/newapi", () => ({
  affGateway: mocks.affGateway,
  newApiBaseUrl: mocks.newApiBaseUrl,
  resolvedAffGateway: mocks.affGateway,
  resolvedImageUpstream: mocks.affGateway,
  resolvedNewApiBaseUrl: mocks.newApiBaseUrl,
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
  mocks.resolveExternalApiIdentity.mockResolvedValue({ userId: null, username: null, group: null });
  mocks.ensureManagedFallbackToken.mockResolvedValue(null);
  mocks.trySpendImageCredits.mockResolvedValue(charge);
  mocks.refundImageCredits.mockResolvedValue(undefined);
  mocks.affGateway.mockReturnValue({
    baseUrl: "http://gateway.test",
    token: "gateway-token",
  });
  mocks.newApiBaseUrl.mockReturnValue("http://newapi.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("http://gateway.test"))
        return Response.json({ data: [{ b64_json: "abc" }] });
      if (url.startsWith("http://newapi.test"))
        return Response.json({ data: [{ b64_json: "abc" }] });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

function request() {
  return new Request("http://localhost/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: "Bearer sk-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nai-v5-full",
      prompt: "1girl",
      size: "832x1216",
      n: 1,
      response_format: "b64_json",
    }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("外部 LFN 图像入口计费", () => {
  it("key 无法识别时透明代理到 NewAPI，不扣图包", async () => {
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data?.[0]?.b64_json).toBe("abc");
    expect(mocks.trySpendImageCredits).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => url === "http://newapi.test/v1/images/generations"),
    ).toBe(true);
  });

  it("有效 key 自动识别用户且图包足够时走 Gateway，不把用户 key 发给上游", async () => {
    mocks.resolveExternalApiIdentity.mockResolvedValue({ userId: 41, username: "user-41", group: "ikun" });
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-lfn-payment-source")).toBe("package");
    expect(mocks.resolveExternalApiIdentity).toHaveBeenCalledWith("Bearer sk-test-key");
    expect(mocks.trySpendImageCredits).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ model: "nai-v5-full", samples: 1 }),
    );
    const gatewayCall = vi.mocked(fetch).mock.calls.find(
      ([url]) => url === "http://gateway.test/v1/images/generations",
    );
    expect(gatewayCall).toBeTruthy();
    expect(new Headers(gatewayCall?.[1]?.headers).get("Authorization")).toBe(
      "Bearer gateway-token",
    );
  });

  it("有效 key 但本地额度不足时透传到 NewAPI", async () => {
    mocks.resolveExternalApiIdentity.mockResolvedValue({ userId: 41, username: "user-41", group: "ikun" });
    mocks.trySpendImageCredits.mockResolvedValue(null);
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-lfn-payment-source")).toBe("newapi");
    const calls = vi.mocked(fetch).mock.calls;
    expect(
      calls.some(
        ([url, init]) =>
          url === "http://newapi.test/v1/images/generations" &&
          new Headers(init?.headers).get("Authorization") === "Bearer sk-test-key",
      ),
    ).toBe(true);
  });

  it("非 ikun 分组的有效密钥同样扣图包走 Gateway", async () => {
    mocks.resolveExternalApiIdentity.mockResolvedValue({ userId: 41, username: "user-41", group: "default" });
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-lfn-payment-source")).toBe("package");
    expect(mocks.trySpendImageCredits).toHaveBeenCalledWith(41, expect.anything());
  });

  it("无余额时直接用托管密钥走 NewAPI 计费（按用户分组自动换组）", async () => {
    mocks.resolveExternalApiIdentity.mockResolvedValue({ userId: 41, username: "user-41", group: "default" });
    mocks.trySpendImageCredits.mockResolvedValue(null);
    mocks.ensureManagedFallbackToken.mockResolvedValue("managedkey48hex00000000000000000000");
    const newapiCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("http://newapi.test")) {
          newapiCalls.push(new Headers(init?.headers).get("Authorization") ?? "");
          return Response.json({ data: [{ b64_json: "abc" }] });
        }
        if (url.startsWith("http://gateway.test"))
          return Response.json({ data: [{ b64_json: "abc" }] });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-lfn-payment-source")).toBe("newapi");
    expect(newapiCalls).toEqual(["Bearer sk-managedkey48hex00000000000000000000"]);
    expect(mocks.ensureManagedFallbackToken).toHaveBeenCalledWith(41, "nai-v5-full");
  });

  it("托管密钥不可用时回退原 key 透传并保留原始错误", async () => {
    mocks.resolveExternalApiIdentity.mockResolvedValue({ userId: 41, username: "user-41", group: "default" });
    mocks.trySpendImageCredits.mockResolvedValue(null);
    mocks.ensureManagedFallbackToken.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("http://newapi.test"))
          return Response.json(
            { error: { code: "model_not_found", message: "No available channel for model nai-v5-full under group default (distributor)", type: "new_api_error" } },
            { status: 503 },
          );
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).toContain("No available channel");
  });

  it("数据库故障时返回 502，不透传也不扣图包", async () => {
    mocks.resolveExternalApiIdentity.mockRejectedValue(
      new Error("暂时无法连接账号服务，请稍后重试"),
    );
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.message).toContain("暂时无法连接账号服务");
    expect(mocks.trySpendImageCredits).not.toHaveBeenCalled();
  });
});
