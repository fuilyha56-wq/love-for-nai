import { randomUUID } from "node:crypto";
import { adminHeaders, adminToken } from "@/lib/admin-auth";
import {
  beginImagePackageOrder,
  completeImagePackageOrder,
  failImagePackageOrder,
  imagePackageOrder,
  IMAGE_PACKAGE_AFF,
  IMAGE_PACKAGE_PRICE_USD,
  type ImagePackageOrder,
} from "@/lib/aff";
import { affGateway, newApiBaseUrl } from "@/lib/newapi";
import { SlidingWindowRateLimiter } from "@/lib/rate-limit";

export const IMAGE_PACKAGE_MAX_COUNT = 10;
const PURCHASE_RATE_LIMIT = 3;
const PURCHASE_RATE_WINDOW_MS = 60_000;

const globalStore = globalThis as typeof globalThis & {
  __lfnImagePackagePurchaseLimiter?: SlidingWindowRateLimiter;
};
const purchaseLimiter =
  (globalStore.__lfnImagePackagePurchaseLimiter ??=
    new SlidingWindowRateLimiter({
      limit: PURCHASE_RATE_LIMIT,
      windowMs: PURCHASE_RATE_WINDOW_MS,
      maxKeys: 5_000,
    }));

export type ImagePackageProduct = {
  priceUsd: number;
  affPerPackage: number;
  rateLimit: number;
  purchaseEnabled: boolean;
};

export function imagePackageProduct(): ImagePackageProduct {
  return {
    priceUsd: IMAGE_PACKAGE_PRICE_USD,
    affPerPackage: IMAGE_PACKAGE_AFF,
    rateLimit: 10,
    purchaseEnabled: Boolean(adminToken() && affGateway()),
  };
}

export function normalizePackageRequest(
  raw: Record<string, unknown>,
): { requestId: string; packageCount: number } {
  const requestId =
    typeof raw.requestId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(raw.requestId)
      ? raw.requestId
      : randomUUID();
  const packageCountValue =
    raw.packageCount === undefined ? 1 : raw.packageCount;
  if (
    typeof packageCountValue !== "number" ||
    !Number.isInteger(packageCountValue) ||
    packageCountValue < 1 ||
    packageCountValue > IMAGE_PACKAGE_MAX_COUNT
  )
    throw new Error(`一次最多购买 ${IMAGE_PACKAGE_MAX_COUNT} 包图包`);
  return { requestId, packageCount: packageCountValue };
}

export function quotaForPackages(packageCount: number): number {
  const quotaPerUnit = Number(process.env.QUOTA_PER_UNIT || 500000);
  if (!Number.isSafeInteger(quotaPerUnit) || quotaPerUnit <= 0)
    throw new Error("QUOTA_PER_UNIT 配置无效");
  const quota = IMAGE_PACKAGE_PRICE_USD * packageCount * quotaPerUnit;
  if (!Number.isSafeInteger(quota) || quota <= 0)
    throw new Error("图包额度计算超出安全范围");
  return quota;
}

export function checkPurchaseRateLimit(userId: number): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  return purchaseLimiter.check(`user:${userId}`);
}

async function manageQuota(
  userId: number,
  value: number,
  mode: "add" | "subtract",
): Promise<void> {
  const response = await fetch(`${newApiBaseUrl()}/api/user/manage`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      id: userId,
      action: "add_quota",
      value,
      mode,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let result: { success?: boolean; message?: string } = {};
  if (text.trim()) {
    try {
      result = JSON.parse(text) as typeof result;
    } catch {
      throw new Error(`NewAPI 返回了无法解析的响应（${response.status}）`);
    }
  }
  if (!response.ok || !result.success)
    throw new Error(result.message || `NewAPI 余额${mode === "subtract" ? "扣除" : "返还"}失败`);
}

export function orderResponse(
  order: ImagePackageOrder,
  packageBalance?: number,
): Record<string, unknown> {
  return {
    success: order.status === "completed",
    requestId: order.requestId,
    status: order.status,
    packageCount: order.packageCount,
    priceUsd: order.priceUsd,
    affAmount: order.affAmount,
    ...(packageBalance === undefined ? {} : { packageBalance }),
    ...(order.failureMessage ? { message: order.failureMessage } : {}),
  };
}

export async function purchaseImagePackages(
  userId: number,
  requestId: string,
  packageCount: number,
): Promise<Record<string, unknown>> {
  if (!adminToken()) throw new Error("图包购买服务尚未配置管理员令牌");
  if (!affGateway()) throw new Error("图包生图服务尚未启用，请联系管理员");

  const quotaValue = quotaForPackages(packageCount);
  const order: ImagePackageOrder = {
    requestId,
    status: "pending",
    packageCount,
    priceUsd: IMAGE_PACKAGE_PRICE_USD * packageCount,
    affAmount: IMAGE_PACKAGE_AFF * packageCount,
    quotaValue,
    createdAt: new Date().toISOString(),
  };
  const created = await beginImagePackageOrder(userId, order);
  if (!created.created) {
    if (created.order.status === "completed")
      return orderResponse(created.order);
    if (created.order.status === "failed")
      return orderResponse(created.order);
    throw new Error("该图包订单正在处理，请稍后查询订单状态");
  }

  try {
    await manageQuota(userId, quotaValue, "subtract");
  } catch (error) {
    await failImagePackageOrder(
      userId,
      requestId,
      error instanceof Error ? error.message : "NewAPI 余额扣除失败",
    );
    throw error;
  }

  try {
    const completed = await completeImagePackageOrder(userId, requestId);
    return orderResponse(completed.order, completed.packageBalance);
  } catch (error) {
    const message = error instanceof Error ? error.message : "图包额度发放失败";
    let compensated = false;
    try {
      await manageQuota(userId, quotaValue, "add");
      compensated = true;
    } catch {
      // 保留 pending 订单，避免重复 requestId 再次扣款；管理员可据此人工核对。
    }
    if (compensated)
      await failImagePackageOrder(userId, requestId, `本地发放失败，NewAPI 余额已返还：${message}`);
    throw new Error(
      compensated
        ? `图包发放失败，NewAPI 余额已返还：${message}`
        : `图包订单待核对：NewAPI 已扣款但本地发放未完成（${message}）`,
    );
  }
}

export async function readImagePackageOrder(
  userId: number,
  requestId: string,
): Promise<ImagePackageOrder | null> {
  return imagePackageOrder(userId, requestId);
}
