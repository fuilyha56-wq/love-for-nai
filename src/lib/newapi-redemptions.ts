import { newApiDbPool } from "./newapi-db";
import { maskRedeemCode } from "./redeem-codes";
import { resolvedNewApiBaseUrl, userHeaders, type Session } from "./newapi";
import { resolvedAuthProviderId } from "./platform";

export async function listNewApiRedemptions(page = 1, userId?: number) {
  const pool =
    (await resolvedAuthProviderId()) === "newapi" ? newApiDbPool() : null;
  if (!pool) return { items: [], total: 0, available: false };
  const where = `deleted_at IS NULL${userId ? " AND used_user_id=$1 AND status=3" : ""}`;
  const args = userId ? [userId] : [];
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM redemptions WHERE ${where}`,
    args,
  );
  const result = await pool.query(
    `SELECT id,user_id,"key",status,name,quota,created_time,redeemed_time,used_user_id,expired_time FROM redemptions WHERE ${where} ORDER BY id DESC LIMIT 20 OFFSET $${args.length + 1}`,
    [...args, (page - 1) * 20],
  );
  const options = await pool.query(
    "SELECT value FROM options WHERE key='QuotaPerUnit'",
  );
  const quotaPerUnit = Number(options.rows[0]?.value) || 500000;
  const iso = (value: unknown) =>
    Number(value) > 0
      ? new Date(Number(value) * 1000).toISOString()
      : undefined;
  return {
    available: true,
    total: count.rows[0].total as number,
    items: result.rows.map((row) => ({
      id: `newapi-${row.id}`,
      upstreamId: Number(row.id),
      source: "newapi" as const,
      name: row.name,
      code: maskRedeemCode(String(row.key).trim()),
      amount: Number(row.quota) / quotaPerUnit,
      quota: Number(row.quota),
      rewardType: "newapi-quota" as const,
      status: Number(row.status),
      enabled: Number(row.status) === 1,
      maxUses: 1,
      usedCount: Number(row.status) === 3 ? 1 : 0,
      createdAt: iso(row.created_time),
      expiresAt: iso(row.expired_time),
      redeemedAt: iso(row.redeemed_time),
      createdBy: Number(row.user_id),
      usedUserId: Number(row.used_user_id),
    })),
  };
}

export async function redeemNewApiCode(code: string, session: Session) {
  if ((await resolvedAuthProviderId()) !== "newapi")
    throw new Error("兑换码不存在");
  if (!code.trim() || code.length > 128) throw new Error("兑换码格式无效");
  // Delegate quota mutation, concurrency, expiry checks and cache invalidation to NewAPI.
  const response = await fetch(
    `${await resolvedNewApiBaseUrl()}/api/user/topup`,
    {
      method: "POST",
      headers: userHeaders(session),
      body: JSON.stringify({ key: code.trim() }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    },
  );
  const result = (await response.json()) as {
    success?: boolean;
    message?: string;
    data?: number;
  };
  if (!response.ok || !result.success)
    throw new Error(result.message || "NewAPI 兑换失败，请检查兑换码是否有效");
  return {
    source: "newapi",
    quota: result.data,
    message: "兑换成功，额度已进入 NewAPI 余额",
  };
}

export async function toggleNewApiRedemption(id: number, enabled: boolean) {
  const pool = newApiDbPool();
  if (!pool || !Number.isSafeInteger(id) || id <= 0)
    throw new Error("NewAPI 兑换码不可用");
  const result = await pool.query(
    "UPDATE redemptions SET status=$2 WHERE id=$1 AND deleted_at IS NULL AND status IN (1,2) RETURNING id",
    [id, enabled ? 1 : 2],
  );
  if (!result.rowCount)
    throw new Error("兑换码不存在或已兑换，不能重新启用已使用的码");
}
