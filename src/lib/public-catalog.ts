import { adminHeaders, adminToken } from "@/lib/admin-auth";
import { newApiBaseUrl } from "@/lib/newapi";
import {
  NEWAPI_BALANCE_PER_CNY,
  newApiBalanceToCny,
  pointPriceCny,
  snapshotFromRawPricing,
  TOKENS_PER_POINT,
  type RawModelPricing,
} from "@/lib/image-pricing";

export type PublicModelKind = "image" | "chat";

export type PublicModelPricing = {
  billingMode: "live" | "private_reference" | "unknown";
  liveType: "per_request" | "per_token" | "tiered" | "unknown";
  liveCnyPerRequest?: number;
  liveCnyPerUsageToken?: number;
  liveGroupName?: string;
  liveGroupRatio?: number;
  privatePointReference: {
    tokensPerPoint: number;
    pointPriceCny: number;
    version: "V5" | "V4.5/旧版";
  } | null;
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

type RawPricing = RawModelPricing & {
  model_name?: unknown;
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
  "当前未读取到上游实时价格，积分价格仅作私立参考；登录后以 NewAPI 实时价格为准。";
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
  if (id.toLowerCase() === "nai-chat") return "NAI Chat";
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

function privateReference(id: string): PublicModelPricing["privatePointReference"] {
  const price = pointPriceCny(id);
  if (price == null) return null;
  return {
    tokensPerPoint: TOKENS_PER_POINT,
    pointPriceCny: price,
    version: id.toLowerCase().includes("nai-v5") ? "V5" : "V4.5/旧版",
  };
}

function livePricing(
  entry: RawPricing,
  modelId: string,
  drawRatio: number,
  hasDrawRatio: boolean,
): PublicModelPricing {
  const ratio = boundedNumber(drawRatio, 1_000_000);
  const groupName = "Draw";
  const baseNote = hasDrawRatio
    ? "实时读取 NewAPI 的公开 Draw 分组倍率。"
    : "未读取到 Draw 分组倍率，登录后以账号实际结算为准。";
  const privatePointReference = privateReference(modelId);
  const snapshot = snapshotFromRawPricing(modelId, entry, ratio, groupName);

  if (snapshot.tiered) {
    return {
      billingMode: "live",
      liveType: "tiered",
      liveCnyPerRequest: newApiBalanceToCny(snapshot.inEnvelopeUsd ?? 0),
      liveCnyPerUsageToken: newApiBalanceToCny(
        snapshot.outOfEnvelopeBalancePerUsageToken ?? 0,
      ),
      liveGroupName: groupName,
      liveGroupRatio: ratio,
      privatePointReference,
      note: `NewAPI 实时分档价格：限制范围内按张结算，超出后按网关 usage token 结算；${baseNote}`,
    };
  }

  if (snapshot.quotaType === 1) {
    const price =
      typeof entry.model_price === "number"
        ? Number.isFinite(entry.model_price)
          ? entry.model_price
          : null
        : typeof entry.model_price === "string" && entry.model_price.trim() !== ""
          ? Number.isFinite(Number(entry.model_price))
            ? Number(entry.model_price)
            : null
          : null;
    if (price == null)
      return {
        billingMode: "unknown",
        liveType: "unknown",
        liveGroupName: groupName,
        liveGroupRatio: ratio,
        privatePointReference,
        note: `NewAPI 返回了按次计费类型，但没有返回可展示的价格；${baseNote}`,
      };
    return {
      billingMode: "live",
      liveType: "per_request",
      liveCnyPerRequest: newApiBalanceToCny(price * ratio),
      liveGroupName: groupName,
      liveGroupRatio: ratio,
      privatePointReference,
      note: `NewAPI 实时按次价格；${baseNote}`,
    };
  }

  const modelRatio = boundedNumber(entry.model_ratio, 1_000_000_000);
  return {
    billingMode: "live",
    liveType: "per_token",
    liveCnyPerUsageToken: newApiBalanceToCny(modelRatio * 2e-6 * ratio),
    liveGroupName: groupName,
    liveGroupRatio: ratio,
    privatePointReference,
    note: `NewAPI 实时按 usage token 结算；${baseNote}`,
  };
}

function fallbackImagePricing(id: string): PublicModelPricing | null {
  const reference = privateReference(id);
  if (!reference) return null;
  return {
    billingMode: "private_reference",
    liveType: "unknown",
    privatePointReference: reference,
    note: "当前暂无 NewAPI 实时数据，这里只显示你提供的私立积分参考价，不代表 NewAPI 实际扣费。",
  };
}

function makeModel(id: string, pricing: PublicModelPricing | null): PublicModel {
  const kind = id.toLowerCase() === "nai-chat" ? "chat" : "image";
  return {
    id,
    kind,
    name: modelName(id),
    summary: modelSummary(id, kind),
    capabilities: modelCapabilities(id, kind),
    pricing: pricing || (kind === "image" ? fallbackImagePricing(id) : null),
  };
}

function fallbackCatalog(message?: string): PublicCatalog {
  return {
    models: FALLBACK_MODEL_IDS.map((id) => makeModel(id, null)),
    asOf: new Date().toISOString(),
    stale: true,
    source: "fallback",
    currency: "CNY",
    conversion: `实时价格不可用。私立参考：1 积分 = ${TOKENS_PER_POINT} token；V4.5 每积分 ¥0.04；V5 每积分 ¥0.06。${fallbackPricingNotes}`,
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
  const rawEntries = entries.filter(
    (entry): entry is RawPricing => Boolean(entry) && typeof entry === "object",
  );

  let drawRatio = 1;
  let hasDrawRatio = false;
  try {
    const groupsResponse = await fetch(`${baseUrl}/api/user/self/groups`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (groupsResponse.ok) {
      const groupsPayload = (await readJson(groupsResponse)) as {
        data?: Record<string, unknown>;
      };
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
    // 没有公开分组倍率时仍返回实时模型目录，并明确标注。
  }

  const byId = new Map<string, PublicModel>();
  for (const entry of rawEntries.slice(0, MAX_MODELS)) {
    const id = cleanText(entry.model_name);
    if (!MODEL_PATTERN.test(id) || byId.has(id)) continue;
    byId.set(id, makeModel(id, livePricing(entry, id, drawRatio, hasDrawRatio)));
  }
  if (!byId.size) throw new Error("上游没有可展示的 NAI 模型");

  return {
    models: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    asOf: new Date().toISOString(),
    stale: false,
    source: "upstream",
    currency: "CNY",
    conversion: `实时价格来自 NewAPI；${NEWAPI_BALANCE_PER_CNY} NewAPI 余额单位 = 1 元人民币。私立参考：1 积分 = ${TOKENS_PER_POINT} token，V4.5 每积分 ¥0.04，V5 每积分 ¥0.06。`,
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
