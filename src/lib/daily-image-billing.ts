import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readCachedJson, rememberWrittenJson } from "@/lib/json-file-cache";
import { runtimeImagePackageSettings } from "@/lib/runtime-config";
import {
  CNY_PER_AFF,
  DEFAULT_DAILY_IMAGE_POLICY,
  dailyImageDay,
  dailyImageFamily,
  quoteDailyImage,
  type DailyImagePolicy,
  type DailyImageQuote,
  type DailyImageBillingState,
  type DailyImageFamily,
} from "@/lib/daily-image-pricing";
import type { ImagePricingGeneration } from "@/lib/image-pricing";

type Entry = {
  id: string;
  family: DailyImageFamily;
  reserved: number;
  at?: number;
  completed?: number;
  quote?: DailyImageQuote;
};
type Usage = {
  day: string;
  counts: Record<DailyImageFamily, number>;
  entries: Entry[];
};
const root = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "daily-billing",
  );
const policyFile = () => path.join(root(), "policy.json");
const usageFile = (userId: number, now = Date.now()) =>
  path.join(root(), `${userId}-${dailyImageDay(now)}.json`);
const shared = globalThis as typeof globalThis & {
  __lfnDailyBillingLocks?: Map<string, Promise<unknown>>;
};
const locks = (shared.__lfnDailyBillingLocks ??= new Map<
  string,
  Promise<unknown>
>());
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) || Promise.resolve()).then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return next;
}
async function read<T>(file: string, fallback: T): Promise<T> {
  try {
    return await readCachedJson<T>(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}
async function write(file: string, value: unknown) {
  await mkdir(root(), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, file);
  await rememberWrittenJson(file, value);
}
function normalizePolicy(input: DailyImagePolicy): DailyImagePolicy {
  input = { ...DEFAULT_DAILY_IMAGE_POLICY, ...input };
  if (
    typeof input.enabled !== "boolean" ||
    typeof input.strictApiBilling !== "boolean" ||
    !Number.isFinite(input.displayUsdPerCny) ||
    input.displayUsdPerCny <= 0 ||
    input.displayUsdPerCny > 1e6 ||
    ![input.v45AnlasCny, input.v5AnlasCny].every(
      (amount) => Number.isFinite(amount) && amount >= 0 && amount <= 100,
    )
  )
    throw new Error("汇率或 Anlas 单价无效");
  for (const family of ["v45", "v5"] as const) {
    const tiers = input[family];
    if (
      !Array.isArray(tiers) ||
      tiers.length < 1 ||
      tiers.length > 10 ||
      tiers[0].afterImages !== 0
    )
      throw new Error("每个系列需配置首档（从 0 张开始）和最多 10 个阶梯");
    for (const [index, tier] of tiers.entries()) {
      if (
        !Number.isSafeInteger(tier.afterImages) ||
        tier.afterImages < 0 ||
        (index > 0 && tier.afterImages <= tiers[index - 1].afterImages) ||
        !Number.isFinite(tier.baseCny) ||
        tier.baseCny < 0 ||
        tier.baseCny > 100 ||
        ![tier.anlasMultiplier, tier.totalMultiplier].every(
          (factor) => Number.isFinite(factor) && factor >= 0 && factor <= 100,
        )
      )
        throw new Error("阶梯起点必须递增，价格和倍率必须为 0–100 的有限数值");
    }
  }
  return structuredClone(input);
}
export async function dailyImagePolicy(): Promise<DailyImagePolicy> {
  return normalizePolicy(await read(policyFile(), DEFAULT_DAILY_IMAGE_POLICY));
}
export async function saveDailyImagePolicy(input: DailyImagePolicy) {
  const policy = normalizePolicy(input);
  return withLock(policyFile(), async () => {
    await write(policyFile(), policy);
    return policy;
  });
}
async function usage(userId: number, now = Date.now()): Promise<Usage> {
  const day = dailyImageDay(now);
  const legacy = await read<Usage>(path.join(root(), `${userId}.json`), {
    day,
    counts: { v45: 0, v5: 0 },
    entries: [],
  });
  const state = await read<Usage>(
    usageFile(userId, now),
    legacy.day === day
      ? legacy
      : { day, counts: { v45: 0, v5: 0 }, entries: [] },
  );
  const current = {
    ...state,
    counts: { ...state.counts },
    entries: [...state.entries],
  };
  // Recover abandoned reservations after a process crash. Upstream requests have shorter timeouts.
  current.entries = current.entries.map((entry) => {
    if (
      entry.completed !== undefined ||
      !entry.at ||
      now - entry.at < 2 * 3600_000
    )
      return entry;
    current.counts[entry.family] = Math.max(
      0,
      current.counts[entry.family] - entry.reserved,
    );
    return { ...entry, completed: 0 };
  });
  return current;
}
export async function dailyImageBillingState(
  userId: number,
  now = Date.now(),
): Promise<DailyImageBillingState> {
  const [policy, product, current] = await Promise.all([
    dailyImagePolicy(),
    runtimeImagePackageSettings(),
    usage(userId, now),
  ]);
  const packageCny = product.priceUsd / policy.displayUsdPerCny;
  return {
    policy,
    day: current.day,
    counts: current.counts,
    cnyPerAff: CNY_PER_AFF,
    packageCny,
    affPerPackage: product.affPerPackage,
  };
}
export async function reserveDailyImageQuote(
  userId: number,
  generation: ImagePricingGeneration,
  requestId: string,
  now = Date.now(),
): Promise<DailyImageQuote | null> {
  const family = dailyImageFamily(generation);
  if (!family) return null;
  return withLock(usageFile(userId, now), async () => {
    const state = await usage(userId, now);
    const previous = state.entries.find((entry) => entry.id === requestId);
    if (previous) return previous.quote || null;
    const info = await dailyImageBillingState(userId, now);
    const quote = quoteDailyImage(
      generation,
      info.policy,
      info.cnyPerAff,
      state.counts[family],
      state.day,
    );
    state.counts[family] += generation.samples;
    state.entries.push({
      id: requestId,
      family,
      reserved: generation.samples,
      at: now,
      ...(quote ? { quote } : {}),
    });
    await write(usageFile(userId, now), state);
    return quote;
  });
}
export async function settleDailyImageUsage(
  userId: number,
  requestId: string,
  generation: ImagePricingGeneration | null,
  generatedSamples: number,
  now = Date.now(),
) {
  return withLock(usageFile(userId, now), async () => {
    const state = await usage(userId, now);
    const index = state.entries.findIndex((entry) => entry.id === requestId);
    if (index >= 0) {
      const entry = state.entries[index];
      const actual = Math.min(
        entry.reserved,
        Math.max(0, Math.floor(generatedSamples)),
      );
      if (entry.completed !== undefined && actual >= entry.completed) return;
      state.counts[entry.family] = Math.max(
        0,
        state.counts[entry.family] -
          (entry.completed ?? entry.reserved) +
          actual,
      );
      state.entries[index] = { ...entry, completed: actual };
    } else if (generatedSamples > 0) {
      const family = generation && dailyImageFamily(generation);
      if (!family) return;
      const actual = Math.min(generation!.samples, Math.floor(generatedSamples));
      state.counts[family] += actual;
      state.entries.push({ id: requestId, family, reserved: actual, completed: actual, at: now });
    } else {
      return;
    }
    await write(usageFile(userId, now), state);
  });
}
