import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  affCost as calculateAffCost,
  isInFreeEnvelope as calculateIsInFreeEnvelope,
} from "@/lib/image-pricing";
import type { ImagePricingGeneration } from "@/lib/image-pricing";

export type AffTransaction = {
  id: string;
  createdAt: string;
  amount: number;
  type:
    | "check-in"
    | "generation"
    | "refund"
    | "referral"
    | "package-purchase"
    | "package-generation";
  description: string;
  referenceId?: string;
  source?: "personal" | "package";
};

export type ImagePackageOrder = {
  requestId: string;
  status: "pending" | "unknown" | "completed" | "failed";
  packageCount: number;
  priceUsd: number;
  affAmount: number;
  quotaValue: number;
  createdAt: string;
  completedAt?: string;
  failureMessage?: string;
};

type PackageUsage = { id: string; at: number };

type AffAccount = {
  // 个人 AFF：签到、邀请、管理员发放都进入这里。
  balance: number;
  // 图包 AFF：购买后进入这里，不能被签到/邀请奖励混入。
  packageBalance: number;
  lastCheckInDay?: string;
  transactions: AffTransaction[];
  packageUsage: PackageUsage[];
  packageOrders: ImagePackageOrder[];
};

export type AffGeneration = ImagePricingGeneration;

export type ImageCreditCharge = {
  cost: number;
  samples: number;
  packageCost: number;
  personalCost: number;
  packageImages: number;
  packageImageIndexes: number[];
  packageChargesBySample: number[];
  personalChargesBySample: number[];
  packageUsageIds: string[];
  packageRateLimited: boolean;
  balance: number;
  packageBalance: number;
  totalBalance: number;
};

export const CHECK_IN_REWARD = 20;
export const IMAGE_PACKAGE_PRICE_USD = 200;
export const IMAGE_PACKAGE_AFF = 400;
export const IMAGE_PACKAGE_RATE_LIMIT = 10;
export const IMAGE_PACKAGE_RATE_WINDOW_MS = 60_000;
const MAX_TRANSACTIONS = 100;
const MAX_PACKAGE_USAGE = 200;
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
  return {
    balance: 0,
    packageBalance: 0,
    transactions: [],
    packageUsage: [],
    packageOrders: [],
  };
}

function validNonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

async function readAccount(userId: number): Promise<AffAccount> {
  try {
    const parsed = JSON.parse(await readFile(accountPath(userId), "utf8")) as
      | Partial<AffAccount>
      | undefined;
    return {
      balance: validNonNegativeInteger(parsed?.balance),
      packageBalance: validNonNegativeInteger(parsed?.packageBalance),
      lastCheckInDay:
        typeof parsed?.lastCheckInDay === "string"
          ? parsed.lastCheckInDay
          : undefined,
      transactions: Array.isArray(parsed?.transactions)
        ? (parsed.transactions.slice(0, MAX_TRANSACTIONS) as AffTransaction[])
        : [],
      packageUsage: Array.isArray(parsed?.packageUsage)
        ? parsed.packageUsage
            .filter(
              (item): item is PackageUsage =>
                Boolean(item) &&
                typeof item.id === "string" &&
                Number.isFinite(item.at),
            )
            .slice(-MAX_PACKAGE_USAGE)
        : [],
      packageOrders: Array.isArray(parsed?.packageOrders)
        ? parsed.packageOrders.filter(
            (item): item is ImagePackageOrder =>
              Boolean(item) &&
              typeof item.requestId === "string" &&
              ["pending", "unknown", "completed", "failed"].includes(item.status) &&
              Number.isInteger(item.packageCount) &&
              Number.isFinite(item.priceUsd) &&
              Number.isInteger(item.affAmount) &&
              Number.isInteger(item.quotaValue),
          )
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return emptyAccount();
    throw new Error("AFF 账本读取失败");
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
  source?: AffTransaction["source"],
): void {
  account.transactions.unshift({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    amount,
    type,
    description,
    ...(referenceId ? { referenceId } : {}),
    ...(source ? { source } : {}),
  });
  account.transactions = account.transactions.slice(0, MAX_TRANSACTIONS);
}

function prunePackageUsage(account: AffAccount, now = Date.now()): PackageUsage[] {
  account.packageUsage = account.packageUsage
    .filter((item) => now - item.at < IMAGE_PACKAGE_RATE_WINDOW_MS)
    .slice(-MAX_PACKAGE_USAGE);
  return account.packageUsage;
}

function packageRateLimitRemaining(account: AffAccount, now = Date.now()): number {
  return Math.max(
    0,
    IMAGE_PACKAGE_RATE_LIMIT - prunePackageUsage(account, now).length,
  );
}

// Opus 免费档判定与费用公式统一来自无 Node 依赖的共享模块，避免前后端口径漂移。
export function isInFreeEnvelope(generation: AffGeneration): boolean {
  return calculateIsInFreeEnvelope(generation);
}

export function affCost(generation: AffGeneration): number {
  return calculateAffCost(generation);
}

// 仅保留给旧调用方使用；新的图片入口使用 trySpendImageCredits。
export function newApiCost(generation: AffGeneration): number {
  const model = generation.model.toLowerCase();
  if (model.includes("-limit")) {
    if (model.includes("nai-v5")) return Number((5 * generation.samples).toFixed(2));
    return 0;
  }
  const anlas = affCost(generation);
  return Number((anlas * (model.includes("nai-v5") ? 3.75 : 2.5)).toFixed(2));
}

export async function affStatus(userId: number): Promise<{
  balance: number;
  packageBalance: number;
  totalBalance: number;
  packageRateLimitRemaining: number;
  checkedInToday: boolean;
  checkInReward: number;
}> {
  const account = await readAccount(userId);
  const remaining = packageRateLimitRemaining(account);
  return {
    balance: account.balance,
    packageBalance: account.packageBalance,
    totalBalance: account.balance + account.packageBalance,
    packageRateLimitRemaining: remaining,
    checkedInToday: account.lastCheckInDay === chinaDay(),
    checkInReward: CHECK_IN_REWARD,
  };
}

export async function checkInAff(userId: number): Promise<{
  balance: number;
  packageBalance: number;
  totalBalance: number;
  reward: number;
  checkedInToday: boolean;
}> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const today = chinaDay();
    if (account.lastCheckInDay === today)
      return {
        balance: account.balance,
        packageBalance: account.packageBalance,
        totalBalance: account.balance + account.packageBalance,
        reward: 0,
        checkedInToday: true,
      };
    account.balance += CHECK_IN_REWARD;
    account.lastCheckInDay = today;
    addTransaction(account, CHECK_IN_REWARD, "check-in", "每日签到奖励", undefined, "personal");
    await writeAccount(userId, account);
    return {
      balance: account.balance,
      packageBalance: account.packageBalance,
      totalBalance: account.balance + account.packageBalance,
      reward: CHECK_IN_REWARD,
      checkedInToday: true,
    };
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
      undefined,
      "personal",
    );
    await writeAccount(userId, account);
    return { cost, balance: account.balance };
  });
}

