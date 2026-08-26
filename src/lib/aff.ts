import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type AffTransaction = {
  id: string;
  createdAt: string;
  amount: number;
  type: "check-in" | "generation" | "refund" | "referral";
  description: string;
  referenceId?: string;
};

type AffAccount = {
  balance: number;
  lastCheckInDay?: string;
  transactions: AffTransaction[];
};

export type AffGeneration = {
  model: string;
  width: number;
  height: number;
  steps: number;
  samples: number;
  strength?: number;
  operation?: string;
  referenceImageCount?: number;
  encodedVibeCount?: number;
};

const CHECK_IN_REWARD = 20;
const MAX_TRANSACTIONS = 100;
const affRoot = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "aff",
  );
const accountPath = (userId: number) => path.join(affRoot(), `${userId}.json`);

const userLocks = new Map<number, Promise<unknown>>();

function chinaDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(now);
}

function emptyAccount(): AffAccount {
  return { balance: 0, transactions: [] };
}

async function readAccount(userId: number): Promise<AffAccount> {
  try {
    const parsed = JSON.parse(await readFile(accountPath(userId), "utf8")) as AffAccount;
    return {
      balance: Number.isInteger(parsed.balance) && parsed.balance >= 0 ? parsed.balance : 0,
      lastCheckInDay: typeof parsed.lastCheckInDay === "string" ? parsed.lastCheckInDay : undefined,
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions.slice(0, MAX_TRANSACTIONS) : [],
    };
  } catch {
    return emptyAccount();
  }
}

async function writeAccount(userId: number, account: AffAccount): Promise<void> {
  await mkdir(affRoot(), { recursive: true });
  const target = accountPath(userId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(account, null, 2), "utf8");
  await rename(temporary, target);
}

function withUserLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const previous = userLocks.get(userId) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => undefined);
  userLocks.set(userId, tail);
  void tail.then(() => {
    if (userLocks.get(userId) === tail) userLocks.delete(userId);
  });
  return current;
}

function addTransaction(
  account: AffAccount,
  amount: number,
  type: AffTransaction["type"],
  description: string,
  referenceId?: string,
): void {
  account.transactions.unshift({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    amount,
    type,
    description,
    ...(referenceId ? { referenceId } : {}),
  });
  account.transactions = account.transactions.slice(0, MAX_TRANSACTIONS);
}

export function affCost(generation: AffGeneration): number {
  const model = generation.model.toLowerCase();
  if (model.includes("-limit")) {
    if (model.includes("nai-v5")) return Math.ceil(1.5 * generation.samples);
    return generation.samples;
  }

  const pixels = Math.max(generation.width * generation.height, 65_536);
  let perSample = Math.ceil(
    2.951823174884865e-6 * pixels +
      5.753298233447344e-7 * pixels * generation.steps,
  );
  if (generation.strength != null && generation.strength < 1)
    perSample = Math.max(Math.ceil(perSample * generation.strength), 2);
  let total = perSample * generation.samples;
  const referenceCount = generation.referenceImageCount ?? 0;
  if (referenceCount > 0) {
    if (generation.operation === "precise-reference")
      total += 5 * referenceCount * generation.samples;
    else {
      const billableCount = Math.max(
        0,
        referenceCount - (generation.encodedVibeCount ?? 0),
      );
      total += 2 * billableCount + 2 * Math.max(0, billableCount - 4);
    }
  }
  if (model.includes("nai-v5")) total *= 2;
  return Math.max(1, Math.ceil(total));
}

export async function affStatus(userId: number): Promise<{
  balance: number;
  checkedInToday: boolean;
  checkInReward: number;
}> {
  const account = await readAccount(userId);
  return {
    balance: account.balance,
    checkedInToday: account.lastCheckInDay === chinaDay(),
    checkInReward: CHECK_IN_REWARD,
  };
}

export async function checkInAff(userId: number): Promise<{
  balance: number;
  reward: number;
  checkedInToday: boolean;
}> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const today = chinaDay();
    if (account.lastCheckInDay === today)
      return { balance: account.balance, reward: 0, checkedInToday: true };
    account.balance += CHECK_IN_REWARD;
    account.lastCheckInDay = today;
    addTransaction(account, CHECK_IN_REWARD, "check-in", "每日签到奖励");
    await writeAccount(userId, account);
    return { balance: account.balance, reward: CHECK_IN_REWARD, checkedInToday: true };
  });
}

export async function spendAff(
  userId: number,
  generation: AffGeneration,
): Promise<{ cost: number; balance: number }> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const cost = affCost(generation);
    if (account.balance < cost)
      throw new Error(`AFF 余额不足：本次需要 ${cost} AFF，当前余额 ${account.balance} AFF`);
    account.balance -= cost;
    addTransaction(
      account,
      -cost,
      "generation",
      `${generation.model} ${generation.width}x${generation.height}，${generation.samples} 张`,
    );
    await writeAccount(userId, account);
    return { cost, balance: account.balance };
  });
}

export async function refundAff(
  userId: number,
  cost: number,
  description: string,
): Promise<void> {
  if (!Number.isInteger(cost) || cost <= 0) return;
  await withUserLock(userId, async () => {
    const account = await readAccount(userId);
    account.balance += cost;
    addTransaction(account, cost, "refund", description);
    await writeAccount(userId, account);
  });
}

export async function grantAffOnce(
  userId: number,
  amount: number,
  description: string,
  referenceId: string,
): Promise<{ balance: number; granted: boolean }> {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error("AFF 奖励金额必须为正整数");
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    if (account.transactions.some((item) => item.referenceId === referenceId))
      return { balance: account.balance, granted: false };
    account.balance += amount;
    addTransaction(account, amount, "referral", description, referenceId);
    await writeAccount(userId, account);
    return { balance: account.balance, granted: true };
  });
}