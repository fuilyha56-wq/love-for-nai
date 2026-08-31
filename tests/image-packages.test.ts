import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  affStatus,
  refundImageCredits,
  trySpendImageCredits,
} from "@/lib/aff";
import {
  imagePackageProduct,
  normalizePackageRequest,
  purchaseImagePackages,
  quotaForPackages,
} from "@/lib/image-packages";

let dataDir = "";

async function seedAccount(
  userId: number,
  account: Record<string, unknown>,
): Promise<void> {
  await mkdir(path.join(dataDir, "aff"), { recursive: true });
  await writeFile(
    path.join(dataDir, "aff", `${userId}.json`),
    JSON.stringify(account),
    "utf8",
  );
}

async function readAccountFile(userId: number): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(dataDir, "aff", `${userId}.json`), "utf8"),
  ) as Record<string, unknown>;
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lfn-image-package-"));
  process.env.LFN_DATA_DIR = dataDir;
  process.env.QUOTA_PER_UNIT = "500000";
  process.env.LFN_ADMIN_TOKEN = "test-admin-token";
  process.env.LFN_ADMIN_USER_ID = "3";
  process.env.LFN_AFF_GATEWAY_URL = "http://gateway.test";
  process.env.LFN_AFF_GATEWAY_TOKEN = "gateway-token";
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.LFN_DATA_DIR;
  delete process.env.LFN_ADMIN_TOKEN;
  delete process.env.LFN_ADMIN_USER_ID;
  delete process.env.LFN_AFF_GATEWAY_URL;
  delete process.env.LFN_AFF_GATEWAY_TOKEN;
});

describe("图包 AFF 账本", () => {
  it("兼容旧账户并把缺省图包额度按 0 读取", async () => {
    await seedAccount(101, { balance: 7, transactions: [] });

    await expect(affStatus(101)).resolves.toMatchObject({
      balance: 7,
      packageBalance: 0,
      totalBalance: 7,
    });
  });

  it("图包额度优先扣除，个人 AFF 不变", async () => {
    await seedAccount(102, {
      balance: 10,
      packageBalance: 5,
      transactions: [],
    });

    const charge = await trySpendImageCredits(102, {
      model: "nai-v4.5-full-limit",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 2,
    });

    expect(charge).toMatchObject({
      cost: 2,
      packageCost: 2,
      personalCost: 0,
      packageImages: 2,
      balance: 10,
      packageBalance: 3,
    });
  });

  it("图包不足时由个人 AFF 补足并记录混合来源", async () => {
    await seedAccount(103, {
      balance: 4,
      packageBalance: 2,
      transactions: [],
    });

    const charge = await trySpendImageCredits(103, {
      model: "nai-v5-full-limit",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 3,
    });

    expect(charge).toMatchObject({
      cost: 5,
      packageCost: 2,
      personalCost: 3,
      packageImages: 1,
      balance: 1,
      packageBalance: 0,
    });
    expect(charge?.packageChargesBySample).toEqual([2, 0, 0]);
    expect(charge?.personalChargesBySample).toEqual([0, 2, 1]);
  });

  it("两种 AFF 合计不足时不修改本地余额", async () => {
    await seedAccount(104, {
      balance: 1,
      packageBalance: 2,
      transactions: [],
    });

    await expect(
      trySpendImageCredits(104, {
        model: "nai-v5-full-limit",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 3,
      }),
    ).resolves.toBeNull();
    await expect(affStatus(104)).resolves.toMatchObject({
      balance: 1,
      packageBalance: 2,
      totalBalance: 3,
    });
  });

  it("图包每分钟最多使用 10 张，个人 AFF 仍可继续支付", async () => {
    await seedAccount(105, {
      balance: 2,
      packageBalance: 20,
      transactions: [],
    });
    const generation = {
      model: "nai-v4.5-full-limit",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 1,
    };

    for (let index = 0; index < 10; index += 1)
      await expect(trySpendImageCredits(105, generation)).resolves.toMatchObject({
        packageCost: 1,
        personalCost: 0,
      });
    const eleventh = await trySpendImageCredits(105, generation);

    expect(eleventh).toMatchObject({
      packageCost: 0,
      personalCost: 1,
      packageImages: 0,
      packageRateLimited: true,
      balance: 1,
      packageBalance: 10,
    });
  });

  it("部分失败按每张图的原始来源精确退款", async () => {
    await seedAccount(106, {
      balance: 4,
      packageBalance: 2,
      transactions: [],
    });
    const charge = await trySpendImageCredits(106, {
      model: "nai-v5-full-limit",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 3,
    });
    if (!charge) throw new Error("charge should exist");

    await refundImageCredits(106, charge, 1);

    // 第 1 张由图包支付，失败的第 2/3 张只退回个人 AFF。
    await expect(affStatus(106)).resolves.toMatchObject({
      balance: 4,
      packageBalance: 0,
      totalBalance: 4,
    });
    const account = await readAccountFile(106);
    expect(account.packageUsage).toHaveLength(1);
  });
});

