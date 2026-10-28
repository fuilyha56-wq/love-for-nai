import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { affStatus, refundImageCredits, trySpendImageCredits } from "@/lib/aff";
import { createImageSettlement, getImageSettlement } from "@/lib/risk-settlement";
import { dailyImageBillingState, reserveDailyImageQuote } from "@/lib/daily-image-billing";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";

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

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lfn-mixed-"));
  process.env.LFN_DATA_DIR = dataDir;
  process.env.LFN_AFF_GATEWAY_URL = "http://gateway.test";
  process.env.LFN_AFF_GATEWAY_TOKEN = "gateway-token";
});

afterEach(async () => {
  resetRuntimeConfigCache();
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.LFN_DATA_DIR;
  delete process.env.LFN_AFF_GATEWAY_URL;
  delete process.env.LFN_AFF_GATEWAY_TOKEN;
});

describe("图包与个人 AFF 混合扣费（两档计费口径）", () => {
  it("图包折扣变化不改变固定 AFF 面值和 V5 计价", async () => {
    const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 29, samples: 1 };
    for (const [index, priceUsd, affPerPackage] of [[0, 200, 400], [1, 400, 100]] as const) {
      await updateRuntimeSettings({ imagePackagePriceUsd: priceUsd, imagePackageAffPerPackage: affPerPackage });
      const userId = 930 + index;
      await expect(dailyImageBillingState(userId)).resolves.toMatchObject({ cnyPerAff: 0.005, packageCny: priceUsd / 200, affPerPackage });
      await seedAccount(userId, { balance: 300, packageBalance: 0, transactions: [] });
      await expect(trySpendImageCredits(userId, generation, `fixed-cny-${index}`)).resolves.toMatchObject({ cost: 65, personalCost: 65, balance: 235, dailyQuote: { anlas: 30, costCny: 0.325 } });
    }
  });

  it("跨 V5 第 50 张逐张扣款，失败部分按原阶梯和来源退款", async () => {
    const userId = 920;
    const generation = { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 };
    await seedAccount(userId, { balance: 20, packageBalance: 5, transactions: [] });
    await reserveDailyImageQuote(userId, { ...generation, samples: 30, sequential: true }, "daily-30");
    await reserveDailyImageQuote(userId, { ...generation, samples: 19, sequential: true }, "daily-19");
    const charge = await trySpendImageCredits(userId, { ...generation, samples: 3, sequential: true }, "daily-crossing");
    expect(charge).toMatchObject({ cost: 16, packageCost: 5, personalCost: 11 });
    expect(charge?.dailyQuote?.affCosts).toEqual([5, 5.5, 5.5]);
    await refundImageCredits(userId, charge!, 1);
    await expect(affStatus(userId)).resolves.toMatchObject({ balance: 20, packageBalance: 0 });
    await expect(dailyImageBillingState(userId)).resolves.toMatchObject({ counts: { v5: 50 } });
  });

  it("有请求 ID 但余额不足时也释放每日预留张数", async () => {
    const userId = 921;
    await seedAccount(userId, { balance: 0, packageBalance: 0, transactions: [] });
    await expect(trySpendImageCredits(userId, { model: "nai-v5-full", width: 832, height: 1216, steps: 28, samples: 1 }, "insufficient-with-id")).resolves.toBeNull();
    await expect(dailyImageBillingState(userId)).resolves.toMatchObject({ counts: { v5: 0 } });
  });

  it("超界 limit 在扣费前拒绝，钱包余额不变", async () => {
    await seedAccount(911, { balance: 50, packageBalance: 5, transactions: [], packageUsage: [], packageOrders: [] });
    await expect(trySpendImageCredits(911, { model: "nai-v5-full-limit", width: 1024, height: 1024, steps: 50, samples: 1 })).rejects.toThrow("limit");
    await expect(affStatus(911)).resolves.toMatchObject({ balance: 50, packageBalance: 5 });
  });

  it("limit 顺序分批逐张验证尺寸、步数和参考图，合法请求按每张 5 AFF 扣费", async () => {
    await seedAccount(912, { balance: 50, packageBalance: 5, transactions: [], packageUsage: [], packageOrders: [] });
    const base = { model: "nai-v5-full-limit", width: 832, height: 1216, steps: 28, samples: 3, sequential: true };
    for (const override of [{ steps: 50 }, { width: 1088, height: 1024 }, { referenceImageCount: 1 }])
      await expect(trySpendImageCredits(912, { ...base, ...override })).rejects.toThrow("limit");
    await expect(affStatus(912)).resolves.toMatchObject({ balance: 50, packageBalance: 5 });
    await expect(trySpendImageCredits(912, base)).resolves.toMatchObject({ cost: 15, packageCost: 5, personalCost: 10 });
  });
  it("新结算全失败退回两个钱包，并发重试只退款一次", async () => {
    await seedAccount(910, { balance: 500, packageBalance: 5, transactions: [], packageUsage: [], packageOrders: [] });
    const charge = await trySpendImageCredits(910, {
      model: "nai-v5-full", width: 832, height: 1216, steps: 29, samples: 1,
    });
    expect(charge).not.toBeNull();
    const settlementId = "settlement:refund-910";
    await createImageSettlement({ settlementId, requestId: "refund-910", userId: 910, charge: charge! });
    await Promise.all([
      refundImageCredits(910, charge!, 0, { settlementId }),
      refundImageCredits(910, charge!, 0, { settlementId }),
    ]);
    await expect(affStatus(910)).resolves.toMatchObject({ balance: 500, packageBalance: 5 });
    await expect(getImageSettlement(settlementId)).resolves.toMatchObject({ status: "refunded", chargedAmount: 0, refundedAmount: 65 });
  });

  it("图包 12 + 个人 5，档内 V5 只需 5 AFF：个人不动", async () => {
    await seedAccount(900, {
      balance: 5,
      packageBalance: 12,
      transactions: [],
      packageUsage: [],
      packageOrders: [],
    });

    const charge = await trySpendImageCredits(900, {
      model: "nai-v5-full",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 1,
    });

    expect(charge).toMatchObject({
      cost: 5,
      packageCost: 5,
      personalCost: 0,
      packageImages: 1,
      balance: 5,
      packageBalance: 7,
    });
  });

  it("图包 1 + 个人 10，档外（steps29）V5 65 AFF 不足时整体回退", async () => {
    await seedAccount(901, {
      balance: 10,
      packageBalance: 1,
      transactions: [],
      packageUsage: [],
      packageOrders: [],
    });

    const charge = await trySpendImageCredits(901, {
      model: "nai-v5-full",
      width: 832,
      height: 1216,
      steps: 29,
      samples: 1,
    });

    expect(charge).toBeNull();
    await expect(affStatus(901)).resolves.toMatchObject({
      balance: 10,
      packageBalance: 1,
      totalBalance: 11,
    });
  });

  it("图包 5 + 个人 240，档外（steps29）V5 65 AFF：混合扣 图包 5 + 个人 60", async () => {
    await seedAccount(903, {
      balance: 240,
      packageBalance: 5,
      transactions: [],
      packageUsage: [],
      packageOrders: [],
    });

    const charge = await trySpendImageCredits(903, {
      model: "nai-v5-full",
      width: 832,
      height: 1216,
      steps: 29,
      samples: 1,
    });

    expect(charge).toMatchObject({
      cost: 65,
      packageCost: 5,
      personalCost: 60,
      packageImages: 1,
      balance: 180,
      packageBalance: 0,
    });
  });

  it("图包 1 + 个人 5，档外 65 AFF 不足时整体回退不动本地余额", async () => {
    await seedAccount(902, {
      balance: 5,
      packageBalance: 1,
      transactions: [],
      packageUsage: [],
      packageOrders: [],
    });

    await expect(
      trySpendImageCredits(902, {
        model: "nai-v5-full",
        width: 832,
        height: 1216,
        steps: 29,
        samples: 1,
      }),
    ).resolves.toBeNull();
    await expect(affStatus(902)).resolves.toMatchObject({
      balance: 5,
      packageBalance: 1,
      totalBalance: 6,
    });
  });

});
