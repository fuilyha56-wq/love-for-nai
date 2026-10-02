import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalReferralLink,
  findReferralByRegisteredUser,
  listReferrals,
  redeemReferral,
  referralForInviter,
} from "@/lib/referral";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";

const originalDataDir = process.env.LFN_DATA_DIR;

afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("referral provenance", () => {
  it("stores the server canonical link and diagnostic provenance", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-referral-provenance-"));
    const referral = await referralForInviter(11);
    const link = canonicalReferralLink("https://example.test/", referral.code);

    await expect(
      redeemReferral(referral.code, 22, {
        invitationLink: link,
        landingPath: "/sign-in?invite=code&source=campaign",
        referer: "https://example.test/sign-in?invite=code",
        clientIpHash: "a".repeat(64),
        userAgent: "test-agent",
        requestId: "request-1",
      }),
    ).resolves.toMatchObject({ reward: 100, applied: true, inviterId: 11 });

    const registration = (await findReferralByRegisteredUser(22))?.registration;
    expect(registration).toMatchObject({
      invitationLink: link,
      registeredUserId: 22,
      inviterUserId: 11,
      landingPath: "/sign-in?invite=code&source=campaign",
      clientIpHash: "a".repeat(64),
      userAgent: "test-agent",
      requestId: "request-1",
      reward: 100,
      applied: true,
    });
  });

  it("keeps the first inviter globally and makes duplicate redemption a no-op", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-referral-first-"));
    const first = await referralForInviter(1);
    const second = await referralForInviter(2);
    await redeemReferral(first.code, 9);
    await expect(redeemReferral(second.code, 9)).resolves.toEqual({
      reward: 0,
      applied: false,
      inviterId: 1,
    });
    expect((await listReferrals()).map((item) => item.registeredUserIds)).toEqual([[9], []]);
    expect((await findReferralByRegisteredUser(9))?.referral.inviterUserId).toBe(1);
  });

  it("supports legacy registeredUserIds without provenance records", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-referral-legacy-"));
    const referral = await referralForInviter(3);
    const file = path.join(process.env.LFN_DATA_DIR!, "referrals.json");
    const raw = JSON.parse(await readFile(file, "utf8")) as { referrals: Array<Record<string, unknown>> };
    raw.referrals[0].registeredUserIds = [44];
    await import("node:fs/promises").then(({ writeFile }) => writeFile(file, JSON.stringify(raw)));
    await expect(redeemReferral(referral.code, 44)).resolves.toEqual({
      reward: 0,
      applied: false,
      inviterId: 3,
    });
    expect((await findReferralByRegisteredUser(44))?.referral.inviterUserId).toBe(3);
  });

  it("does not grant or bind referrals while disabled", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-referral-disabled-"));
    await updateRuntimeSettings({ enableReferral: false });
    const referral = await referralForInviter(5);
    await expect(redeemReferral(referral.code, 6)).resolves.toEqual({
      reward: 0,
      applied: false,
      inviterId: 0,
    });
    expect((await listReferrals())[0].registeredUserIds).toEqual([]);
  });
});
