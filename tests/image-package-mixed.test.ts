import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { affStatus, trySpendImageCredits } from "@/lib/aff";

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

describe("图包与个人 AFF 混合扣费", () => {
  it("图包 12 + 个人 5，full 模型 20 AFF 时按 图包 12 + 个人 5 + 余额不足回退", async () => {
    await seedAccount(900, {
      balance: 5,
      packageBalance: 12,
      transactions: [],
      packageUsage: [],
      packageOrders: [],
    });

    const charge = await trySpendImageCredits(900, {
      model: "nai-v4.5-full",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 1,
    });

    // 个人 5 + 图包 12 = 17 < 20，两种本地余额都不够，应整体回退 NewAPI。
    expect(charge).toBeNull();
    await expect(affStatus(900)).resolves.toMatchObject({
      balance: 5,
      packageBalance: 12,
      totalBalance: 17,
    });
  });

  it("图包 12 + 个人 10，full 模型 20 AFF 时混合扣 图包 12 + 个人 8", async () => {
    await seedAccount(901, {
      balance: 10,
      packageBalance: 12,
      transactions: [],
      packageUsage: [],
      packageOrders: [],
    });

    const charge = await trySpendImageCredits(901, {
      model: "nai-v4.5-full",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 1,
    });

    expect(charge).toMatchObject({
      cost: 20,
      packageCost: 12,
      personalCost: 8,
      packageImages: 1,
      balance: 2,
      packageBalance: 0,
    });
  });
});
