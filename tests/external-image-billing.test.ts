import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveBoundExternalApiUser: vi.fn(),
  trySpendImageCredits: vi.fn(),
  refundImageCredits: vi.fn(),
  affGateway: vi.fn(),
  newApiBaseUrl: vi.fn(),
  getImageToken: vi.fn(),
  imageFromResult: vi.fn(),
}));

vi.mock("@/lib/external-api-bindings", () => ({
  resolveBoundExternalApiUser: mocks.resolveBoundExternalApiUser,
}));
vi.mock("@/lib/aff", () => ({
  trySpendImageCredits: mocks.trySpendImageCredits,
  refundImageCredits: mocks.refundImageCredits,
}));
vi.mock("@/lib/newapi", () => ({
  affGateway: mocks.affGateway,
  newApiBaseUrl: mocks.newApiBaseUrl,
  getImageToken: mocks.getImageToken,
  imageFromResult: mocks.imageFromResult,
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
  mocks.resolveBoundExternalApiUser.mockResolvedValue(null);
  mocks.trySpendImageCredits.mockResolvedValue(charge);
  mocks.refundImageCredits.mockResolvedValue(undefined);
  mocks.affGateway.mockReturnValue({
    baseUrl: "http://gateway.test",
    token: "gateway-token",
  });
  mocks.newApiBaseUrl.mockReturnValue("http://newapi.test");
  mocks.getImageToken.mockResolvedValue("newapi-token");
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

describe("外部 LFN 图像入口计费", () => {
  it("未绑定 key 时拒绝且不扣任何 AFF", async () => {
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("lfn_key_not_bound");
    expect(mocks.trySpendImageCredits).not.toHaveBeenCalled();
  });

  it("绑定 key 且图包足够时走 Gateway，不把用户 key 发给上游", async () => {
    mocks.resolveBoundExternalApiUser.mockResolvedValue(41);
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-lfn-payment-source")).toBe("package");
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

  it("绑定 key 但本地额度不足时透传到 NewAPI", async () => {
    mocks.resolveBoundExternalApiUser.mockResolvedValue(41);
    mocks.trySpendImageCredits.mockResolvedValue(null);
    const { POST } = await import("@/app/v1/images/generations/route");
    const response = await POST(request());

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
});
