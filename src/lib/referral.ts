import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { grantAffOnce } from "@/lib/aff";

const REFERRAL_REWARD = 100;
const CODE_LENGTH = 12;

type Referral = {
  code: string;
  inviterUserId: number;
  createdAt: string;
  registeredUserIds: number[];
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
): Promise<{ reward: number; applied: boolean }> {
  return withLock(async () => {
    const store = await readStore();
    const referral = store.referrals.find((item) => item.code === code);
    if (!referral || referral.inviterUserId === registeredUserId)
      return { reward: 0, applied: false };

    const referenceId = `referral-registration:${registeredUserId}`;
    const grant = await grantAffOnce(
      registeredUserId,
      REFERRAL_REWARD,
      "邀请注册奖励",
      referenceId,
    );
    // 邀请人与被邀请人各得一份，各自独立幂等。
    await grantAffOnce(
      referral.inviterUserId,
      REFERRAL_REWARD,
      "邀请新用户注册奖励",
      `referral-invite:${registeredUserId}`,
    );
    if (!referral.registeredUserIds.includes(registeredUserId)) {
      referral.registeredUserIds.push(registeredUserId);
      await writeStore(store);
    }
    return { reward: grant.granted ? REFERRAL_REWARD : 0, applied: true };
  });
}

export const referralReward = (): number => REFERRAL_REWARD;

export async function listReferrals(): Promise<Referral[]> {
  return (await readStore()).referrals;
}

export async function countReferrals(): Promise<number> {
  return (await readStore()).referrals.length;
}