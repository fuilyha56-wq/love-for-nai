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
            billing_expr: 'tier("limit", p * 8) + tier("full", p * 130000)',
            enable_groups: ["Draw"],
            model_ratio: 123,
            model_price: 999,
            quota_type: 0,
            secret: "must-not-leak",
          },
          { model_name: "nai-chat", quota_type: 1, model_price: 600 },
          { model_name: "openai-secret", model_price: 1 },
          { model_name: "nai-v5-full", model_price: 2 },
        ],
      });
    if (url === "http://newapi.test/api/user/self/groups")
      return Response.json({ data: { Draw: { ratio: 0.5, secret: "no" } } });
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
    expect(result.models).toHaveLength(2);
    expect(result.models.map((item: { id: string }) => item.id)).toEqual([
      "nai-chat",
      "nai-v5-full",
    ]);
    expect(result.models.find((item: { id: string }) => item.id === "nai-v5-full")).toMatchObject({
      kind: "image",
      pricing: {
        billingMode: "tiered",
        groupName: "Draw",
        groupRatio: 0.5,
      },
    });
    const pricing = result.models.find((item: { id: string }) => item.id === "nai-v5-full").pricing;
    expect(pricing.inEnvelopeCny).toBeGreaterThan(0);
    expect(pricing.inEnvelopeCny).toBeCloseTo(pricing.inEnvelopeBalance / 200, 10);
    const serialized = JSON.stringify(result);
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
