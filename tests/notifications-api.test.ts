import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), list: vi.fn(), mark: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/notifications", () => ({ listUserNotifications: mocks.list, markUserNotificationRead: mocks.mark }));
import { GET, PATCH } from "@/app/api/notifications/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: 8 });
  mocks.list.mockResolvedValue({ items: [], unreadCount: 0 });
  mocks.mark.mockResolvedValue({ unreadCount: 0 });
});
const patch = (body: unknown) => PATCH(new Request("http://localhost/api/notifications", { method: "PATCH", body: JSON.stringify(body) }));

describe("消息已读接口", () => {
  it("始终按当前会话用户读取和标记，禁止缓存已读结果", async () => {
    const response = await GET(new Request("http://localhost/api/notifications?limit=1"));
    expect(mocks.list).toHaveBeenCalledWith(8, 1);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await patch({ id: "message-1", userId: 9 })).status).toBe(200);
    expect(mocks.mark).toHaveBeenCalledWith(8, "message-1");
  });
  it("空消息 ID 不能意外把全部消息标成已读", async () => {
    for (const body of [{ id: "" }, { id: "   " }, { id: 3 }, {}, null]) expect((await patch(body)).status).toBe(400);
    expect(mocks.mark).not.toHaveBeenCalled();
    expect((await patch({ all: true })).status).toBe(200);
    expect(mocks.mark).toHaveBeenCalledWith(8, undefined);
  });
  it("未登录设备不能读取或修改消息", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/notifications"))).status).toBe(401);
    expect((await patch({ all: true })).status).toBe(401);
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
