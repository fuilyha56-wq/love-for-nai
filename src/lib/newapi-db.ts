import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  getRuntimeSettings,
  runtimeAdminToken,
  runtimeNewApiBaseUrl,
} from "@/lib/runtime-config";

// 外部 API Key → NewAPI 用户 ID：优先直查 NewAPI 数据库的 tokens 表。
// 与 NewAPI TokenAuth 使用同一套完整 key 匹配规则（去 Bearer/sk-，不截断），
// 因此任何在 NewAPI 有效的密钥走 LFN 图像端点都能自动定位
// 到对应的图包/个人 AFF 账本，用户不需要任何绑定操作。
// 跨服务器部署（数据库不可直连）时改走管理 API 的 token 搜索做
// HTTP 兜底识别；两者都不可用或 key 无效时返回 null，调用方退回
// 透明代理（仅按 NewAPI 余额计费）。数据库配置存在但故障时抛错，
// 避免静默跳过图包扣费。

export type ExternalApiIdentity = {
  userId: number | null;
  username: string | null;
  group: string | null;
};

type ApiKeyCacheEntry = ExternalApiIdentity & { expiresAt: number };

const globalStore = globalThis as typeof globalThis & {
  __lfnNewApiDbPool?: Pool;
  __lfnApiKeyUserCache?: Map<string, ApiKeyCacheEntry>;
};

const CACHE_POSITIVE_MS = 60_000;
const CACHE_NEGATIVE_MS = 15_000;
const CACHE_MAX_KEYS = 2_000;

function apiKeyCache(): Map<string, ApiKeyCacheEntry> {
  return (globalStore.__lfnApiKeyUserCache ??= new Map());
}

function dbPool(): Pool | null {
  const connectionString = process.env.NEWAPI_DB_URL?.trim();
  if (!connectionString) return null;
  globalStore.__lfnNewApiDbPool ??= new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  return globalStore.__lfnNewApiDbPool;
}

export function newApiDbPool(): Pool | null {
  return dbPool();
}

export function newApiDbConfigured(): boolean {
  return Boolean(process.env.NEWAPI_DB_URL?.trim());
}

type HttpTokenRow = {
  user_id?: number | string;
  key?: string;
  status?: number | string;
  expired_time?: number | string;
  allow_ips?: string | null;
  group?: string | null;
};

