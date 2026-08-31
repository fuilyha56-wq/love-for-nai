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

class QuotaMutationError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean,
  ) {
    super(message);
  }
}

const purchaseLocks = new Map<number, Promise<unknown>>();

function withPurchaseLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const previous = purchaseLocks.get(userId) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => undefined);
  purchaseLocks.set(userId, tail);
  void tail.then(() => {
    if (purchaseLocks.get(userId) === tail) purchaseLocks.delete(userId);
  });
  return current;
}

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
  if (
    typeof raw.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(raw.requestId)
  )
    throw new Error("缺少合法的购买请求编号，请重试");
  const requestId = raw.requestId;
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
  if (
    !Number.isSafeInteger(packageCount) ||
    packageCount < 1 ||
    packageCount > IMAGE_PACKAGE_MAX_COUNT
  )
    throw new Error(`一次最多购买 ${IMAGE_PACKAGE_MAX_COUNT} 包图包`);
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
  let response: Response;
  try {
    response = await fetch(`${newApiBaseUrl()}/api/user/manage`, {
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
  } catch (error) {
    throw new QuotaMutationError(
      error instanceof Error ? error.message : "NewAPI 余额操作失败",
      true,
    );
  }
  const text = await response.text().catch(() => {
    throw new QuotaMutationError("NewAPI 余额响应读取失败", true);
  });
  let result: { success?: boolean; message?: string } = {};
  if (text.trim()) {
    try {
      result = JSON.parse(text) as typeof result;
    } catch {
      throw new QuotaMutationError(
        `NewAPI 返回了无法解析的响应（${response.status}）`,
        true,
      );
    }
  }
  if (!response.ok || !result.success)
    throw new QuotaMutationError(
      result.message || `NewAPI 余额${mode === "subtract" ? "扣除" : "返还"}失败`,
      false,
    );
}

async function readNewApiQuota(userId: number): Promise<number> {
  const response = await fetch(`${newApiBaseUrl()}/api/user/${userId}`, {
    headers: adminHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let result: {
    success?: boolean;
    message?: string;
    data?: { quota?: number };
  } = {};
  if (text.trim()) {
    try {
      result = JSON.parse(text) as typeof result;
    } catch {
      throw new Error(`NewAPI 余额响应无法解析（${response.status}）`);
    }
  }
  const quota = result.data?.quota;
  if (!response.ok || !result.success || typeof quota !== "number" || !Number.isFinite(quota))
    throw new Error(result.message || "无法读取 NewAPI 当前余额");
  return quota;
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
  return withPurchaseLock(userId, async () => {
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

    // 先在用户购买锁内检查幂等订单；重复请求不应因为余额已变化而失败。
    const existing = await imagePackageOrder(userId, requestId);
    if (existing) {
      if (
        existing.packageCount !== order.packageCount ||
        existing.quotaValue !== order.quotaValue ||
        existing.affAmount !== order.affAmount
      )
        throw new Error("订单请求编号已被其他购买参数占用");
      if (existing.status === "completed") return orderResponse(existing);
      if (existing.status === "failed")
        throw new Error(existing.failureMessage || "该图包订单已失败");
      if (existing.status === "unknown")
        throw new Error(existing.failureMessage || "该图包订单待核对，请联系管理员");
      throw new Error("该图包订单正在处理，请稍后查询订单状态");
    }

    // NewAPI subtract 本身没有余额下限，购买前必须在 LFN 侧硬校验。
    const currentQuota = await readNewApiQuota(userId);
    const quotaPerUnit = Number(process.env.QUOTA_PER_UNIT || 500000);
    if (currentQuota < quotaValue)
      throw new Error(
        `NewAPI 余额不足：购买 ${packageCount} 包需要 $${(
          IMAGE_PACKAGE_PRICE_USD * packageCount
        ).toFixed(2)}，当前约 $${(currentQuota / quotaPerUnit).toFixed(2)}`,
      );

    await beginImagePackageOrder(userId, order);

    try {
      await manageQuota(userId, quotaValue, "subtract");
      // 防御旧版 NewAPI 的无条件减法；若发现负数，立即补回且不发放额度。
      const remainingQuota = await readNewApiQuota(userId);
      if (remainingQuota < 0) {
        try {
          await manageQuota(userId, quotaValue, "add");
        } catch {
          throw new QuotaMutationError(
            "NewAPI 扣款后余额异常为负，且自动补偿失败，请联系管理员",
            true,
          );
        }
        throw new QuotaMutationError(
          "NewAPI 扣款后余额异常为负，已自动取消本次购买",
          false,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "NewAPI 余额扣除失败";
      await failImagePackageOrder(
        userId,
        requestId,
        message,
        error instanceof QuotaMutationError && error.uncertain ? "unknown" : "failed",
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
        await failImagePackageOrder(
          userId,
          requestId,
          `本地发放失败，NewAPI 余额已返还：${message}`,
          "failed",
        );
      else
        await failImagePackageOrder(
          userId,
          requestId,
          `图包订单待核对：NewAPI 已扣款但本地发放未完成（${message}）`,
          "unknown",
        );
      throw new Error(
        compensated
          ? `图包发放失败，NewAPI 余额已返还：${message}`
          : `图包订单待核对：NewAPI 已扣款但本地发放未完成（${message}）`,
      );
    }
  });
}

export async function readImagePackageOrder(
  userId: number,
  requestId: string,
): Promise<ImagePackageOrder | null> {
  return imagePackageOrder(userId, requestId);
}
