import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageCreditCharge } from "@/lib/aff";

export type ImageSettlementStatus =
  | "reserved"
  | "charged"
  | "succeeded"
  | "partially-refunded"
  | "refunded"
  | "pending-reconciliation"
  | "manual-review";

export type ImageSettlement = {
  settlementId: string;
  requestId: string;
  userId: number;
  samples: number;
  generatedSamples: number;
  chargedAmount: number;
  refundedAmount: number;
  gatewayAnlasCost?: number;
  gatewayPromptTokens?: number;
  gatewayUsage?: Record<string, unknown>;
  paymentSource: "personal" | "package" | "mixed" | "newapi";
  status: ImageSettlementStatus;
  upstreamStatus?: number;
  failureCode?: string;
  failureMessage?: string;
  chargeReferenceId?: string;
  refundReferenceId?: string;
  createdAt: string;
  updatedAt: string;
};

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "risk");
const file = () => path.join(root(), "settlements.json");
const MAX_SETTLEMENTS = 20_000;
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readSettlements(): Promise<ImageSettlement[]> {
  try {
    const value = JSON.parse(await readFile(file(), "utf8")) as unknown;
    return Array.isArray(value) ? value as ImageSettlement[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("图像结算记录读取失败");
  }
}

async function writeSettlements(items: ImageSettlement[]): Promise<void> {
  await mkdir(root(), { recursive: true });
  const temporary = `${file()}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(items.slice(0, MAX_SETTLEMENTS), null, 2), "utf8");
  await rename(temporary, file());
}

export function paymentSourceForCharge(charge: ImageCreditCharge): ImageSettlement["paymentSource"] {
  return charge.packageCost > 0 && charge.personalCost > 0
    ? "mixed"
    : charge.packageCost > 0
      ? "package"
      : "personal";
}

export async function createImageSettlement(input: {
  settlementId: string;
  requestId: string;
  userId: number;
  charge: ImageCreditCharge;
}): Promise<ImageSettlement> {
  return withLock(async () => {
    const items = await readSettlements();
    const existing = items.find((item) => item.settlementId === input.settlementId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const item: ImageSettlement = {
      settlementId: input.settlementId,
      requestId: input.requestId,
      userId: input.userId,
      samples: input.charge.samples,
      generatedSamples: 0,
      chargedAmount: input.charge.cost,
      refundedAmount: 0,
      paymentSource: paymentSourceForCharge(input.charge),
      status: "charged",
      chargeReferenceId: input.requestId,
      createdAt: now,
      updatedAt: now,
    };
    items.unshift(item);
    await writeSettlements(items);
    return item;
  });
}

export async function updateImageSettlement(
  settlementId: string,
  patch: Partial<ImageSettlement>,
): Promise<ImageSettlement | null> {
  return withLock(async () => {
    const items = await readSettlements();
    const item = items.find((candidate) => candidate.settlementId === settlementId);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await writeSettlements(items);
    return item;
  });
}

export async function getImageSettlement(settlementId: string): Promise<ImageSettlement | null> {
  return (await readSettlements()).find((item) => item.settlementId === settlementId) || null;
}

export async function listImageSettlements(limit = 100): Promise<ImageSettlement[]> {
  return (await readSettlements()).slice(0, Math.max(1, Math.min(5000, limit)));
}

export async function listUserImageSettlements(userId: number): Promise<ImageSettlement[]> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("用户 id 无效");
  return (await readSettlements()).filter(item => item.userId === userId);
}
