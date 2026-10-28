import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dataDir: string;
beforeEach(async () => { dataDir = await mkdtemp(path.join(tmpdir(), "lfn-notifications-")); process.env.LFN_DATA_DIR = dataDir; });
afterEach(async () => { delete process.env.LFN_DATA_DIR; await rm(dataDir, { recursive: true, force: true }); });

describe("站内消息", () => {
  it("按用户隔离消息、幂等去重并维护单条和全部已读状态", async () => {
    const { createUserNotification, listUserNotifications, markUserNotificationRead } = await import("@/lib/notifications");
    const first = await createUserNotification({ userId: 8, type: "announcement-reply", title: "有人回复你", body: "看下这条回复", href: "/announcements?comment=abc", dedupeKey: "reply:abc" });
    await createUserNotification({ userId: 8, type: "announcement-reply", title: "重复事件", body: "不重复", href: "/announcements", dedupeKey: "reply:abc" });
    await createUserNotification({ userId: 9, type: "creator-reward", title: "奖励已发放", body: "100 AFF", href: "/profile#profile-rewards" });
    expect(await listUserNotifications(8)).toMatchObject({ items: [first], unreadCount: 1 });
    expect((await listUserNotifications(9)).unreadCount).toBe(1);
    expect(await markUserNotificationRead(8, first!.id)).toEqual({ unreadCount: 0 });
    expect((await listUserNotifications(8)).items[0].readAt).toBeTruthy();
    expect(await markUserNotificationRead(9)).toEqual({ unreadCount: 0 });
  });

  it("不同路由模块并发创建消息不会覆盖另一设备的已读回执", async () => {
    const firstRoute = await import("@/lib/notifications");
    const seen = await firstRoute.createUserNotification({ userId: 8, type: "system", title: "已经查看", body: "", href: "/image" });
    vi.resetModules();
    const secondRoute = await import("@/lib/notifications");
    await Promise.all([
      firstRoute.markUserNotificationRead(8, seen!.id),
      ...Array.from({ length: 20 }, (_, i) => (i % 2 ? firstRoute : secondRoute).createUserNotification({
        userId: 8, type: "system", title: `新消息 ${i}`, body: "", href: "/image", dedupeKey: `concurrent:${i}`,
      })),
    ]);
    const otherDevice = await secondRoute.listUserNotifications(8);
    expect(otherDevice.items).toHaveLength(21);
    expect(otherDevice.items.find(item => item.id === seen!.id)?.readAt).toBeTruthy();
    expect(otherDevice.unreadCount).toBe(20);
    await firstRoute.markUserNotificationRead(8);
    expect((await secondRoute.listUserNotifications(8)).unreadCount).toBe(0);
    expect((await secondRoute.listUserNotifications(8)).items.every(item => item.readAt)).toBe(true);
  });
});