describe("图包购买服务", () => {
  it("价格固定为 $200，按 QUOTA_PER_UNIT 转成原始 quota", () => {
    expect(quotaForPackages(1)).toBe(100_000_000);
    expect(quotaForPackages(3)).toBe(300_000_000);
    expect(normalizePackageRequest({ packageCount: 2, requestId: "request_123" })).toEqual({
      packageCount: 2,
      requestId: "request_123",
    });
    expect(imagePackageProduct()).toMatchObject({
      priceUsd: 200,
      affPerPackage: 400,
      rateLimit: 10,
      purchaseEnabled: true,
    });
  });

  it("同一个 requestId 只扣一次 NewAPI 并只发放一次额度", async () => {
    await seedAccount(107, {
      balance: 0,
      packageBalance: 0,
      transactions: [],
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/user/107"))
        return Response.json({ success: true, data: { quota: 100_000_000 } });
      calls.push({ url, init });
      return Response.json({ success: true });
    }) as typeof fetch;
    try {
      const first = await purchaseImagePackages(107, "request_123", 1);
      const second = await purchaseImagePackages(107, "request_123", 1);

      expect(first).toMatchObject({ success: true, status: "completed", affAmount: 400 });
      expect(second).toMatchObject({ success: true, status: "completed", affAmount: 400 });
      expect(calls).toHaveLength(1);
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        id: 107,
        action: "add_quota",
        value: 100_000_000,
        mode: "subtract",
      });
      await expect(affStatus(107)).resolves.toMatchObject({ packageBalance: 400 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("NewAPI 余额不足时不创建订单、不发放图包额度", async () => {
    await seedAccount(109, {
      balance: 0,
      packageBalance: 0,
      transactions: [],
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ success: true, data: { quota: 99_999_999 } })) as typeof fetch;
    try {
      await expect(purchaseImagePackages(109, "request_low_balance", 1)).rejects.toThrow(
        "余额不足",
      );
      await expect(affStatus(109)).resolves.toMatchObject({
        balance: 0,
        packageBalance: 0,
      });
      const account = await readAccountFile(109);
      expect(account.packageOrders ?? []).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("同一 requestId 使用不同包数时拒绝参数冲突", async () => {
    await seedAccount(110, {
      balance: 0,
      packageBalance: 0,
      transactions: [],
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/user/110"))
        return Response.json({ success: true, data: { quota: 1_000_000_000 } });
      if (url.includes("/api/user/manage"))
        return Response.json({ success: true });
      throw new Error(`unexpected fetch ${url} ${init?.method || "GET"}`);
    }) as typeof fetch;
    try {
      await purchaseImagePackages(110, "request_conflict", 1);
      await expect(
        purchaseImagePackages(110, "request_conflict", 2),
      ).rejects.toThrow("其他购买参数");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("扣款结果未知时订单保持 unknown，不能发放图包", async () => {
    await seedAccount(111, {
      balance: 0,
      packageBalance: 0,
      transactions: [],
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/user/111"))
        return Response.json({ success: true, data: { quota: 100_000_000 } });
      throw new Error("network timeout");
    }) as typeof fetch;
    try {
      await expect(purchaseImagePackages(111, "request_unknown", 1)).rejects.toThrow(
        "network timeout",
      );
      const account = await readAccountFile(111);
      expect(account.packageOrders).toMatchObject([
        { requestId: "request_unknown", status: "unknown" },
      ]);
      expect(account.packageBalance).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
