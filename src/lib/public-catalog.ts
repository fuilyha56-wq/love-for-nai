import { adminHeaders, adminToken } from "@/lib/admin-auth";
import { newApiBaseUrl } from "@/lib/newapi";
import {
  NEWAPI_BALANCE_PER_CNY,
  newApiBalanceToCny,
} from "@/lib/image-pricing";

export type PublicModelKind = "image" | "chat";

export type PublicModelPricing = {
  billingMode: "tiered" | "per_request" | "per_token" | "unknown";
  groupName: string;
  groupRatio: number;
  ratioSource: "draw" | "base";
  inEnvelopeBalance?: number;
  inEnvelopeCny?: number;
  outOfEnvelopeBalancePerMillion?: number;
  outOfEnvelopeCnyPerMillion?: number;
  perRequestBalance?: number;
  perRequestCny?: number;
  perMillionTokensBalance?: number;
  perMillionTokensCny?: number;
  note: string;
};

export type PublicModel = {
  id: string;
  kind: PublicModelKind;
  name: string;
  summary: string;
  capabilities: string[];
  pricing: PublicModelPricing | null;
};

export type PublicCatalog = {
  models: PublicModel[];
  asOf: string;
  stale: boolean;
  source: "upstream" | "fallback" | "snapshot";
  currency: "CNY";
  conversion: string;
  message?: string;
};

type RawPricing = {
  model_name?: unknown;
  model_ratio?: unknown;
  model_price?: unknown;
  quota_type?: unknown;
  enable_groups?: unknown;
  billing_mode?: unknown;
  billing_expr?: unknown;
};

const CACHE_TTL_MS = 60_000;
const MAX_MODELS = 120;
const MAX_FIELD_LENGTH = 96;
const MODEL_PATTERN = /^nai-[a-z0-9][a-z0-9._-]{0,80}$/i;

const FALLBACK_MODEL_IDS = [
  "nai-v5-full",
  "nai-v5-curated",
  "nai-v5-inpaint",
  "nai-v5-full-limit",
  "nai-v5-curated-limit",
  "nai-v5-inpaint-limit",
  "nai-v4.5-full",
  "nai-v4.5-curated",
  "nai-v4.5-inpaint",
  "nai-v4.5-full-limit",
  "nai-v4.5-curated-limit",
  "nai-v4.5-inpaint-limit",
  "nai-v4-curated",
  "nai-v3",
  "nai-v3-furry",
  "nai-v3-inpaint",
  "nai-v3-furry-inpaint",
  "nai-chat",
] as const;

const fallbackPricingNotes =
  "当前未读取到上游实时价格，以下仅为模型目录；请登录后以账号实际分组价格为准。";

let cached: { value: PublicCatalog; expiresAt: number } | null = null;
let lastVerified: PublicCatalog | null = null;

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedNumber(value: unknown, max: number): number {
  return Math.min(finiteNumber(value), max);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_FIELD_LENGTH) : "";
}

function modelName(id: string): string {
  if (id === "nai-chat") return "NAI Chat";
  const version = id.match(/^nai-(v[345](?:\.5)?)/i)?.[1]?.toUpperCase();
  const mode = id.includes("inpaint")
    ? "局部重绘"
    : id.includes("curated")
      ? "精选"
      : id.includes("furry")
        ? "兽人"
        : "完整";
  const limited = id.includes("-limit") ? " · 受限" : "";
  return `${version || "NAI"} ${mode}${limited}`.trim();
}

function modelSummary(id: string, kind: PublicModelKind): string {
  if (kind === "chat") return "用于标签助手、提示词整理与多轮创作对话。";
  if (id.includes("inpaint")) return "适合局部重绘、修补与细节迭代。";
  if (id.includes("curated")) return "精选风格模型，适合稳定的二次元构图。";
  if (id.includes("furry")) return "面向兽人题材的图像生成模型。";
  return "NovelAI 图像生成模型，支持中文工作台与原生参数。";
}

