import { newApiDbConfigured, newApiDbPool } from "@/lib/newapi-db";

// 上游 NewAPI 登录会话（user_sessions 表）的管理入口。
// 上游对单用户活跃登录会话数有上限（默认 50），登出未撤销或浏览器直接
// 丢弃 cookie 都会泄漏会话，撞满后登录 409 Conflict。管理员清理必须
// 同时覆盖上游（status='active' → 'revoked'），只清 LFN cookie 没用。
// 上游没有「撤销指定用户全部会话」的管理 HTTP 接口（revoke-others 是
// 自助路由，只能撤销调用者自己的会话），因此只能直查数据库。

export const ACTIVE_SESSION_WARNING_THRESHOLD = 25;

export type NewApiSessionCount = {
  userId: number;
  username: string | null;
  activeSessions: number;
};

export type NewApiSessionRevokeResult = NewApiSessionCount & {
  revokedSessions: number;
};

export type NewApiSessionSummary = {
  threshold: number;
  totalActiveSessions: number;
  usersWithActiveSessions: number;
  overThresholdUsers: number;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sessionThreshold(value: number): number {
  return Number.isInteger(value) && value >= 0
    ? value
    : ACTIVE_SESSION_WARNING_THRESHOLD;
}

export async function listNewApiUserSessions(options?: {
  minActiveSessions?: number;
}): Promise<NewApiSessionCount[]> {
  const pool = newApiDbPool();
  if (!pool) throw new Error("NEWAPI_DB_URL 未配置，无法读取上游会话");
  const minimum = options?.minActiveSessions;
  const threshold = minimum == null ? null : sessionThreshold(minimum);
  const result = await pool.query<{
    user_id: string | number;
    username: string | null;
    active_sessions: string | number;
  }>(
    `SELECT s.user_id, u.username, COUNT(*)::bigint AS active_sessions
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.status = 'active'
        AND s.expires_at > $1
      GROUP BY s.user_id, u.username
      ${threshold == null ? "" : "HAVING COUNT(*) > $2"}
      ORDER BY active_sessions DESC
      LIMIT 200`,
    threshold == null ? [nowSeconds()] : [nowSeconds(), threshold],
  );
  return result.rows.map((row) => ({
    userId: Number(row.user_id),
    username: row.username ? String(row.username) : null,
    activeSessions: Number(row.active_sessions),
  }));
}

export async function listNewApiUsersOverSessionThreshold(
  threshold = ACTIVE_SESSION_WARNING_THRESHOLD,
): Promise<NewApiSessionCount[]> {
  return listNewApiUserSessions({ minActiveSessions: threshold });
}

export async function countNewApiActiveSessions(): Promise<number> {
  const pool = newApiDbPool();
  if (!pool) throw new Error("NEWAPI_DB_URL 未配置，无法读取上游会话");
  const result = await pool.query<{ total_active_sessions: string | number }>(
    `SELECT COUNT(*)::bigint AS total_active_sessions
       FROM user_sessions
      WHERE status = 'active'
        AND expires_at > $1`,
    [nowSeconds()],
  );
  return Number(result.rows[0]?.total_active_sessions || 0);
}

// Overview 只需要聚合数字，复用同一张 user_sessions 表，避免新增 API 形状。
export async function summarizeNewApiSessions(
  threshold = ACTIVE_SESSION_WARNING_THRESHOLD,
): Promise<NewApiSessionSummary> {
  const pool = newApiDbPool();
  if (!pool) throw new Error("NEWAPI_DB_URL 未配置，无法读取上游会话");
  const now = nowSeconds();
  const result = await pool.query<{
    total_active_sessions: string | number;
    users_with_active_sessions: string | number;
    over_threshold_users: string | number;
  }>(
    `SELECT totals.total_active_sessions,
            COUNT(*)::bigint AS users_with_active_sessions,
            COUNT(*) FILTER (WHERE active_sessions > $2)::bigint AS over_threshold_users
       FROM (
         SELECT user_id, COUNT(*)::bigint AS active_sessions
           FROM user_sessions
          WHERE status = 'active'
            AND expires_at > $1
          GROUP BY user_id
       ) session_counts
       CROSS JOIN (SELECT COUNT(*)::bigint AS total_active_sessions
                     FROM user_sessions
                    WHERE status = 'active'
                      AND expires_at > $1) totals
      GROUP BY totals.total_active_sessions`,
    [now, sessionThreshold(threshold)],
  );
  const row = result.rows[0];
  return {
    threshold: sessionThreshold(threshold),
    totalActiveSessions: Number(row?.total_active_sessions || 0),
    usersWithActiveSessions: Number(row?.users_with_active_sessions || 0),
    overThresholdUsers: Number(row?.over_threshold_users || 0),
  };
}

// userId 为 null 时撤销全部用户的活跃会话（批量 UPDATE）。
export async function revokeNewApiUserSessions(
  userId: number | null,
): Promise<number> {
  const pool = newApiDbPool();
  if (!pool)
    throw new Error("NEWAPI_DB_URL 未配置，无法清理上游登录会话");
  const now = nowSeconds();
  const result = userId == null
    ? await pool.query(
        `UPDATE user_sessions
            SET status = 'revoked',
                revoked_at = $1,
                revoked_reason = 'lfn_admin_clear'
          WHERE status = 'active'
            AND expires_at > $1`,
        [now],
      )
    : await pool.query(
        `UPDATE user_sessions
            SET status = 'revoked',
                revoked_at = $1,
                revoked_reason = 'lfn_admin_clear_user'
          WHERE user_id = $2
            AND status = 'active'
            AND expires_at > $1`,
        [now, userId],
      );
  return result.rowCount ?? 0;
}

// 一次 SQL 找出所有超过告警阈值的用户，并撤销这些用户的全部活跃会话。
// 返回每个用户的原活跃数和实际撤销数，方便管理员确认批量清理结果。
export async function revokeNewApiUsersOverSessionThreshold(
  threshold = ACTIVE_SESSION_WARNING_THRESHOLD,
): Promise<{ users: NewApiSessionRevokeResult[]; totalRevoked: number }> {
  const pool = newApiDbPool();
  if (!pool)
    throw new Error("NEWAPI_DB_URL 未配置，无法清理上游登录会话");
  const now = nowSeconds();
  const result = await pool.query<{
    user_id: string | number;
    username: string | null;
    active_sessions: string | number;
    revoked_sessions: string | number;
  }>(
    `WITH over_threshold AS (
       SELECT s.user_id, u.username, COUNT(*)::bigint AS active_sessions
         FROM user_sessions s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.status = 'active'
          AND s.expires_at > $1
        GROUP BY s.user_id, u.username
       HAVING COUNT(*) > $2
     ), revoked AS (
       UPDATE user_sessions s
          SET status = 'revoked',
              revoked_at = $1,
              revoked_reason = 'lfn_admin_clear_over_threshold'
         FROM over_threshold o
        WHERE s.user_id = o.user_id
          AND s.status = 'active'
          AND s.expires_at > $1
       RETURNING s.user_id
     )
     SELECT o.user_id, o.username, o.active_sessions,
            COUNT(r.user_id)::bigint AS revoked_sessions
       FROM over_threshold o
       LEFT JOIN revoked r ON r.user_id = o.user_id
      GROUP BY o.user_id, o.username, o.active_sessions
      ORDER BY o.active_sessions DESC`,
    [now, sessionThreshold(threshold)],
  );
  const users = result.rows.map((row) => ({
    userId: Number(row.user_id),
    username: row.username ? String(row.username) : null,
    activeSessions: Number(row.active_sessions),
    revokedSessions: Number(row.revoked_sessions),
  }));
  return {
    users,
    totalRevoked: users.reduce((sum, user) => sum + user.revokedSessions, 0),
  };
}

export function upstreamSessionDbConfigured(): boolean {
  return newApiDbConfigured();
}
