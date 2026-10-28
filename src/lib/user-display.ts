import { findLocalUsersByIds } from "@/lib/local-users";
import { newApiDbPool } from "@/lib/newapi-db";
import { resolvedAuthProviderId } from "@/lib/platform";

export type UserDisplay = { username: string; name: string; status?: number };
const cache = new Map<string, { value?: UserDisplay; until: number }>();
export async function userDisplayNames(
  userIds: number[],
  options: { fresh?: boolean } = {},
): Promise<Map<number, UserDisplay>> {
  const ids = [...new Set(userIds)].filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  );
  const provider = await resolvedAuthProviderId();
  const prefix = `${provider}:${process.env.LFN_DATA_DIR || process.cwd()}:${process.env.NEWAPI_DB_URL || ""}:`;
  const missing = ids.filter(
    (id) => options.fresh || (cache.get(`${prefix}${id}`)?.until || 0) < Date.now(),
  );
  if (missing.length) {
    let rows: Array<{
      id: number;
      username: string;
      display_name?: string;
      status?: number;
    }> = [];
    if (provider === "local") rows = await findLocalUsersByIds(missing);
    else {
      const pool = newApiDbPool();
      if (pool)
        rows = (
          await pool.query(
            "SELECT id,username,display_name,status FROM users WHERE id=ANY($1::bigint[])",
            [missing],
          )
        ).rows;
    }
    const found = new Map(
      rows.map((row) => [
        Number(row.id),
        {
          username: row.username,
          name: row.display_name || row.username,
          status: row.status,
        },
      ]),
    );
    for (const id of missing)
      cache.set(`${prefix}${id}`, {
        value: found.get(id),
        until: Date.now() + 60_000,
      });
    if (cache.size > 5000)
      for (const [key, entry] of cache)
        if (entry.until < Date.now()) cache.delete(key);
  }
  return new Map(
    ids.flatMap((id) => {
      const value = cache.get(`${prefix}${id}`)?.value;
      return value ? [[id, value] as const] : [];
    }),
  );
}
