import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { affStatus, grantAffOnce } from "@/lib/aff";

export type RedeemRewardType = "aff";
export type RedeemCode = {
  id: string;
  code: string;
  campaignId?: string;
  rewardType: RedeemRewardType;
  amount: number;
  maxUses: number;
  usedCount: number;
  expiresAt?: string;
  enabled: boolean;
  createdAt: string;
  createdBy: number;
};
export type RedeemRecord = {
  id: string;
  codeId: string;
  code: string;
  userId: number;
  amount: number;
  rewardType: RedeemRewardType;
  redeemedAt: string;
  referenceId: string;
};
export type RedeemStore = { codes: RedeemCode[]; redemptions: RedeemRecord[] };

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "redeem-codes");
const storePath = () => path.join(root(), "index.json");
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}
async function readStore(): Promise<RedeemStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as Partial<RedeemStore>;
    return {
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      redemptions: Array.isArray(parsed.redemptions) ? parsed.redemptions : [],
    };
  } catch { return { codes: [], redemptions: [] }; }
}
async function writeStore(store: RedeemStore): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}
function normalizedCode(value: string): string { return value.trim().toUpperCase().replace(/\s+/g, ""); }
function validAmount(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("兑换奖励必须是正整数");
  return Number(value);
}
function validUses(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("兑换次数必须是正整数");
  return Number(value);
}
export function maskRedeemCode(code: string): string {
  if (code.length <= 6) return `${code.slice(0, 2)}••••`;
  return `${code.slice(0, 4)}••••${code.slice(-2)}`;
}

function publicCode(item: RedeemCode): RedeemCode {
  return { ...item, code: maskRedeemCode(item.code) };
}

export async function listRedeemCodes(): Promise<RedeemCode[]> {
  return withLock(async () => (await readStore()).codes.map(publicCode));
}
export async function listRedemptionHistory(userId?: number): Promise<RedeemRecord[]> {
  return withLock(async () => {
    const items = (await readStore()).redemptions;
    return (userId == null ? items : items.filter((item) => item.userId === userId)).slice().sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt));
  });
}

export async function createRedeemCodes(input: {
  count?: number;
  code?: string;
  campaignId?: string;
  rewardType?: RedeemRewardType;
  amount: number;
  maxUses: number;
  expiresAt?: string;
  enabled?: boolean;
  createdBy: number;
}): Promise<RedeemCode[]> {
  return withLock(async () => {
    const count = input.code ? 1 : (input.count ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("批量数量必须是 1-1000");
    const amount = validAmount(input.amount);
    const maxUses = validUses(input.maxUses);
    const rewardType = input.rewardType || "aff";
    if (rewardType !== "aff") throw new Error("暂只支持 AFF 兑换奖励");
    const store = await readStore();
    const result: RedeemCode[] = [];
    for (let index = 0; index < count; index += 1) {
      const requested = index === 0 && input.code ? normalizedCode(input.code) : `LFN-${randomBytes(5).toString("hex").toUpperCase()}`;
      if (!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(requested)) throw new Error("兑换码格式不合法");
      if (store.codes.some((item) => item.code === requested)) throw new Error(`兑换码已存在：${requested}`);
      const item: RedeemCode = {
        id: randomUUID(), code: requested, ...(input.campaignId ? { campaignId: input.campaignId.trim().slice(0, 80) } : {}),
        rewardType, amount, maxUses, usedCount: 0,
        ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt).toISOString() } : {}),
        enabled: input.enabled !== false, createdAt: new Date().toISOString(), createdBy: input.createdBy,
      };
      store.codes.unshift(item); result.push(item);
    }
    await writeStore(store);
    return result;
  });
}

export async function updateRedeemCode(id: string, patch: { enabled?: boolean; expiresAt?: string | null; maxUses?: number }): Promise<RedeemCode> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.codes.find((entry) => entry.id === id);
    if (!item) throw new Error("兑换码不存在");
    if (patch.enabled !== undefined) item.enabled = Boolean(patch.enabled);
    if (patch.expiresAt !== undefined) item.expiresAt = patch.expiresAt ? new Date(patch.expiresAt).toISOString() : undefined;
    if (patch.maxUses !== undefined) {
      const maxUses = validUses(patch.maxUses);
      if (maxUses < item.usedCount) throw new Error("兑换次数不能低于已使用次数");
      item.maxUses = maxUses;
    }
    await writeStore(store);
    return item;
  });
}

export async function redeemCode(rawCode: string, userId: number): Promise<{ item: RedeemRecord; balance: number; alreadyRedeemed: boolean }> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("用户 id 不合法");
  const code = normalizedCode(rawCode);
  if (!code) throw new Error("请输入兑换码");
  return withLock(async () => {
    const store = await readStore();
    const item = store.codes.find((entry) => entry.code === code);
    if (!item) throw new Error("兑换码不存在");
    const previous = store.redemptions.find((entry) => entry.codeId === item.id && entry.userId === userId);
    if (previous) return { item: previous, balance: (await affStatus(userId)).balance, alreadyRedeemed: true };
    if (!item.enabled) throw new Error("兑换码已停用");
    if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) throw new Error("兑换码已过期");
    if (item.usedCount >= item.maxUses) throw new Error("兑换码使用次数已达上限");
    const referenceId = `redeem-code:${item.id}:${userId}`;
    const grant = await grantAffOnce(userId, item.amount, `兑换码奖励：${item.code}`, referenceId);
    const record: RedeemRecord = {
      id: randomUUID(), codeId: item.id, code: item.code, userId, amount: item.amount,
      rewardType: item.rewardType, redeemedAt: new Date().toISOString(), referenceId,
    };
    item.usedCount += 1;
    store.redemptions.unshift(record);
    await writeStore(store);
    return { item: record, balance: grant.balance, alreadyRedeemed: false };
  });
}