// HTTP 兜底：数据库不可直连时，用管理令牌调 NewAPI 的 token 搜索接口，
// 按完整 key 精确匹配并核验用户状态。与 SQL 路径同一套有效性规则。
async function resolveUserViaHttp(
  key: string,
  nowSeconds: number,
): Promise<ExternalApiIdentity> {
  const base = await runtimeNewApiBaseUrl();
  const adminToken = await runtimeAdminToken();
  if (!base || !adminToken) return { userId: null, username: null, group: null };
  const settings = await getRuntimeSettings().catch(() => null);
  const adminUser =
    settings?.newApiAdminUserId || process.env.LFN_ADMIN_USER_ID || "1";
  const headers = {
    Authorization: adminToken,
    "New-Api-User": adminUser,
    Accept: "application/json",
  };

  const search = await fetch(
    `${base}/api/token/?p=1&size=10&keyword=${encodeURIComponent(key)}`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!search.ok) return { userId: null, username: null, group: null };
  const payload = (await search.json()) as {
    data?: { items?: HttpTokenRow[] } | HttpTokenRow[];
  };
  const items = Array.isArray(payload.data)
    ? payload.data
    : payload.data?.items || [];
  const match = items.find((row) => {
    const rowKey = String(row.key ?? "").replace(/^sk-/i, "");
    if (rowKey !== key) return false;
    if (Number(row.status) !== 1) return false;
    if (row.allow_ips) return false;
    const expiredTime = Number(row.expired_time);
    return expiredTime === -1 || expiredTime > nowSeconds;
  });
  if (!match) return { userId: null, username: null, group: null };

  const userId = Number(match.user_id);
  if (!Number.isInteger(userId) || userId <= 0)
    return { userId: null, username: null, group: null };
  const group = typeof match.group === "string" && match.group.trim()
    ? match.group.trim()
    : null;
  const userResponse = await fetch(`${base}/api/user/${userId}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) return { userId, username: null, group };
  const userPayload = (await userResponse.json()) as {
    data?: { status?: number | string; username?: string };
  };
  if (Number(userPayload.data?.status) !== 1) return { userId, username: null, group };
  const username = userPayload.data?.username;
  return { userId, username: username ? String(username) : null, group };
}

export function normalizeNewApiKey(authorization: string): string {
  return authorization
    .replace(/^Bearer\s+/i, "")
    .trim()
    .replace(/^sk-/i, "");
}

export async function resolveExternalApiIdentity(
  authorization: string,
): Promise<ExternalApiIdentity> {
  const key = normalizeNewApiKey(authorization);
  if (!key) return { userId: null, username: null, group: null };
  const now = Date.now();
  const cache = apiKeyCache();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now)
    return { userId: cached.userId, username: cached.username, group: cached.group };
  const pool = dbPool();
  if (!pool) {
    // 数据库不可直连（跨服务器部署）：走管理 API 兜底识别，
    // 确保外部 Key 仍能命中站内图包/个人 AFF 账本，而不是静默透传。
    const httpIdentity = await resolveUserViaHttp(
      key,
      Math.floor(now / 1000),
    ).catch(() => ({ userId: null, username: null, group: null }));
    if (cache.size >= CACHE_MAX_KEYS) cache.clear();
    cache.set(key, {
      userId: httpIdentity.userId,
      username: httpIdentity.username,
      group: httpIdentity.group,
      expiresAt: now + (httpIdentity.userId ? CACHE_POSITIVE_MS : CACHE_NEGATIVE_MS),
    });
    return httpIdentity;
  }

  let userId: number | null = null;
  let username: string | null = null;
  let group: string | null = null;
  try {
    const result = await pool.query<{ user_id: number; username: string; group: string }>(
      `SELECT t.user_id, t."group", u.username
         FROM tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.key = $1
          AND t.status = 1
          AND t.deleted_at IS NULL
          AND (t.allow_ips IS NULL OR t.allow_ips = '')
          AND (t.expired_time = -1 OR t.expired_time > $2)
          AND u.status = 1
          AND u.deleted_at IS NULL
        LIMIT 1`,
      [key, Math.floor(now / 1000)],
    );
    const row = result.rows[0];
    // pg 驱动把 bigint 序列化成字符串，需显式转数字再校验。
    const parsedUserId = row ? Number(row.user_id) : NaN;
    if (Number.isInteger(parsedUserId) && parsedUserId > 0) {
      userId = parsedUserId;
      username = row.username ? String(row.username) : null;
      group = row.group ? String(row.group) : null;
    }
  } catch (error) {
    console.error("[lfn] NewAPI 数据库查询失败:", error);
    throw new Error("暂时无法连接账号服务，请稍后重试");
  }

  if (cache.size >= CACHE_MAX_KEYS) cache.clear();
  cache.set(key, {
    userId,
    username,
    group,
    expiresAt: now + (userId ? CACHE_POSITIVE_MS : CACHE_NEGATIVE_MS),
  });
  return { userId, username, group };
}

export async function resolveExternalApiUser(
  authorization: string,
): Promise<number | null> {
  return (await resolveExternalApiIdentity(authorization)).userId;
}

// ── 无渠道分组时的托管密钥回退 ─────────────────────────────────────
// 外部密钥（Launcher 等）所属分组可能没有目标模型的渠道（如 default
// 分组打 NAI 模型）。此时用管理权限为该用户建/取一把可用分组的托管
// 密钥（归属同一用户，仍计其 NewAPI 余额）。需要数据库可直连（建钥
// 走 SQL）；分组判定走管理 HTTP（模型 enable_groups + 用户分组 +
// UserUsableGroups），各缓存 5 分钟。

const MANAGED_TOKEN_PREFIX = "lfn-managed";
const GROUP_CACHE_MS = 5 * 60_000;
const groupCache = new Map<
  string,
  { value: string[] | null; expiresAt: number }
>();

type AdminApiContext = {
  base: string;
  headers: Record<string, string>;
};

async function adminApiContext(): Promise<AdminApiContext | null> {
  const base = await runtimeNewApiBaseUrl();
  const adminToken = await runtimeAdminToken();
  if (!base || !adminToken) return null;
  const settings = await getRuntimeSettings().catch(() => null);
  const adminUser =
    settings?.newApiAdminUserId || process.env.LFN_ADMIN_USER_ID || "1";
  return {
    base,
    headers: {
      Authorization: adminToken,
      "New-Api-User": adminUser,
      Accept: "application/json",
    },
  };
}

async function cachedValue(
  key: string,
  fallback: string[],
  load: () => Promise<string[] | string>,
): Promise<string[]> {
  const now = Date.now();
  const hit = groupCache.get(key);
  if (hit && hit.expiresAt > now && hit.value) return hit.value;
  const value = await load().catch(() => fallback);
  const list = Array.isArray(value) ? value : value ? [value] : fallback;
  groupCache.set(key, { value: list, expiresAt: now + GROUP_CACHE_MS });
  return list;
}

async function fetchModelGroups(
  ctx: AdminApiContext,
  model: string,
): Promise<string[]> {
  return cachedValue(`model:${model}`, [], async () => {
    const response = await fetch(`${ctx.base}/api/pricing`, {
      headers: ctx.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const result = (await response.json()) as {
      data?: Array<{ model_name?: string; enable_groups?: string[] }>;
    };
    return (
      result.data?.find((item) => item.model_name === model)?.enable_groups?.filter(
        (item): item is string => typeof item === "string",
      ) ?? []
    );
  });
}

async function fetchUserGroup(ctx: AdminApiContext, userId: number): Promise<string[]> {
  return cachedValue(`user:${userId}`, [""], async () => {
    const response = await fetch(`${ctx.base}/api/user/${userId}`, {
      headers: ctx.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return "";
    const result = (await response.json()) as { data?: { group?: unknown } };
    return typeof result.data?.group === "string" ? result.data.group : "";
  });
}

async function fetchUsableGroups(ctx: AdminApiContext): Promise<string[]> {
  return cachedValue("usable", [], async () => {
    const response = await fetch(`${ctx.base}/api/option/`, {
      headers: ctx.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const result = (await response.json()) as {
      data?: Array<{ key?: string; value?: unknown }>;
    };
    const entry = result.data?.find((item) => item.key === "UserUsableGroups");
    const parsed =
      typeof entry?.value === "string" ? JSON.parse(entry.value) : entry?.value;
    return parsed && typeof parsed === "object"
      ? Object.keys(parsed as Record<string, unknown>)
      : [];
  });
}

/**
 * 为外部无渠道分组的用户取/建一把可用分组的托管密钥，返回原始 key
 * （不含 sk- 前缀）。分组不可解或数据库不可用时返回 null，调用方保留
 * 原始上游错误。
 */
export async function ensureManagedFallbackToken(
  userId: number,
  model: string,
): Promise<string | null> {
  const ctx = await adminApiContext();
  if (!ctx) return null;
  const pool = dbPool();
  if (!pool) return null;

  const [modelGroups, userGroups, usable] = await Promise.all([
    fetchModelGroups(ctx, model),
    fetchUserGroup(ctx, userId),
    fetchUsableGroups(ctx),
  ]);
  const owned = new Set([...userGroups, ...usable]);
  const group = modelGroups.find((item) => owned.has(item));
  if (!group) return null;

  const name = `${MANAGED_TOKEN_PREFIX}-${group.toLowerCase()}`;
  const existing = await pool.query<{ key: string }>(
    `SELECT key FROM tokens
      WHERE user_id = $1 AND name = $2 AND status = 1 AND deleted_at IS NULL
      LIMIT 1`,
    [userId, name],
  );
  const found = existing.rows[0]?.key;
  if (found) return String(found);

  const key = randomBytes(24).toString("hex");
  await pool.query(
    `INSERT INTO tokens
       (user_id, key, status, name, created_time, accessed_time, expired_time,
        remain_quota, unlimited_quota, model_limits_enabled, model_limits,
        allow_ips, used_quota, "group", cross_group_retry)
     VALUES ($1, $2, 1, $3, $4, $4, -1, 0, true, false, '', '', 0, $5, false)`,
    [userId, key, name, Math.floor(Date.now() / 1000), group],
  );
  return key;
}
