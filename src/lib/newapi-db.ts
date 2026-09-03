import { Pool } from "pg";

// 外部 API Key → NewAPI 用户 ID：直接查询 NewAPI 数据库的 tokens 表。
// 与 NewAPI TokenAuth 使用同一套完整 key 匹配规则（去 Bearer/sk-，不截断），
// 因此任何在 NewAPI 有效的密钥走 LFN 图像端点都能自动定位
// 到对应的图包/个人 AFF 账本，用户不需要任何绑定操作。
// 未配置 NEWAPI_DB_URL 或 key 无效时返回 null，调用方退回透明代理
//（仅按 NewAPI 余额计费）；数据库故障时抛错，避免静默跳过图包扣费。

type ApiKeyCacheEntry = { userId: number | null; expiresAt: number };

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

export function normalizeNewApiKey(authorization: string): string {
  return authorization
    .replace(/^Bearer\s+/i, "")
    .trim()
    .replace(/^sk-/i, "");
}

export async function resolveExternalApiUser(
  authorization: string,
): Promise<number | null> {
  const key = normalizeNewApiKey(authorization);
  if (!key) return null;
  const pool = dbPool();
  if (!pool) return null;

  const cache = apiKeyCache();
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.userId;

  let userId: number | null = null;
  try {
    const result = await pool.query<{ user_id: number }>(
      `SELECT t.user_id
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
    if (Number.isInteger(parsedUserId) && parsedUserId > 0)
      userId = parsedUserId;
  } catch (error) {
    console.error("[lfn] NewAPI 数据库查询失败:", error);
    throw new Error("暂时无法连接账号服务，请稍后重试");
  }

  if (cache.size >= CACHE_MAX_KEYS) cache.clear();
  cache.set(key, {
    userId,
    expiresAt: now + (userId ? CACHE_POSITIVE_MS : CACHE_NEGATIVE_MS),
  });
  return userId;
}
