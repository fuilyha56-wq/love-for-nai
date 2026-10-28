import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { dailyImagePolicy, saveDailyImagePolicy } from "@/lib/daily-image-billing";
import { DEFAULT_DAILY_IMAGE_POLICY, quoteDailyImage } from "@/lib/daily-image-pricing";

let directory = "";
const saved = process.env.LFN_DATA_DIR;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "lfn-daily-policy-")); process.env.LFN_DATA_DIR = directory; });
afterEach(async () => {
  if (saved === undefined) delete process.env.LFN_DATA_DIR; else process.env.LFN_DATA_DIR = saved;
  if (!path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), "lfn-daily-policy-"))) throw new Error("Unexpected cleanup path");
  await rm(directory, { recursive: true, force: true });
});
it("uses 0.01 CNY defaults with V5 Anlas multipliers of one", async () => {
  const policy = await dailyImagePolicy();
  expect(policy.v45AnlasCny).toBe(0.01); expect(policy.v5AnlasCny).toBe(0.01);
  expect(policy.v5.every(tier => tier.anlasMultiplier === 1)).toBe(true);
  expect(quoteDailyImage({ model: "nai-v5-full", width: 2048, height: 1536, steps: 28, samples: 1 }, policy, 0.005, 0)).toMatchObject({ anlas: 90, costAff: 185 });
  expect(quoteDailyImage({ model: "nai-v4.5-full", width: 2048, height: 1536, steps: 28, samples: 1 }, policy, 0.005, 0)).toMatchObject({ anlas: 60, costAff: 121 });
});
it("honors saved and externally edited prices instead of overriding them", async () => {
  const custom = { ...DEFAULT_DAILY_IMAGE_POLICY, v45AnlasCny: 0.007, v5AnlasCny: 0.013 };
  await saveDailyImagePolicy(custom); expect(await dailyImagePolicy()).toEqual(custom);
  const file = path.join(directory, "daily-billing/policy.json");
  const changed = { ...JSON.parse(await readFile(file, "utf8")), v45AnlasCny: 0.01, v5AnlasCny: 0.01 };
  await writeFile(file, JSON.stringify(changed)); expect(await dailyImagePolicy()).toEqual(changed);
});
it("rejects invalid configured prices without changing the previous policy", async () => {
  await saveDailyImagePolicy(DEFAULT_DAILY_IMAGE_POLICY);
  await expect(saveDailyImagePolicy({ ...DEFAULT_DAILY_IMAGE_POLICY, v5AnlasCny: -1 })).rejects.toThrow("单价无效");
  await expect(saveDailyImagePolicy({ ...DEFAULT_DAILY_IMAGE_POLICY, v45AnlasCny: Infinity })).rejects.toThrow("单价无效");
  expect(await dailyImagePolicy()).toEqual(DEFAULT_DAILY_IMAGE_POLICY);
});
