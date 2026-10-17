import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { newApiDbPool, newApiDbConfigured } from "@/lib/newapi-db";

export type SessionCleanupPolicy = {
  enabled: boolean;
  idleHours: number;
  intervalMinutes: number;
};
export type SessionCleanupReport = {
  checkedAt: string;
  idleRevoked: number;
  expiredRevoked: number;
  remainingIdle: number;
  error?: string;
};
type CleanupStore = {
  policy: SessionCleanupPolicy;
  report?: SessionCleanupReport;
};
const defaults: SessionCleanupPolicy = {
  enabled: true,
  idleHours: 168,
  intervalMinutes: 60,
};
function validatePolicy(input: SessionCleanupPolicy) {
  if (
    typeof input.enabled !== "boolean" ||
    !Number.isInteger(input.idleHours) ||
    input.idleHours < 1 ||
    input.idleHours > 8760 ||
    !Number.isInteger(input.intervalMinutes) ||
    input.intervalMinutes < 5 ||
    input.intervalMinutes > 1440
  )
    throw new Error("闲置时限应为 1–8760 小时，检查间隔应为 5–1440 分钟");
  return { ...input };
}
const filePath = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "session-cleanup.json",
  );
let storeLock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = storeLock.then(fn, fn);
  storeLock = next.catch(() => undefined);
  return next;
}
async function readStore(): Promise<CleanupStore> {
  try {
    const value = JSON.parse(
      await readFile(filePath(), "utf8"),
    ) as CleanupStore;
    return {
      policy: validatePolicy({ ...defaults, ...value.policy }),
      report: value.report,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { policy: defaults };
    throw error;
  }
}
async function writeStore(value: CleanupStore) {
  const target = filePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, target);
}
export async function sessionCleanupStatus() {
  const store = await readStore();
  return {
    ...store,
    configured: newApiDbConfigured(),
    nextRunAt: store.policy.enabled
      ? new Date(
          store.report
            ? Date.parse(store.report.checkedAt) +
                (store.report.remainingIdle
                  ? 1
                  : store.policy.intervalMinutes) *
                  60_000
            : Date.now(),
        ).toISOString()
      : null,
  };
}
export async function updateSessionCleanupPolicy(input: SessionCleanupPolicy) {
  validatePolicy(input);
  return withLock(async () => {
    const store = await readStore();
    store.policy = input;
    await writeStore(store);
    return input;
  });
}

const scheduler = globalThis as typeof globalThis & {
  __lfnSessionCleanupTimer?: ReturnType<typeof setInterval>;
  __lfnSessionCleanupInFlight?: Promise<SessionCleanupReport | null>;
};

export async function cleanIdleNewApiSessions(
  now = Date.now(),
): Promise<SessionCleanupReport | null> {
  if (scheduler.__lfnSessionCleanupInFlight)
    return scheduler.__lfnSessionCleanupInFlight;
  const pool = newApiDbPool();
  if (!pool) return null;
  scheduler.__lfnSessionCleanupInFlight = (async () => {
    const { policy } = await readStore();
    const timestamp = Math.floor(now / 1000),
      cutoff = timestamp - policy.idleHours * 3600;
    const client = await pool.connect();
    let report: SessionCleanupReport | null = null;
    try {
      await client.query("BEGIN");
      const acquired = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('lfn-idle-session-cleanup')) AS acquired",
      );
      if (!acquired.rows[0]?.acquired) {
        await client.query("ROLLBACK");
        return null;
      }
      // The row lock and repeated activity predicate protect sessions touched during the sweep.
      const result = await client.query<{ expired: boolean }>(
        `WITH candidates AS (
        SELECT sid FROM user_sessions WHERE status='active'
          AND (expires_at <= $1 OR COALESCE(NULLIF(last_active_at,0),created_at) < $2)
        ORDER BY COALESCE(NULLIF(last_active_at,0),created_at) LIMIT 1000 FOR UPDATE SKIP LOCKED
      ) UPDATE user_sessions s SET status='revoked', revoked_at=$1,
          revoked_reason=CASE WHEN s.expires_at <= $1 THEN 'lfn_expired_cleanup' ELSE 'lfn_idle_timeout' END
        FROM candidates c WHERE s.sid=c.sid AND s.status='active'
          AND (s.expires_at <= $1 OR COALESCE(NULLIF(s.last_active_at,0),s.created_at) < $2)
        RETURNING s.expires_at <= $1 AS expired`,
        [timestamp, cutoff],
      );
      const pending = await client.query<{ total: string }>(
        "SELECT COUNT(*) AS total FROM user_sessions WHERE status='active' AND COALESCE(NULLIF(last_active_at,0),created_at)<$1",
        [cutoff],
      );
      await client.query("COMMIT");
      report = {
        checkedAt: new Date(now).toISOString(),
        idleRevoked: result.rows.filter((row) => !row.expired).length,
        expiredRevoked: result.rows.filter((row) => row.expired).length,
        remainingIdle: Number(pending.rows[0]?.total || 0),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      report = {
        checkedAt: new Date(now).toISOString(),
        idleRevoked: 0,
        expiredRevoked: 0,
        remainingIdle: 0,
        error: error instanceof Error ? error.message : "闲置会话清理失败",
      };
      throw error;
    } finally {
      client.release();
      if (report)
        await withLock(async () => {
          const current = await readStore();
          current.report = report!;
          await writeStore(current);
        });
    }
    return report;
  })().finally(() => {
    scheduler.__lfnSessionCleanupInFlight = undefined;
  });
  return scheduler.__lfnSessionCleanupInFlight;
}

export function startAutomaticSessionCleanup() {
  if (scheduler.__lfnSessionCleanupTimer) return;
  const tick = async () => {
    if (!newApiDbConfigured()) return;
    const { policy, report } = await readStore();
    const interval = report?.remainingIdle
      ? 60_000
      : policy.intervalMinutes * 60_000;
    if (
      policy.enabled &&
      (!report || Date.now() - Date.parse(report.checkedAt) >= interval)
    )
      await cleanIdleNewApiSessions();
  };
  const run = () => {
    void tick().catch((error) =>
      console.error(
        "[lfn] 闲置会话清理失败",
        error instanceof Error ? error.message : error,
      ),
    );
  };
  run();
  scheduler.__lfnSessionCleanupTimer = setInterval(run, 60_000);
  scheduler.__lfnSessionCleanupTimer.unref?.();
}
