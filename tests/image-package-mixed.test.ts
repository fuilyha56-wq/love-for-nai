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

describe("图包与个人 AFF 混合扣费（两档计费口径）", () => {
  it("图包 12 + 个人 5，档内 V5 只需 2 AFF：图包扣 2，个人不动", async () => {
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
      cost: 2,
      packageCost: 2,
      personalCost: 0,
      packageImages: 1,
      balance: 5,
      packageBalance: 10,
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
