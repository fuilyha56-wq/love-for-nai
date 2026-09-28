import { validateApiKey } from "./validation";

const NAI_ORIGIN = "https://image.novelai.net";

export type NovelaiAccount = {
  connected: true;
  tier: number | null;
  active: boolean | null;
  anlas: { fixed: number; purchased: number; total: number } | null;
  usage: { percent: number; isNegative: boolean; timeUntilNextPercent: number } | null;
  expiresAt: number | null;
};

function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseNovelaiSubscription(value: unknown): NovelaiAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NovelAI 账号信息格式无效");
  const record = value as Record<string, unknown>;
  const steps = record.trainingStepsLeft && typeof record.trainingStepsLeft === "object" ? record.trainingStepsLeft as Record<string, unknown> : null;
  const fixed = finiteNonnegative(steps?.fixedTrainingStepsLeft);
  const purchased = finiteNonnegative(steps?.purchasedTrainingSteps);
  const rawUsage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : null;
  const percent = finiteNonnegative(rawUsage?.percent);
  const until = finiteNonnegative(rawUsage?.timeUntilNextPercent);
  const rawExpiry = finiteNonnegative(record.expiresAt);
  return {
    connected: true,
    tier: finiteNonnegative(record.tier),
    active: typeof record.active === "boolean" ? record.active : null,
    anlas: fixed !== null || purchased !== null ? { fixed: fixed ?? 0, purchased: purchased ?? 0, total: (fixed ?? 0) + (purchased ?? 0) } : null,
    usage: rawUsage && percent !== null ? { percent, isNegative: rawUsage.isNegative === true, timeUntilNextPercent: until ?? 0 } : null,
    expiresAt: rawExpiry === null ? null : rawExpiry < 1e12 ? rawExpiry * 1000 : rawExpiry,
  };
}

export async function readNovelaiAccount(key: string): Promise<NovelaiAccount> {
  const response = await fetch(`${NAI_ORIGIN}/user/subscription`, {
    headers: { Authorization: `Bearer ${validateApiKey(key)}`, Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "NovelAI Key 无效或已失效" : `NovelAI 账号读取失败（${response.status}）`);
  return parseNovelaiSubscription(await response.json());
}

export async function generateNovelaiImage(key: string, body: Record<string, unknown>): Promise<string[]> {
  const response = await fetch(`${NAI_ORIGIN}/ai/generate-image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${validateApiKey(key)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`NovelAI 生图失败（${response.status}）`);
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("NovelAI 返回了非 JSON 图片响应");
  const result = await response.json() as { images?: Array<{ image?: unknown }> };
  const images = Array.isArray(result.images) ? result.images : [];
  return images.flatMap((item) => typeof item?.image === "string" && /^[A-Za-z0-9+/=]+$/.test(item.image) ? [`data:image/png;base64,${item.image}`] : []);
}
