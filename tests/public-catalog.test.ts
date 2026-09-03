import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  adminHeaders: vi.fn(() => ({ Authorization: "server-admin-token" })),
  adminToken: vi.fn(() => "server-admin-token"),
  newApiBaseUrl: vi.fn(() => "http://newapi.test"),
}));
vi.mock("@/lib/newapi", () => ({ newApiBaseUrl: sessionMocks.newApiBaseUrl }));

let currentFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  currentFetch = vi.fn(async (url: string) => {
    if (url === "http://newapi.test/api/pricing")
      return Response.json({
        data: [
          {
            model_name: "nai-v5-full",
            billing_mode: "tiered_expr",
            billing_expr: 'tier("base", p * 240000 + c * 0)',
            enable_groups: ["Draw"],
            model_ratio: 123,
            model_price: 200,
            quota_type: 1,
            secret: "must-not-leak",
          },
          {
            model_name: "nai-v5-full-limit",
            quota_type: 1,
            model_price: 6,
            model_ratio: 0,
          },
          { model_name: "nai-chat", quota_type: 1, model_price: 600 },
          { model_name: "openai-secret", model_price: 1 },
          { model_name: "nai-v5-full", model_price: 2 },
        ],
      });
    if (url === "http://newapi.test/api/user/self/groups")
      return Response.json({ data: { Draw: { ratio: 1, secret: "no" } } });
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", currentFetch);
  sessionMocks.adminToken.mockReturnValue("server-admin-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("公开模型与价格目录", () => {
  it("匿名读取时只返回脱敏模型和人民币价格字段", async () => {
    const { GET } = await import("@/app/api/public/catalog/route");
    const response = await GET();
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.currency).toBe("CNY");
    expect(result.models).toHaveLength(3);
    expect(result.models.map((item: { id: string }) => item.id)).toEqual([
      "nai-chat",
      "nai-v5-full",
      "nai-v5-full-limit",
    ]);
    expect(result.models.find((item: { id: string }) => item.id === "nai-v5-full")).toMatchObject({
      kind: "image",
      pricing: {
        billingMode: "live",
        liveType: "tiered",
        liveCnyPerRequest: 0.0096,
        liveCnyPerUsageToken: 0.0012,
        privatePointReference: {
          tokensPerPoint: 50,
          pointPriceCny: 0.06,
          version: "V5",
        },
      },
    });
    expect(result.models.find((item: { id: string }) => item.id === "nai-v5-full-limit")).toMatchObject({
      pricing: {
        billingMode: "live",
        liveType: "per_request",
        liveCnyPerRequest: 0.03,
      },
    });
    const serialized = JSON.stringify(result);
    expect(result.conversion).toContain("1 积分 = 50 token");
    expect(result.conversion).toContain("V4.5 每积分 ¥0.04");
    expect(result.conversion).toContain("V5 每积分 ¥0.06");
    expect(serialized).not.toContain("server-admin-token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("billing_expr");
    expect(serialized).not.toContain("model_ratio");
  });

  it("上游失败时返回内置目录并标记 stale，不冒充空目录", async () => {
    currentFetch.mockRejectedValue(new Error("network down"));
    const { GET } = await import("@/app/api/public/catalog/route");
    const response = await GET();
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.stale).toBe(true);
    expect(result.source).toBe("fallback");
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.message).toContain("network down");
  });
});