export async function trySpendAff(
  userId: number,
  generation: AffGeneration,
): Promise<{ cost: number; balance: number } | null> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const cost = affCost(generation);
    if (account.balance < cost) return null;
    account.balance -= cost;
    addTransaction(
      account,
      -cost,
      "generation",
      `${generation.model} ${generation.width}x${generation.height}，${generation.samples} 张`,
      undefined,
      "personal",
    );
    await writeAccount(userId, account);
    return { cost, balance: account.balance };
  });
}

// 图包优先，个人 AFF 补足。图包额度还受每用户 10 张/60 秒窗口限制；
// 限速只跳过图包，不会阻止个人 AFF 或 NewAPI 继续尝试。
export async function trySpendImageCredits(
  userId: number,
  generation: AffGeneration,
): Promise<ImageCreditCharge | null> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const samples = generation.samples;
    if (!Number.isSafeInteger(samples) || samples < 1 || samples > 6)
      throw new Error("生成张数必须是 1-6 的正整数");
    const cost = affCost(generation);
    if (!Number.isSafeInteger(cost) || cost <= 0)
      throw new Error("图像费用计算结果无效");
    const packageRateLimited =
      account.packageBalance > 0 && packageRateLimitRemaining(account) === 0;
    const availablePackageImages = packageRateLimited
      ? 0
      : Math.min(samples, packageRateLimitRemaining(account));
    const packageCostLimit =
      availablePackageImages > 0
        ? Math.min(cost, Math.ceil((cost * availablePackageImages) / samples))
        : 0;
    const packageCost = Math.min(account.packageBalance, packageCostLimit);
    const personalCost = cost - packageCost;
    if (account.balance < personalCost) return null;

    // 把整单整数费用分摊到每张图，保证部分批次退款时来源和金额都精确。
    // 分摊时图包额度可能不够一张图的完整费用，此时该图仍算占用一个图包名额，
    // 否则用户可以反复用残余额度绕过 10 张/分钟限制。
    const baseCost = Math.floor(cost / samples);
    let remainder = cost - baseCost * samples;
    const packageChargesBySample: number[] = [];
    const personalChargesBySample: number[] = [];
    let remainingPackage = packageCost;
    let packageQuotaLeft = availablePackageImages;
    for (let index = 0; index < samples; index += 1) {
      const sampleCost = baseCost + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      const packageCharge =
        packageQuotaLeft > 0
          ? Math.min(remainingPackage, sampleCost)
          : 0;
      if (packageCharge > 0) packageQuotaLeft -= 1;
      remainingPackage -= packageCharge;
      packageChargesBySample.push(packageCharge);
      personalChargesBySample.push(sampleCost - packageCharge);
    }
    const packageImageIndexes = packageChargesBySample.reduce<number[]>(
      (indexes, charge, index) => {
        if (charge > 0) indexes.push(index);
        return indexes;
      },
      [],
    );
    const packageImages = packageImageIndexes.length;
    const packageUsageIds = packageImageIndexes.map(() => randomUUID());
    const now = Date.now();
    account.packageBalance -= packageCost;
    account.balance -= personalCost;
    account.packageUsage.push(
      ...packageUsageIds.map((id, index) => ({ id, at: now + index })),
    );
    account.packageUsage = account.packageUsage.slice(-MAX_PACKAGE_USAGE);
    if (packageCost > 0)
      addTransaction(
        account,
        -packageCost,
        "package-generation",
        `${generation.model} ${generation.width}x${generation.height}，${packageImages} 张使用图包额度`,
        undefined,
        "package",
      );
    if (personalCost > 0)
      addTransaction(
        account,
        -personalCost,
        "generation",
        `${generation.model} ${generation.width}x${generation.height}，${generation.samples} 张使用个人 AFF`,
        undefined,
        "personal",
      );
    await writeAccount(userId, account);
    return {
      cost,
      samples,
      packageCost,
      personalCost,
      packageImages,
      packageImageIndexes,
      packageChargesBySample,
      personalChargesBySample,
      packageUsageIds,
      packageRateLimited,
      balance: account.balance,
      packageBalance: account.packageBalance,
      totalBalance: account.balance + account.packageBalance,
    };
  });
}

