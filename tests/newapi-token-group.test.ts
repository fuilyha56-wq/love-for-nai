import { describe, expect, it, vi } from "vitest";

// resolveToken 会经过 getSession / fetch，这里整体 mock 掉，
// 只验证图像密钥分组选择与创建载荷。
process.env.NEWAPI_BASE_URL = "http://newapi.test";
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const selfMock = vi.fn();
const pricingMock = vi.fn();
const groupsMock = vi.fn();
const tokenListMock = vi.fn();
const tokenCreateMock = vi.fn();
const tokenKeyMock = vi.fn();

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith("/api/user/self")) return selfMock(init);
  if (url.endsWith("/api/pricing")) return pricingMock(init);
  if (url.endsWith("/api/user/self/groups")) return groupsMock(init);
  if (url.includes("/api/token/") && url.includes("/key"))
    return tokenKeyMock(init);
  if (url.endsWith("/api/token/") && init?.method === "POST")
    return tokenCreateMock(init);
  if (url.startsWith("http://newapi.test/api/token/"))
    return tokenListMock(init);
  throw new Error(`unexpected fetch ${url}`);
});
vi.stubGlobal("fetch", fetchMock);

const { getImageToken } = await import("@/lib/newapi");

const session = {
  userId: 1,
  username: "tester",
  displayName: "tester",
  upstreamCookie: "",
  expiresAt: Date.now() + 3600_000,
} as Parameters<typeof getImageToken>[0];

function jsonResponse(payload: unknown, ok = true) {
  return { ok, json: async () => payload, status: ok ? 200 : 400 };
}

describe("图像密钥分组选择", () => {
  it("UserUsableGroups 缺少 Draw 时仍按渠道分组创建密钥", async () => {
    selfMock.mockResolvedValue(
      jsonResponse({ success: true, data: { user: { group: "default" } } }),
    );
    pricingMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            model_name: "nai-v4.5-full",
            enable_groups: ["Draw", "Draw-Limit"],
          },
        ],
      }),
    );
    // 关键场景：可用分组里没有 Draw。
    groupsMock.mockResolvedValue(
      jsonResponse({ success: true, data: ["default", "vip"] }),
    );
    tokenListMock.mockResolvedValue(
      jsonResponse({ success: true, data: { items: [] } }),
    );
    tokenCreateMock.mockResolvedValue(
      jsonResponse({ success: true, data: {} }),
    );
    // 创建后列表里出现新密钥。
    let created = false;
    tokenListMock.mockImplementation(async () => {
      if (!created)
        return jsonResponse({ success: true, data: { items: [] } });
      return jsonResponse({
        success: true,
        data: {
          items: [
            { id: 9, name: "lfn-image-studio-draw", status: 1, group: "Draw" },
          ],
        },
      });
    });
    tokenCreateMock.mockImplementation(async () => {
      created = true;
      return jsonResponse({ success: true, data: {} });
    });
    tokenKeyMock.mockResolvedValue(
      jsonResponse({ success: true, data: { key: "sk-test" } }),
    );

    const key = await getImageToken(session, "nai-v4.5-full");
    expect(key).toBe("sk-test");
    const body = JSON.parse(
      tokenCreateMock.mock.calls[0][0].body as string,
    ) as Record<string, unknown>;
    expect(body.group).toBe("Draw");
  });

  it("已有同分组密钥时直接复用，不再创建", async () => {
    selfMock.mockResolvedValue(
      jsonResponse({ success: true, data: { user: { group: "vip" } } }),
    );
    pricingMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [{ model_name: "nai-v5-full", enable_groups: ["Draw"] }],
      }),
    );
    groupsMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    tokenListMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          items: [
            { id: 7, name: "lfn-image-studio-draw", status: 1, group: "Draw" },
          ],
        },
      }),
    );
    tokenCreateMock.mockClear();
    tokenKeyMock.mockResolvedValue(
      jsonResponse({ success: true, data: { key: "sk-reuse" } }),
    );

    const key = await getImageToken(session, "nai-v5-full");
    expect(key).toBe("sk-reuse");
    expect(tokenCreateMock).not.toHaveBeenCalled();
  });
});
