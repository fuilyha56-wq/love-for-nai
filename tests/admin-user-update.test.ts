import { beforeEach, describe, expect, it, vi } from "vitest";

// 管理端更新用户走三段上游调用：requireAdmin 的 /api/user/self、
// 取当前资料的 GET /api/user/:id、写资料的 PUT /api/user/，
// 以及余额专用的 POST /api/user/manage。这里全部 mock 掉，
// 只验证 LFN 转发的载荷符合 new-api 的真实约束。
process.env.NEWAPI_BASE_URL = "http://newapi.test";
process.env.QUOTA_PER_UNIT = "500000";

const session = {
  userId: 3,
  username: "admin",
  systemToken: "sys-token",
  accessToken: "",
  upstreamCookie: "",
  expiresAt: Date.now() + 3600_000,
};

vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => session) }));
vi.mock("@/lib/aff", () => ({
  adjustAff: vi.fn(async () => {}),
  affStatus: vi.fn(async () => ({ balance: 0 })),
}));

type Call = { url: string; init?: RequestInit };

let calls: Call[] = [];
let currentUser: Record<string, unknown> = {};
let putResult: { ok: boolean; body: unknown } = { ok: true, body: { success: true } };

beforeEach(() => {
  calls = [];
  currentUser = {
    id: 9,
    username: "target",
    display_name: "旧名",
    group: "default",
    remark: "旧备注",
    quota: 500000,
  };
  putResult = { ok: true, body: { success: true } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      calls.push({ url: target, init });
      if (target.endsWith("/api/user/self"))
        return Response.json({
          success: true,
          data: { role: 10, user: { role: 10 } },
        });
      if (/\/api\/user\/\d+$/.test(target) && !init?.method)
        return Response.json({ success: true, data: currentUser });
      if (target.endsWith("/api/user/") && init?.method === "PUT")
        return Response.json(putResult.body, { status: putResult.ok ? 200 : 400 });
      if (target.endsWith("/api/user/manage") && init?.method === "POST")
        return Response.json({ success: true });
      throw new Error(`unexpected fetch ${target}`);
    }),
  );
  vi.resetModules();
});

function updateRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/users/update", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: 9,
      username: "target",
      displayName: "新名",
      remark: "新备注",
      group: "Draw",
      balanceUsd: 1,
      affDelta: 0,
      ...body,
    }),
  });
}

const callTo = (path: string, method?: string) =>
  calls.find(
    (call) =>
      call.url.endsWith(path) && (!method || call.init?.method === method),
  );

async function loadRoute() {
  return import("@/app/api/admin/users/update/route");
}

describe("管理员更新用户代理路由", () => {
  it("PUT /api/user/ 必带 username 且按列回填完整资料", async () => {
    const { PUT } = await loadRoute();
    const response = await PUT(updateRequest({}));

    expect(response.status).toBe(200);
    const put = callTo("/api/user/", "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      id: 9,
      username: "target",
      display_name: "新名",
      remark: "新备注",
      group: "Draw",
    });
  });

  it("余额变化走 POST /api/user/manage 的 add_quota override", async () => {
    const { PUT } = await loadRoute();
    await PUT(updateRequest({ balanceUsd: 2 }));

    const manage = callTo("/api/user/manage", "POST");
    expect(manage).toBeTruthy();
    expect(JSON.parse(String(manage?.init?.body))).toEqual({
      id: 9,
      action: "add_quota",
      value: 1000000,
      mode: "override",
    });
  });

  it("余额与当前值一致时跳过 manage，避免旧值覆盖用户消费", async () => {
    const { PUT } = await loadRoute();
    await PUT(updateRequest({ balanceUsd: 1 }));

    expect(callTo("/api/user/manage", "POST")).toBeUndefined();
  });

  it("资料 PUT 失败时返回上游消息且不再写余额", async () => {
    putResult = { ok: false, body: { success: false, message: "Invalid parameters" } };
    const { PUT } = await loadRoute();
    const response = await PUT(updateRequest({ balanceUsd: 5 }));
    const body = (await response.json()) as { message?: string };

    expect(response.status).toBe(400);
    expect(body.message).toBe("Invalid parameters");
    expect(callTo("/api/user/manage", "POST")).toBeUndefined();
  });

  it("缺省字段回填当前资料而不是清空", async () => {
    const { PUT } = await loadRoute();
    await PUT(updateRequest({ displayName: undefined, remark: undefined }));

    const put = JSON.parse(String(callTo("/api/user/", "PUT")?.init?.body));
    expect(put.display_name).toBe("旧名");
    expect(put.remark).toBe("旧备注");
  });

  it("AFF 增减透传到 adjustAff", async () => {
    const { PUT } = await loadRoute();
    await PUT(updateRequest({ affDelta: -50 }));
    const { adjustAff } = await import("@/lib/aff");

    expect(adjustAff).toHaveBeenCalledWith(
      9,
      -50,
      expect.stringContaining("管理员调整"),
    );
  });
});