// 上游失败时按生成张数退回原扣费来源；图包使用窗口也一并释放。
export async function refundImageCredits(
  userId: number,
  charge: ImageCreditCharge,
  generatedSamples = 0,
): Promise<void> {
  const generated = Math.max(
    0,
    Math.min(charge.samples, Math.floor(generatedSamples)),
  );
  if (generated >= charge.samples) return;
  await withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const packageRefund = charge.packageChargesBySample
      .slice(generated)
      .reduce((sum, value) => sum + value, 0);
    const personalRefund = charge.personalChargesBySample
      .slice(generated)
      .reduce((sum, value) => sum + value, 0);
    if (packageRefund > 0) {
      account.packageBalance += packageRefund;
      addTransaction(
        account,
        packageRefund,
        "refund",
        generated
          ? `部分批次失败，返还 ${packageRefund} 图包 AFF`
          : `上游生成失败，返还 ${packageRefund} 图包 AFF`,
        undefined,
        "package",
      );
    }
    if (personalRefund > 0) {
      account.balance += personalRefund;
      addTransaction(
        account,
        personalRefund,
        "refund",
        generated
          ? `部分批次失败，返还 ${personalRefund} 个人 AFF`
          : `上游生成失败，返还 ${personalRefund} 个人 AFF`,
        undefined,
        "personal",
      );
    }
    const unusedIndexes = new Set(
      charge.packageImageIndexes.filter((index) => index >= generated),
    );
    const unusedIds = new Set(
      charge.packageImageIndexes
        .map((sampleIndex, usageIndex) =>
          unusedIndexes.has(sampleIndex)
            ? charge.packageUsageIds[usageIndex]
            : null,
        )
        .filter((id): id is string => Boolean(id)),
    );
    if (unusedIds.size)
      account.packageUsage = account.packageUsage.filter(
        (item) => !unusedIds.has(item.id),
      );
    await writeAccount(userId, account);
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
    addTransaction(account, cost, "refund", description, undefined, "personal");
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
    addTransaction(account, amount, "referral", description, referenceId, "personal");
    await writeAccount(userId, account);
    return { balance: account.balance, granted: true };
  });
}

// 管理员直接调整个人 AFF：正数发放、负数回收；返回新余额，不足时抛错。
export async function adjustAff(
  userId: number,
  delta: number,
  description: string,
): Promise<number> {
  if (!Number.isInteger(delta) || delta === 0)
    throw new Error("AFF 调整金额必须为非零整数");
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const next = account.balance + delta;
    if (next < 0)
      throw new Error(`AFF 余额不足：当前 ${account.balance}，无法扣减 ${Math.abs(delta)}`);
    account.balance = next;
    addTransaction(account, delta, delta > 0 ? "referral" : "refund", description, undefined, "personal");
    await writeAccount(userId, account);
    return next;
  });
}

export type AffLedgerSummary = {
  userId: number;
  balance: number;
  packageBalance: number;
  totalBalance: number;
  lastCheckInDay?: string;
  transactionCount: number;
  lastTransactionAt?: string;
};

