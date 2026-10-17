import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRedeemCodes, listRedemptionHistory, redeemCode, updateRedeemCode } from "@/lib/redeem-codes";

const originalDataDir = process.env.LFN_DATA_DIR;

afterEach(() => {
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("redeem codes", () => {
  it("redeems once, returns idempotent result, and exposes only the user history", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-redeem-"));
    const [created] = await createRedeemCodes({ amount: 120, maxUses: 2, createdBy: 1 });
    await expect(redeemCode(created.code, 7)).resolves.toMatchObject({ alreadyRedeemed: false, item: { userId: 7, amount: 120 } });
    await expect(redeemCode(created.code, 7)).resolves.toMatchObject({ alreadyRedeemed: true, item: { userId: 7, amount: 120 } });
    await expect(redeemCode(created.code, 8)).resolves.toMatchObject({ alreadyRedeemed: false, item: { userId: 8, amount: 120 } });
    await expect(listRedemptionHistory(7)).resolves.toHaveLength(1);
    await expect(listRedemptionHistory(8)).resolves.toHaveLength(1);
  });

  it("rejects disabled and expired codes", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-redeem-state-"));
    const [disabled] = await createRedeemCodes({ amount: 10, maxUses: 1, createdBy: 1 });
    await updateRedeemCode(disabled.id, { enabled: false });
    await expect(redeemCode(disabled.code, 1)).rejects.toThrow("已停用");
    const [expired] = await createRedeemCodes({ amount: 10, maxUses: 1, expiresAt: "2020-01-01T00:00:00.000Z", createdBy: 1 });
    await expect(redeemCode(expired.code, 1)).rejects.toThrow("已过期");
  });
});