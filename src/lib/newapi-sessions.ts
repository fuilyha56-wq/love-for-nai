import { newApiDbConfigured, newApiDbPool } from "@/lib/newapi-db";

// 上游 NewAPI 登录会话（user_sessions 表）的管理入口。
// 上游对单用户活跃登录会话数有上限（默认 50），登出未撤销或浏览器直接
// 丢弃 cookie 都会泄漏会话，撞满后登录 409 Conflict。管理员清理必须
// 同时覆盖上游（status='active' → 'revoked'），只清 LFN cookie 没用。
// 上游没有「撤销指定用户全部会话」的管理 HTTP 接口（revoke-others 是
// 自助路由，只能撤销调用者自己的会话），因此只能直查数据库。

export type NewApiSessionCount = {
  userId: number;
  username: string | null;
  activeSessions: number;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function listNewApiUserSessions(): Promise<NewApiSessionCount[]> {
  const pool = newApiDbPool();
  if (!pool) throw new Error("NEWAPI_DB_URL 未配置，无法读取上游会话");
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
      ORDER BY active_sessions DESC
      LIMIT 200`,
    [nowSeconds()],
  );
  return result.rows.map((row) => ({
    userId: Number(row.user_id),
    username: row.username ? String(row.username) : null,
    activeSessions: Number(row.active_sessions),
  }));
}

// userId 为 null 时撤销全部用户的活跃会话（批量 UPDATE）。
export async function revokeNewApiUserSessions(
  userId: number | null,
): Promise<number> {
  const pool = newApiDbPool();
  if (!pool)
    throw new Error("NEWAPI_DB_URL 未配置，无法清理上游登录会话");
  const result = userId == null
    ? await pool.query(
        `UPDATE user_sessions
            SET status = 'revoked',
                revoked_at = $1,
                revoked_reason = 'lfn_admin_clear'
          WHERE status = 'active'
            AND expires_at > $1`,
        [nowSeconds()],
      )
    : await pool.query(
        `UPDATE user_sessions
            SET status = 'revoked',
                revoked_at = $1,
                revoked_reason = 'lfn_admin_clear_user'
          WHERE user_id = $2
            AND status = 'active'
            AND expires_at > $1`,
        [nowSeconds(), userId],
      );
  return result.rowCount ?? 0;
}

export function upstreamSessionDbConfigured(): boolean {
  return newApiDbConfigured();
}
