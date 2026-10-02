import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { affLedger, checkInAff, grantAffOnce } from "@/lib/aff";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";

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
});