export type AffLedgerDetail = AffLedgerSummary & {
  checkedInToday: boolean;
  checkInReward: number;
  transactions: AffTransaction[];
  packageOrders: ImagePackageOrder[];
};

function ledgerSummary(userId: number, account: AffAccount): AffLedgerSummary {
  return {
    userId,
    balance: account.balance,
    packageBalance: account.packageBalance,
    totalBalance: account.balance + account.packageBalance,
    lastCheckInDay: account.lastCheckInDay,
    transactionCount: account.transactions.length,
    lastTransactionAt: account.transactions[0]?.createdAt,
  };
}

export async function listAffLedgers(): Promise<AffLedgerSummary[]> {
  let files: string[] = [];
  try {
    files = await readdir(affRoot());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows: AffLedgerSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const userId = Number(file.slice(0, -5));
    if (!Number.isInteger(userId) || userId <= 0) continue;
    rows.push(ledgerSummary(userId, await readAccount(userId)));
  }
  return rows.sort((a, b) => b.totalBalance - a.totalBalance || b.userId - a.userId);
}

export async function affLedger(userId: number): Promise<AffLedgerDetail> {
  const account = await readAccount(userId);
  return {
    ...ledgerSummary(userId, account),
    checkedInToday: account.lastCheckInDay === chinaDay(),
    checkInReward: CHECK_IN_REWARD,
    transactions: account.transactions,
    packageOrders: account.packageOrders,
  };
}

export async function affTotals(): Promise<{
  accounts: number;
  personalCredits: number;
  packageCredits: number;
}> {
  const ledgers = await listAffLedgers();
  return {
    accounts: ledgers.length,
    personalCredits: ledgers.reduce((sum, item) => sum + item.balance, 0),
    packageCredits: ledgers.reduce((sum, item) => sum + item.packageBalance, 0),
  };
}

export async function adjustPackageBalance(
  userId: number,
  delta: number,
  description: string,
): Promise<number> {
  if (!Number.isInteger(delta) || delta === 0)
    throw new Error("图包额度调整必须为非零整数");
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const next = account.packageBalance + delta;
    if (next < 0)
      throw new Error(
        `图包额度不足：当前 ${account.packageBalance}，无法扣减 ${Math.abs(delta)}`,
      );
    account.packageBalance = next;
    addTransaction(
      account,
      delta,
      delta > 0 ? "package-purchase" : "refund",
      description,
      undefined,
      "package",
    );
    await writeAccount(userId, account);
    return next;
  });
}

export async function beginImagePackageOrder(
  userId: number,
  order: ImagePackageOrder,
): Promise<{ order: ImagePackageOrder; created: boolean }> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const existing = account.packageOrders.find(
      (item) => item.requestId === order.requestId,
    );
    if (existing) {
      if (
        existing.packageCount !== order.packageCount ||
        existing.quotaValue !== order.quotaValue ||
        existing.affAmount !== order.affAmount
      )
        throw new Error("订单请求编号已被其他购买参数占用");
      return { order: existing, created: false };
    }
    account.packageOrders.push(order);
    await writeAccount(userId, account);
    return { order, created: true };
  });
}

export async function completeImagePackageOrder(
  userId: number,
  requestId: string,
): Promise<{ order: ImagePackageOrder; packageBalance: number }> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const order = account.packageOrders.find(
      (item) => item.requestId === requestId,
    );
    if (!order) throw new Error("图包订单不存在");
    if (order.status === "failed")
      throw new Error(order.failureMessage || "图包订单已失败");
    if (order.status === "pending") {
      order.status = "completed";
      order.completedAt = new Date().toISOString();
      account.packageBalance += order.affAmount;
      addTransaction(
        account,
        order.affAmount,
        "package-purchase",
        `购买图包 ${order.packageCount} 包，获得 ${order.affAmount} 图包 AFF`,
        `image-package:${order.requestId}`,
        "package",
      );
      await writeAccount(userId, account);
    }
    return { order, packageBalance: account.packageBalance };
  });
}

export async function failImagePackageOrder(
  userId: number,
  requestId: string,
  message: string,
  status: "failed" | "unknown" = "failed",
): Promise<ImagePackageOrder | null> {
  return withUserLock(userId, async () => {
    const account = await readAccount(userId);
    const order = account.packageOrders.find(
      (item) => item.requestId === requestId,
    );
    if (!order || order.status === "completed") return order || null;
    order.status = status;
    order.failureMessage = message.slice(0, 500);
    await writeAccount(userId, account);
    return order;
  });
}

export async function imagePackageOrder(
  userId: number,
  requestId: string,
): Promise<ImagePackageOrder | null> {
  const account = await readAccount(userId);
  return account.packageOrders.find((item) => item.requestId === requestId) || null;
}
