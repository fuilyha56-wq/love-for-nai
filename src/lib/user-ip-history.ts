import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { newApiDbPool } from "./newapi-db";
import { decryptIp, listIpEvidence } from "./risk-ip";
import { ipGeolocation } from "./ip-geolocation";

export async function userIpHistory(userId: number, reveal = false) {
  const local = (await listIpEvidence(20_000)).filter(
    (item) => item.userId === userId || item.userIds?.includes(userId),
  );
  const addresses = new Map<string, string>();
  for (const item of local) {
    const ip = decryptIp(item);
    if (ip) addresses.set(item.ipHmac, ip);
  }
  const items = new Map(
    local.map((item) => [
      item.ipHmac,
      {
        evidenceId: item.evidenceId,
        requestId: item.users?.[String(userId)]?.requestId || item.requestId,
        family: item.family,
        firstSeenAt:
          item.users?.[String(userId)]?.firstSeenAt || item.firstSeenAt,
        lastSeenAt: item.users?.[String(userId)]?.lastSeenAt || item.lastSeenAt,
        requestCount:
          item.users?.[String(userId)]?.requestCount ?? item.requestCount,
        sessionCount: 0,
        sources: ["LFN 请求"],
        masked: `完整地址已隐藏 · ${item.family === "ipv6" ? "IPv6" : "IPv4"}`,
        geo: item.geo,
        ...(reveal ? { ip: decryptIp(item) || undefined } : {}),
      },
    ]),
  );
  const pool = newApiDbPool();
  if (pool) {
    const since =
      Math.floor(Date.now() / 1000) -
      Math.max(1, Number(process.env.LFN_IP_RETENTION_DAYS || 30)) * 86400;
    const result = await pool.query<{
      ip: string;
      first_seen: string;
      last_seen: string;
      requests: string;
      sessions: string;
    }>(
      `
      SELECT ip, MIN(first_seen)::text AS first_seen, MAX(last_seen)::text AS last_seen,
        SUM(requests)::text AS requests, SUM(sessions)::text AS sessions FROM (
        SELECT ip, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen, COUNT(*) AS requests, 0 AS sessions
        FROM logs WHERE user_id=$1 AND created_at >= $2 AND ip IS NOT NULL AND ip<>'' GROUP BY ip
        UNION ALL
        SELECT ip, MIN(created_at), MAX(GREATEST(created_at,last_active_at)), 0, COUNT(*)
        FROM user_sessions WHERE user_id=$1 AND GREATEST(created_at,last_active_at) >= $2 AND ip IS NOT NULL AND ip<>'' GROUP BY ip
      ) evidence GROUP BY ip`,
      [userId, since],
    );
    for (const row of result.rows) {
      const ip = row.ip.trim().replace(/^::ffff:(?=\d+\.)/, "");
      const family = isIP(ip);
      if (!family) continue;
      const hash = createHmac(
        "sha256",
        process.env.LFN_RISK_HASH_SECRET || "lfn-history",
      )
        .update(ip)
        .digest("hex");
      const previous = items.get(hash);
      addresses.set(hash, ip);
      const first = new Date(Number(row.first_seen) * 1000).toISOString(),
        last = new Date(Number(row.last_seen) * 1000).toISOString();
      const sources = [
        ...(previous?.sources || []),
        ...(Number(row.requests) ? ["NewAPI 调用"] : []),
        ...(Number(row.sessions) ? ["NewAPI 登录"] : []),
      ];
      items.set(hash, {
        evidenceId: previous?.evidenceId || `newapi-${hash.slice(0, 24)}`,
        requestId: previous?.requestId || "历史记录未保留请求 ID",
        family: family === 6 ? "ipv6" : "ipv4",
        firstSeenAt:
          previous && previous.firstSeenAt < first
            ? previous.firstSeenAt
            : first,
        lastSeenAt:
          previous && previous.lastSeenAt > last ? previous.lastSeenAt : last,
        // A NewAPI log can represent the same LFN request; don't add both.
        requestCount: Math.max(
          previous?.requestCount || 0,
          Number(row.requests),
        ),
        sessionCount: Number(row.sessions),
        sources,
        masked: `完整地址已隐藏 · IPv${family}`,
        geo: previous?.geo,
        ...(reveal ? { ip } : {}),
      });
    }
  }
  await Promise.all(
    [...items.entries()].map(async ([hash, item]) => {
      const ip = addresses.get(hash);
      if (ip) item.geo = await ipGeolocation(ip);
      else if (!item.geo)
        item.geo = {
          provider: "local",
          queriedAt: new Date().toISOString(),
          status: "unavailable",
          message: "历史地址无法解密，无法查询归属地",
        };
    }),
  );
  return [...items.values()].sort((a, b) =>
    b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
}
