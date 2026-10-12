import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { affStatus, refundImageCredits, trySpendImageCredits } from "@/lib/aff";
import { createImageSettlement, getImageSettlement } from "@/lib/risk-settlement";

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
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.LFN_DATA_DIR;
  delete process.env.LFN_AFF_GATEWAY_URL;
  delete process.env.LFN_AFF_GATEWAY_TOKEN;
});

describe("图包与个人 AFF 混合扣费（两档计费口径）", () => {
  it("超界 limit 在扣费前拒绝，钱包余额不变", async () => {
    await seedAccount(911, { balance: 50, packageBalance: 5, transactions: [], packageUsage: [], packageOrders: [] });
    await expect(trySpendImageCredits(911, { model: "nai-v5-full-limit", width: 1024, height: 1024, steps: 50, samples: 1 })).rejects.toThrow("limit");
    await expect(affStatus(911)).resolves.toMatchObject({ balance: 50, packageBalance: 5 });
  });

  it("limit 顺序分批逐张验证尺寸、步数和参考图，合法请求扣半点价", async () => {
    await seedAccount(912, { balance: 50, packageBalance: 5, transactions: [], packageUsage: [], packageOrders: [] });
    const base = { model: "nai-v5-full-limit", width: 832, height: 1216, steps: 28, samples: 3, sequential: true };
    for (const override of [{ steps: 50 }, { width: 1088, height: 1024 }, { referenceImageCount: 1 }])
      await expect(trySpendImageCredits(912, { ...base, ...override })).rejects.toThrow("limit");
    await expect(affStatus(912)).resolves.toMatchObject({ balance: 50, packageBalance: 5 });
    await expect(trySpendImageCredits(912, base)).resolves.toMatchObject({ cost: 4.5, packageCost: 4.5 });
  });
  it("新结算全失败退回两个钱包，并发重试只退款一次", async () => {
    await seedAccount(910, { balance: 50, packageBalance: 5, transactions: [], packageUsage: [], packageOrders: [] });
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
    await expect(affStatus(910)).resolves.toMatchObject({ balance: 50, packageBalance: 5 });
    await expect(getImageSettlement(settlementId)).resolves.toMatchObject({ status: "refunded", chargedAmount: 0, refundedAmount: 40 });
  });

  it("图包 12 + 个人 5，档内 V5 只需 1.5 AFF：个人不动", async () => {
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
      cost: 1.5,
      packageCost: 1.5,
      personalCost: 0,
      packageImages: 1,
      balance: 5,
      packageBalance: 10.5,
    });
  });

  it("图包 1 + 个人 10，档外（steps29）V5 40 AFF 不足时整体回退", async () => {
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

  it("图包 5 + 个人 40，档外（steps29）V5 40 AFF：混合扣 图包 5 + 个人 35", async () => {
    await seedAccount(903, {
      balance: 40,
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
      cost: 40,
      packageCost: 5,
      personalCost: 35,
      packageImages: 1,
      balance: 5,
      packageBalance: 0,
    });
  });

  it("图包 1 + 个人 5，档外 40 AFF 不足时整体回退不动本地余额", async () => {
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
