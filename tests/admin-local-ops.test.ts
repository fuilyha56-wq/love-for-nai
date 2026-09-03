import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adjustAff, adjustPackageBalance, affLedger, listAffLedgers } from "@/lib/aff";
import { createLocalUser, updateLocalUser } from "@/lib/local-users";
import { listReferrals, redeemReferral, referralForInviter } from "@/lib/referral";

const original = process.env.LFN_DATA_DIR;

afterEach(() => {
  if (original == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = original;
});

describe("本地管理操作", () => {
  it("管理员可改角色/停用，但不能取消最后一位管理员", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-admin-users-"));
    const admin = await createLocalUser({ username: "admin", password: "password1" });
    const member = await createLocalUser({ username: "member", password: "password1" });
    expect(admin.role).toBe(10);
    const promoted = await updateLocalUser(member.id, { role: 10 });
    expect(promoted.role).toBe(10);
    await expect(updateLocalUser(admin.id, { role: 1 })).resolves.toMatchObject({ role: 1 });
    await expect(updateLocalUser(member.id, { role: 1 })).rejects.toThrow("不能取消最后一位管理员");
    await expect(updateLocalUser(member.id, { status: 0 })).rejects.toThrow("不能停用最后一位管理员");
  });

  it("额度账本可发放个人和图包额度并列出流水", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-admin-credits-"));
    await adjustAff(9, 50, "管理员发放");
    await adjustPackageBalance(9, 80, "管理员发放图包");
    const ledger = await affLedger(9);
    expect(ledger.balance).toBe(50);
    expect(ledger.packageBalance).toBe(80);
    expect(ledger.transactions[0]?.amount).toBe(80);
    expect((await listAffLedgers())[0]?.userId).toBe(9);
  });

  it("邀请记录可列出邀请码和注册人数", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-admin-ref-"));
    const referral = await referralForInviter(1);
    await redeemReferral(referral.code, 2);
    const listed = await listReferrals();
    expect(listed).toHaveLength(1);
    expect(listed[0].registeredUserIds).toEqual([2]);
  });
});
