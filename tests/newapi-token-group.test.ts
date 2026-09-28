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

// 模块级 token 缓存按 userId|model 做 key，每个用例用独立 userId 避免串味。
let nextUserId = 1;
function makeSession() {
  return {
    userId: nextUserId++,
    username: "tester",
    displayName: "tester",
    upstreamCookie: "",
    expiresAt: Date.now() + 3600_000,
  } as Parameters<typeof getImageToken>[0];
}

function jsonResponse(payload: unknown, ok = true) {
  return { ok, json: async () => payload, status: ok ? 200 : 400 };
}

describe("模型密钥分组选择", () => {
  it("用户分组与模型渠道匹配时优先复用用户分组", async () => {
    selfMock.mockResolvedValue(
      jsonResponse({ success: true, data: { user: { group: "default" } } }),
    );
    pricingMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            model_name: "nai-v4.5-full",
            enable_groups: ["ikun", "Draw"],
          },
        ],
      }),
    );
    groupsMock.mockResolvedValue(
      jsonResponse({ success: true, data: ["default", "ikun"] }),
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
            { id: 9, name: "lfn-image-studio-ikun", status: 1, group: "ikun" },
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

    const key = await getImageToken(makeSession(), "nai-v4.5-full");
    expect(key).toBe("sk-test");
    const body = JSON.parse(
      tokenCreateMock.mock.calls[0][0].body as string,
    ) as Record<string, unknown>;
    expect(body.group).toBe("ikun");
  });

  it("用户不在专属分组时自动改用模型可用的自有渠道分组（Draw）", async () => {
    // 无图包用户（default 分组）生图：模型渠道里没有用户可用的分组时，
    // 回退到用户自有分组（Draw）对应的渠道，保证走 NewAPI 余额计费。
    selfMock.mockResolvedValue(
      jsonResponse({ success: true, data: { user: { group: "Draw" } } }),
    );
    pricingMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            model_name: "nai-v5-full",
            enable_groups: ["ikun", "Draw"],
          },
        ],
      }),
    );
    groupsMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    tokenCreateMock.mockClear();
    tokenListMock.mockResolvedValue(
      jsonResponse({ success: true, data: { items: [] } }),
    );
    let created = false;
    tokenListMock.mockImplementation(async () => {
      if (!created)
        return jsonResponse({ success: true, data: { items: [] } });
      return jsonResponse({
        success: true,
        data: {
          items: [
            { id: 11, name: "lfn-image-studio-draw", status: 1, group: "Draw" },
          ],
        },
      });
    });
    tokenCreateMock.mockImplementation(async () => {
      created = true;
      return jsonResponse({ success: true, data: {} });
    });
    tokenKeyMock.mockResolvedValue(
      jsonResponse({ success: true, data: { key: "sk-draw" } }),
    );

    const key = await getImageToken(makeSession(), "nai-v5-full");
    expect(key).toBe("sk-draw");
    const body = JSON.parse(
      tokenCreateMock.mock.calls[0][0].body as string,
    ) as Record<string, unknown>;
    expect(body.group).toBe("Draw");
  });

  it("用户在专属分组但模型未开放该分组渠道时回退到可用渠道分组", async () => {
    // 9/24 后注册的用户被划进 ikun 分组，但 NAI 渠道未挂 ikun：
    // 必须回退到模型开放且用户可用的 Draw，而不是创建出无法调用的 ikun 密钥。
    selfMock.mockResolvedValue(
      jsonResponse({ success: true, data: { user: { group: "ikun" } } }),
    );
    pricingMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            model_name: "nai-v5-full",
            enable_groups: ["Draw", "Draw-Limit-2"],
          },
        ],
      }),
    );
    groupsMock.mockResolvedValue(
      jsonResponse({ success: true, data: ["default", "Draw"] }),
    );
    tokenCreateMock.mockClear();
    tokenListMock.mockResolvedValue(
      jsonResponse({ success: true, data: { items: [] } }),
    );
    let created = false;
    tokenListMock.mockImplementation(async () => {
      if (!created)
        return jsonResponse({ success: true, data: { items: [] } });
      return jsonResponse({
        success: true,
        data: {
          items: [
            { id: 12, name: "lfn-image-studio-draw", status: 1, group: "Draw" },
          ],
        },
      });
    });
    tokenCreateMock.mockImplementation(async () => {
      created = true;
      return jsonResponse({ success: true, data: {} });
    });
    tokenKeyMock.mockResolvedValue(
      jsonResponse({ success: true, data: { key: "sk-fallback" } }),
    );

    const key = await getImageToken(makeSession(), "nai-v5-full");
    expect(key).toBe("sk-fallback");
    const body = JSON.parse(
      tokenCreateMock.mock.calls[0][0].body as string,
    ) as Record<string, unknown>;
    expect(body.group).toBe("Draw");
  });

  it("已有同分组密钥时直接复用，不再创建", async () => {
    selfMock.mockResolvedValue(
      jsonResponse({ success: true, data: { user: { group: "ikun" } } }),
    );
    pricingMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [{ model_name: "nai-v5-full", enable_groups: ["ikun", "Draw"] }],
      }),
    );
    groupsMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    tokenListMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          items: [
            { id: 7, name: "lfn-image-studio-ikun", status: 1, group: "ikun" },
          ],
        },
      }),
    );
    tokenCreateMock.mockClear();
    tokenKeyMock.mockResolvedValue(
      jsonResponse({ success: true, data: { key: "sk-reuse" } }),
    );

    const key = await getImageToken(makeSession(), "nai-v5-full");
    expect(key).toBe("sk-reuse");
    expect(tokenCreateMock).not.toHaveBeenCalled();
  });
});
