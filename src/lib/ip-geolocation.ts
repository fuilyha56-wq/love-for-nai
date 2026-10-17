import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPv4,
  IPv6,
  parseIP,
  ipToString,
  loadHeaderFromFile,
  loadVectorIndexFromFile,
  newWithVectorIndex,
} from "ip2region.js";
import { readCachedJson, rememberWrittenJson } from "./json-file-cache";
import type { IpGeoSnapshot } from "./risk-ip";

const databaseRoot = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.LFN_IP_GEO_DATABASE_DIR ||
      path.join(process.cwd(), "resources", "ip-geolocation"),
  );
const cacheFile = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.LFN_DATA_DIR ||
      path.join(process.cwd(), "data"),
    "risk",
    "ip-geolocation.json",
  );
type CachedGeo = { geo: IpGeoSnapshot; expiresAt: number; revision: string };
type Database = {
  file: string;
  vector: Buffer;
  revision: string;
  updatedAt: string;
};
const databases = new Map<string, Database>();
const locks = globalThis as typeof globalThis & {
  __lfnGeoLock?: Promise<unknown>;
};

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const pending = (locks.__lfnGeoLock || Promise.resolve()).then(task, task);
  locks.__lfnGeoLock = pending.catch(() => undefined);
  return pending;
}

function database(family: number): Database {
  const file = path.join(databaseRoot(), `ip2region_v${family}.xdb`);
  let current = databases.get(file);
  if (!current) {
    const header = loadHeaderFromFile(file);
    if (header.ipVersion !== family || ![2, 3].includes(header.version))
      throw new Error("离线地址库版本不匹配");
    const manifest = JSON.parse(
      readFileSync(path.join(databaseRoot(), "manifest.json"), "utf8"),
    ) as { revision: string; sourceUpdatedAt: string };
    current = {
      file,
      vector: loadVectorIndexFromFile(file),
      revision: manifest.revision,
      updatedAt: manifest.sourceUpdatedAt,
    };
    databases.set(file, current);
  }
  return current;
}

function isPrivate(ip: string, family: number) {
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return ip === "::" || ip === "::1" || /^(?:f[cd]|fe[89ab]|ff)/i.test(ip);
}

/** Local lookup for both encrypted LFN evidence and existing NewAPI addresses. */
export async function ipGeolocation(raw: string): Promise<IpGeoSnapshot> {
  let ip = raw
    .trim()
    .toLowerCase()
    .replace(/^::ffff:(?=\d+\.)/, "");
  const family = isIP(ip),
    queriedAt = new Date().toISOString();
  if (!family)
    return {
      provider: "ip2region",
      queriedAt,
      status: "unavailable",
      message: "地址格式无效",
    };
  if (family === 6) {
    try {
      ip = ipToString(parseIP(ip), true);
    } catch {
      return {
        provider: "ip2region",
        queriedAt,
        status: "unavailable",
        message: "地址格式无效",
      };
    }
  }
  if (isPrivate(ip, family))
    return {
      provider: "local",
      queriedAt,
      status: "private",
      message: "内网或保留地址，无公网归属地",
    };
  return withLock(async () => {
    try {
      const db = database(family);
      const hash = createHmac(
        "sha256",
        process.env.LFN_RISK_HASH_SECRET ||
          process.env.LFN_SESSION_SECRET ||
          "lfn-geo-local",
      )
        .update(ip)
        .digest("hex");
      let cache: Record<string, CachedGeo> = {};
      try {
        cache = await readCachedJson<Record<string, CachedGeo>>(cacheFile());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const existing = cache[hash];
      if (
        existing &&
        existing.expiresAt > Date.now() &&
        existing.revision === db.revision
      )
        return existing.geo;
      const searcher = newWithVectorIndex(
        family === 4 ? IPv4 : IPv6,
        db.file,
        db.vector,
      );
      let region: string;
      try {
        region = await searcher.search(ip);
      } finally {
        searcher.close();
      }
      const clean = (value?: string) =>
        value && value !== "0" && value !== "-" ? value : undefined;
      const [country, province, city, isp, code] = region.split("|");
      const geo: IpGeoSnapshot = {
        provider: "ip2region",
        queriedAt,
        databaseUpdatedAt: db.updatedAt,
        countryName: clean(country),
        countryCode: clean(code),
        region: clean(province),
        city: clean(city),
        isp: clean(isp),
        status: clean(country) ? "resolved" : "unavailable",
        confidence: "medium",
        ...(!clean(country) ? { message: "地址库暂无该地址的归属地记录" } : {}),
      };
      const ttl = geo.status === "resolved" ? 7 * 86400000 : 3600000;
      const retained = Object.fromEntries(
        Object.entries(cache)
          .filter(([, item]) => item.expiresAt > Date.now())
          .slice(-19999),
      );
      retained[hash] = {
        geo,
        expiresAt: Date.now() + ttl,
        revision: db.revision,
      };
      const target = cacheFile(),
        temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temporary, JSON.stringify(retained), "utf8");
      await rename(temporary, target);
      await rememberWrittenJson(target, retained);
      return geo;
    } catch {
      return {
        provider: "ip2region",
        queriedAt,
        status: "unavailable",
        message: "离线地址库暂不可用，请检查服务器地址库文件和缓存目录",
      };
    }
  });
}
