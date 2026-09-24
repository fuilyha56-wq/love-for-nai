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