function modelCapabilities(id: string, kind: PublicModelKind): string[] {
  if (kind === "chat") return ["多轮对话", "提示词助手", "标签整理"];
  const capabilities = ["文生图", "NovelAI 参数"];
  if (id.includes("inpaint")) capabilities.push("局部重绘");
  if (id.includes("-limit")) capabilities.push("固定限制档");
  if (id.includes("v5")) capabilities.push("V5 画质");
  return capabilities;
}

function parseTiered(expr: string): { limit: number; full: number } | null {
  const limit = expr.match(/tier\(\s*["']limit["']\s*,\s*p\s*\*\s*(\d+)\s*\)/i);
  const full = expr.match(/tier\(\s*["']full["']\s*,\s*p\s*\*\s*(\d+)\s*\)/i);
  if (!limit || !full) return null;
  const limitValue = Number(limit[1]);
  const fullValue = Number(full[1]);
  if (![limitValue, fullValue].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000)) return null;
  return { limit: limitValue, full: fullValue };
}

function publicPricing(
  entry: RawPricing,
  drawRatio: number,
  hasDrawRatio: boolean,
): PublicModelPricing | null {
  const ratioValue = finiteNumber(entry.model_ratio, -1);
  const priceValue = finiteNumber(entry.model_price, -1);
  const quotaTypeValue = finiteNumber(entry.quota_type, -1);
  const rawMode = cleanText(entry.billing_mode).toLowerCase();
  if (rawMode !== "tiered_expr" && ratioValue < 0 && priceValue < 0)
    return null;
  const ratio = boundedNumber(drawRatio, 1_000_000);
  const groupName = "Draw";
  const tiered = rawMode === "tiered_expr" ? parseTiered(cleanText(entry.billing_expr)) : null;
  const noteBase = hasDrawRatio
    ? "按公开 Draw 分组倍率展示。"
    : "暂按基础倍率 1 展示，实际价格以登录后的账号分组为准。";

  if (tiered) {
    const inEnvelopeBalance = (8 * tiered.limit * 0.5 * ratio) / 500_000;
    const outOfEnvelopeBalancePerMillion = (tiered.full * 0.5 * ratio) / 500_000;
    return {
      billingMode: "tiered",
      groupName,
      groupRatio: ratio,
      ratioSource: hasDrawRatio ? "draw" : "base",
      inEnvelopeBalance,
      inEnvelopeCny: newApiBalanceToCny(inEnvelopeBalance),
      outOfEnvelopeBalancePerMillion,
      outOfEnvelopeCnyPerMillion: newApiBalanceToCny(outOfEnvelopeBalancePerMillion),
      note: `满足 n=1、steps≤28、≤1024×1024、纯文生图且无参考图/多角色时为档内固定价；${noteBase}`,
    };
  }

  const quotaType = Math.round(quotaTypeValue);
  if (quotaType === 1) {
    const perRequestBalance = boundedNumber(entry.model_price, 1_000_000_000) * ratio;
    return {
      billingMode: "per_request",
      groupName,
      groupRatio: ratio,
      ratioSource: hasDrawRatio ? "draw" : "base",
      perRequestBalance,
      perRequestCny: newApiBalanceToCny(perRequestBalance),
      note: `按次计费；${noteBase}`,
    };
  }

  const perMillionTokensBalance =
    boundedNumber(entry.model_ratio, 1_000_000_000) * 2 * ratio;
  return {
    billingMode: "per_token",
    groupName,
    groupRatio: ratio,
    ratioSource: hasDrawRatio ? "draw" : "base",
    perMillionTokensBalance,
    perMillionTokensCny: newApiBalanceToCny(perMillionTokensBalance),
    note: `按估算 token 计费；${noteBase}`,
  };
}

function makeModel(id: string, pricing: PublicModelPricing | null): PublicModel {
  const kind = id.toLowerCase() === "nai-chat" ? "chat" : "image";
  const fallback = pricing || (kind === "image" ? fallbackImagePricing(id) : null);
  return {
    id,
    kind,
    name: modelName(id),
    summary: modelSummary(id, kind),
    capabilities: modelCapabilities(id, kind),
    pricing: fallback,
  };
}

function fallbackImagePricing(id: string): PublicModelPricing {
  const isV5 = id.toLowerCase().includes("nai-v5");
  const inEnvelopeBalance = isV5 ? 8 : 0;
  return {
    billingMode: "tiered",
    groupName: "Draw",
    groupRatio: 1,
    ratioSource: "base",
    inEnvelopeBalance,
    inEnvelopeCny: newApiBalanceToCny(inEnvelopeBalance),
    outOfEnvelopeBalancePerMillion: isV5 ? 130_000 : 100_000,
    outOfEnvelopeCnyPerMillion: newApiBalanceToCny(isV5 ? 130_000 : 100_000),
    note: `内置展示估算：${isV5 ? "V5" : "V4.5/旧版"} 档内固定价格；实际价格以登录后账号分组为准。`,
  };
}

function fallbackCatalog(message?: string): PublicCatalog {
  return {
    models: FALLBACK_MODEL_IDS.map((id) => makeModel(id, null)),
    asOf: new Date().toISOString(),
    stale: true,
    source: "fallback",
    currency: "CNY",
    conversion: `200 NewAPI 余额单位 = 1 元人民币；${fallbackPricingNotes}`,
    ...(message ? { message } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) throw new Error("上游返回空响应");
  return JSON.parse(text) as unknown;
}

async function fetchUpstreamCatalog(): Promise<PublicCatalog> {
  const headers = adminToken() ? adminHeaders() : {};
  const baseUrl = newApiBaseUrl().replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/api/pricing`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`上游价格服务返回 ${response.status}`);
  const payload = (await readJson(response)) as { data?: unknown };
  const entries = Array.isArray(payload.data) ? payload.data : [];
  const rawEntries = entries.filter((entry): entry is RawPricing => Boolean(entry) && typeof entry === "object");

  let drawRatio = 1;
  let hasDrawRatio = false;
  try {
    const groupsResponse = await fetch(`${baseUrl}/api/user/self/groups`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (groupsResponse.ok) {
      const groupsPayload = (await readJson(groupsResponse)) as { data?: Record<string, unknown> };
      const draw = groupsPayload.data?.Draw || groupsPayload.data?.draw;
      if (draw && typeof draw === "object") {
        const ratio = finiteNumber((draw as { ratio?: unknown }).ratio, -1);
        if (ratio >= 0 && ratio <= 1_000_000) {
          drawRatio = ratio;
          hasDrawRatio = true;
        }
      }
    }
  } catch {
    // 没有公开分组倍率时保留基础倍率展示，并在每张卡说明。
  }

  const byId = new Map<string, PublicModel>();
  for (const entry of rawEntries.slice(0, MAX_MODELS)) {
    const id = cleanText(entry.model_name);
    if (!MODEL_PATTERN.test(id) || byId.has(id)) continue;
    byId.set(id, makeModel(id, publicPricing(entry, drawRatio, hasDrawRatio)));
  }
  if (!byId.size) throw new Error("上游没有可展示的 NAI 模型");

  return {
    models: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    asOf: new Date().toISOString(),
    stale: false,
    source: "upstream",
    currency: "CNY",
    conversion: `200 NewAPI 余额单位 = 1 元人民币；价格按公开 ${hasDrawRatio ? "Draw" : "基础"} 倍率展示。`,
  };
}

export async function getPublicCatalog(): Promise<PublicCatalog> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const value = await fetchUpstreamCatalog();
    cached = { value, expiresAt: now + CACHE_TTL_MS };
    lastVerified = value;
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : "上游价格暂不可用";
    if (lastVerified) {
      const value: PublicCatalog = {
        ...lastVerified,
        stale: true,
        source: "snapshot",
        message: `实时价格暂不可用，显示最近一次数据（${message}）。`,
      };
      cached = { value, expiresAt: now + CACHE_TTL_MS };
      return value;
    }
    const value = fallbackCatalog(message);
    cached = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }
}

export { NEWAPI_BALANCE_PER_CNY };
