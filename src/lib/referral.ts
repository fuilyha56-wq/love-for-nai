import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { grantAffOnce } from "@/lib/aff";
import { runtimeRewards } from "@/lib/runtime-config";

const CODE_LENGTH = 12;

export type ReferralRegistration = {
  registeredUserId: number;
  code: string;
  inviterUserId: number;
  /** Server-built canonical URL actually associated with this redemption. */
  invitationLink?: string;
  registeredAt: string;
  /** Client supplied diagnostic value; never use as a redirect target. */
  landingPath?: string;
  referer?: string;
  clientIpHash?: string;
  userAgent?: string;
  requestId?: string;
  reward: number;
  applied: boolean;
};

export type Referral = {
  code: string;
  inviterUserId: number;
  createdAt: string;
  registeredUserIds: number[];
  registrations?: ReferralRegistration[];
};

export type ReferralProvenance = {
  invitationLink?: string;
  /** Client supplied diagnostic value; never use as a redirect target. */
  landingPath?: string;
  referer?: string;
  clientIpHash?: string;
  userAgent?: string;
  requestId?: string;
};

type ReferralStore = { referrals: Referral[] };

const referralPath = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "referrals.json",
  );

let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<ReferralStore> {
  try {
    const parsed = JSON.parse(await readFile(referralPath(), "utf8")) as ReferralStore;
    return { referrals: Array.isArray(parsed.referrals) ? parsed.referrals : [] };
  } catch {
    return { referrals: [] };
  }
}

async function writeStore(store: ReferralStore): Promise<void> {
  const target = referralPath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, target);
}

function newCode(): string {
  return randomBytes(9).toString("base64url").slice(0, CODE_LENGTH);
}

export function canonicalReferralLink(origin: string, code: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  return `${base}/sign-in?invite=${encodeURIComponent(code)}`;
}

function registrationForUser(
  referrals: Referral[],
  registeredUserId: number,
): { referral: Referral; registration?: ReferralRegistration } | null {
  for (const referral of referrals) {
    const registration = referral.registrations?.find(
      (item) => item.registeredUserId === registeredUserId,
    );
    if (registration || referral.registeredUserIds.includes(registeredUserId))
      return { referral, registration };
  }
  return null;
}

/** Supports both provenance records and the original ID-only format. */
export async function findReferralByRegisteredUser(
  registeredUserId: number,
): Promise<{ referral: Referral; registration?: ReferralRegistration } | null> {
  return registrationForUser((await readStore()).referrals, registeredUserId);
}

export function referralInvitedCount(referral: Referral): number {
  const ids = new Set(referral.registeredUserIds);
  for (const registration of referral.registrations || [])
    ids.add(registration.registeredUserId);
  return ids.size;
}

export async function referralForInviter(userId: number): Promise<Referral> {
  return withLock(async () => {
    const store = await readStore();
    let referral = store.referrals.find((item) => item.inviterUserId === userId);
    if (!referral) {
      referral = {
        code: newCode(),
        inviterUserId: userId,
        createdAt: new Date().toISOString(),
        registeredUserIds: [],
      };
      store.referrals.push(referral);
      await writeStore(store);
    }
    return referral;
  });
}

export async function redeemReferral(
  code: string,
  registeredUserId: number,
  provenance: ReferralProvenance = {},
): Promise<{ reward: number; applied: boolean; inviterId: number }> {
  const rewards = await runtimeRewards();
  if (!rewards.referralEnabled) return { reward: 0, applied: false, inviterId: 0 };
  return withLock(async () => {
    const store = await readStore();
    const referral = store.referrals.find((item) => item.code === code);
    if (!referral || referral.inviterUserId === registeredUserId)
      return { reward: 0, applied: false, inviterId: 0 };

    // The first referral source wins globally, including old ID-only records.
    const existing = registrationForUser(store.referrals, registeredUserId);
    if (existing)
      return { reward: 0, applied: false, inviterId: existing.referral.inviterUserId };

    const reward = rewards.referralReward;
    const grant = await grantAffOnce(
      registeredUserId,
      reward,
      "邀请注册奖励",
      `referral-registration:${registeredUserId}`,
    );
    await grantAffOnce(
      referral.inviterUserId,
      reward,
      "邀请新用户注册奖励",
      `referral-invite:${registeredUserId}`,
    );
    if (!referral.registeredUserIds.includes(registeredUserId))
      referral.registeredUserIds.push(registeredUserId);
    referral.registrations ||= [];
    referral.registrations.push({
      registeredUserId,
      code: referral.code,
      inviterUserId: referral.inviterUserId,
      invitationLink: provenance.invitationLink,
      registeredAt: new Date().toISOString(),
      landingPath: provenance.landingPath,
      referer: provenance.referer,
      clientIpHash: provenance.clientIpHash,
      userAgent: provenance.userAgent,
      requestId: provenance.requestId,
      reward: grant.granted ? reward : 0,
      applied: grant.granted,
    });
    await writeStore(store);
    return {
      reward: grant.granted ? reward : 0,
      applied: grant.granted,
      inviterId: referral.inviterUserId,
    };
  });
}

export async function findReferralByCode(code: string): Promise<Referral | null> {
  if (!code) return null;
  return (await readStore()).referrals.find((item) => item.code === code) ?? null;
}

export async function referralReward(): Promise<number> {
  return (await runtimeRewards()).referralReward;
}

export async function listReferrals(): Promise<Referral[]> {
  return (await readStore()).referrals;
}

export async function countReferrals(): Promise<number> {
  return (await readStore()).referrals.length;
}