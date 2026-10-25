import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { affLedger, checkInAff, grantAffOnce } from "@/lib/aff";
import { galleryWeekKey } from "@/lib/gallery";
import { grantCreatorReward, listCreatorRewardCampaigns, listCreatorRewardGrants, upsertCreatorRewardCampaign } from "@/lib/creator-rewards";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";
import { listUserNotifications } from "@/lib/notifications";

const originalDataDir = process.env.LFN_DATA_DIR;

afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("runtime rewards", () => {
  it("allows a zero AFF grant without throwing", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-rewards-zero-"));
    await expect(grantAffOnce(7, 0, "zero reward", "zero:7")).resolves.toMatchObject({
      balance: 0,
      granted: true,
    });
    await expect(grantAffOnce(7, 0, "zero reward", "zero:7")).resolves.toMatchObject({
      balance: 0,
      granted: false,
    });
  });

  it("returns disabled check-in state while preserving the existing day", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-rewards-checkin-"));
    await updateRuntimeSettings({ enableDailyCheckIn: true, dailyCheckInReward: 13 });
    await expect(checkInAff(8)).resolves.toMatchObject({
      reward: 13,
      checkedInToday: true,
      checkInEnabled: true,
    });
    const before = await affLedger(8);
    await updateRuntimeSettings({ enableDailyCheckIn: false });
    await expect(checkInAff(8)).resolves.toMatchObject({
      reward: 0,
      checkedInToday: true,
      checkInEnabled: false,
      balance: before.balance,
    });
    expect((await affLedger(8)).transactions).toHaveLength(1);
  });

  it("uses Monday 00:00 UTC as the weekly activity boundary", () => {
    expect(galleryWeekKey(new Date("2026-10-12T00:00:00.000Z"))).toBe("2026-10-12");
    expect(galleryWeekKey(new Date("2026-10-11T23:59:59.999Z"))).toBe("2026-10-05");
    expect(galleryWeekKey(new Date("2026-10-12T07:59:59.999+08:00"))).toBe("2026-10-05");
  });

  it("persists all campaign parameters and rejects an invalid date range", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-rewards-campaign-"));
    await expect(upsertCreatorRewardCampaign({ id: "spring", name: "春季活动", enabled: false, startsAt: "2026-10-12T00:00:00Z", endsAt: "2026-10-31T23:59:59Z", submissionReward: 120, weeklyRewards: [600, 400, 200], budget: 5000 })).resolves.toMatchObject({ id: "spring", enabled: false, submissionReward: 120, weeklyRewards: [600, 400, 200], budget: 5000 });
    await expect(listCreatorRewardCampaigns()).resolves.toEqual([
      expect.objectContaining({ id: "default", name: "创作者奖励" }),
      expect.objectContaining({ id: "spring", startsAt: "2026-10-12T00:00:00.000Z" }),
    ]);
    await expect(upsertCreatorRewardCampaign({ id: "spring", startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-10-31T23:59:59Z" })).rejects.toThrow("开始时间");
  });

  it("treats zero budget as unlimited and skips grants beyond a positive budget", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-rewards-budget-"));
    await upsertCreatorRewardCampaign({ id: "unlimited", name: "不限额", budget: 0 });
    await expect(grantCreatorReward({ kind: "manual", userId: 10, amount: 500, description: "不限额", referenceId: "budget-unlimited", campaignId: "unlimited" })).resolves.toMatchObject({ status: "granted" });
    await expect(listUserNotifications(10)).resolves.toMatchObject({ unreadCount: 1, items: [{ type: "creator-reward", title: "创作者奖励已发放", body: "不限额，已到账 500 AFF。", href: "/profile#profile-rewards" }] });
    await upsertCreatorRewardCampaign({ id: "limited", name: "有限额", budget: 100 });
    await expect(grantCreatorReward({ kind: "manual", userId: 10, amount: 80, description: "有限额", referenceId: "budget-limited-1", campaignId: "limited" })).resolves.toMatchObject({ status: "granted" });
    await expect(grantCreatorReward({ kind: "manual", userId: 10, amount: 30, description: "有限额", referenceId: "budget-limited-2", campaignId: "limited" })).resolves.toMatchObject({ status: "skipped", error: "活动预算已用尽" });
    expect((await listCreatorRewardGrants()).filter((grant) => grant.campaignId === "limited")).toHaveLength(2);
  });
});
