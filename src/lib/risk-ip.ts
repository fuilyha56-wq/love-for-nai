import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { isIP } from "node:net";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cachedRiskSettings } from "./risk-settings";
import { getRuntimeSettings } from "./runtime-config";
import { readCachedJson, rememberWrittenJson } from "./json-file-cache";

export type IpGeoSnapshot = {
  status?: "resolved" | "private" | "unavailable";
  message?: string;
  databaseUpdatedAt?: string;
  countryCode?: string;
  countryName?: string;
  region?: string;
  city?: string;
  timezone?: string;
  asn?: string;
  organization?: string;
  isp?: string;
  connectionType?: string;
  isVpn?: boolean;
  isProxy?: boolean;
  isTor?: boolean;
  isHosting?: boolean;
  provider: string;
  queriedAt: string;
  confidence?: "low" | "medium" | "high";
};

export type IpEvidence = {
  evidenceId: string;
  requestId: string;
  userId?: number;
  userIds?: number[];
  users?: Record<
    string,
    {
      firstSeenAt: string;
      lastSeenAt: string;
      requestCount: number;
      requestId: string;
    }
  >;
  username?: string;
  ipHmac: string;
  encryptedIp?: {
    ciphertext: string;
    nonce: string;
    authTag: string;
    keyVersion: number;
  };
  family: "ipv4" | "ipv6" | "unknown";
  firstSeenAt: string;
  lastSeenAt: string;
  requestCount: number;
  geo?: IpGeoSnapshot;
  createdAt: string;
  expiresAt: string;
};

const root = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "risk",
  );
const file = () => path.join(root(), "ip-evidence.json");
type IpMemory = { file: string; pending: Promise<IpEvidence[]>; index: Map<string, IpEvidence>; timer?: ReturnType<typeof setTimeout> };

const ipRuntime = globalThis as typeof globalThis & { __lfnIpMemory?: { lock: Promise<unknown>; memory?: IpMemory } };
const shared = (ipRuntime.__lfnIpMemory ??= { lock: Promise.resolve() });
async function ipMemory(): Promise<{ entries: IpEvidence[]; current: IpMemory }> {
  if (shared.memory?.file !== file()) {
    if (shared.memory?.timer) clearTimeout(shared.memory.timer);
    const current: IpMemory = { file: file(), index: new Map(), pending: Promise.resolve([]) };
    current.pending = readCachedJson<IpEvidence[]>(file()).catch(error => { if (error.code === "ENOENT") return []; throw error; }).then(entries => {
      const retained = structuredClone(entries).filter(e => Date.parse(e.expiresAt) > Date.now()).slice(0, Number(cachedRiskSettings().values["network.ipIndexCapacity"]));
      current.index = new Map(retained.map(e => [e.ipHmac, e])); return retained;
    });
    shared.memory = current;
  }
  return { entries: await shared.memory.pending, current: shared.memory };
}
async function persistIpMemory(entries: IpEvidence[], current: IpMemory) {
  await mkdir(path.dirname(current.file), { recursive: true });
  const temporary = `${current.file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(entries), "utf8");
  await rename(temporary, current.file);
  await rememberWrittenJson(current.file, entries);
}
export async function cachedIpGeo(request: Request): Promise<IpGeoSnapshot | undefined> {
  const ip = (await resolveTrustedClientIp(request)).ip, key = process.env.LFN_RISK_HASH_SECRET?.trim();
  if (!ip || !key) return;
  const { current } = await ipMemory();
  return current.index.get(createHmac("sha256", key).update(ip).digest("hex"))?.geo;
}


function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = shared.lock.then(task, task);
  shared.lock = current.catch(() => undefined);
  return current;
}

function secret(name: string): Buffer | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const decoded = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  return decoded.length === 32
    ? decoded
    : createHmac("sha256", name).update(value).digest();
}

function normalizeIp(
  value: string,
): { ip: string; family: IpEvidence["family"] } | null {
  const trimmed = value.trim().replace(/^::ffff:(?=\d+\.)/i, "");
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  const candidate =
    bracketed?.[1] ||
    (/^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(trimmed)
      ? trimmed.replace(/:\d+$/, "")
      : trimmed);
  const family = isIP(candidate);
  if (family === 4) return { ip: candidate, family: "ipv4" };
  if (family === 6) return { ip: new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase(), family: "ipv6" };
  return null;
}

export function resolveClientIp(request: Request, trustedProxy = process.env.LFN_TRUST_PROXY === "true"): {
  ip: string | null;
  source: "direct" | "x-real-ip" | "x-forwarded-for" | "unknown";
  trusted: boolean;
} {
  const trustProxy = trustedProxy;
  if (trustProxy) {
    // The trusted edge overwrites X-Real-IP. Do not prefer a client-supplied
    // prefix of X-Forwarded-For, which nginx may append to rather than replace.
    const real = request.headers.get("x-real-ip");
    const realNormalized = real ? normalizeIp(real) : null;
    if (realNormalized)
      return { ip: realNormalized.ip, source: "x-real-ip", trusted: true };
    const forwarded = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    const normalized = forwarded ? normalizeIp(forwarded) : null;
    if (normalized)
      return { ip: normalized.ip, source: "x-forwarded-for", trusted: true };
  }
  return { ip: null, source: "unknown", trusted: false };
}
export async function resolveTrustedClientIp(request: Request) {
  return resolveClientIp(request, (await getRuntimeSettings()).trustProxy);
}

function encryptIp(ip: string): IpEvidence["encryptedIp"] | undefined {
  const key = secret("LFN_IP_ENCRYPTION_KEY");
  if (!key) return undefined;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(ip, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function decryptIp(evidence: IpEvidence): string | null {
  if (!evidence.encryptedIp) return null;
  const key = secret("LFN_IP_ENCRYPTION_KEY");
  if (!key) return null;
  try {
    const item = evidence.encryptedIp;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(item.nonce, "base64"),
    );
    decipher.setAuthTag(Buffer.from(item.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(item.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export async function recordIpEvidence(
  request: Request,
  requestId: string,
  userId?: number,
  username?: string,
  buffered = false,
): Promise<IpEvidence | null> {
  const resolved = await resolveTrustedClientIp(request);
  const hashSecret = process.env.LFN_RISK_HASH_SECRET?.trim();
  const normalized = resolved.ip ? normalizeIp(resolved.ip) : null;
  if (!normalized || !hashSecret) return null;
  const ipHmac = createHmac("sha256", hashSecret)
    .update(normalized.ip)
    .digest("hex");
  const now = new Date();
  const settings = cachedRiskSettings(), maxAccounts = Number(settings.values["network.maxAccountsPerExit"]);
  return withLock(async () => {
    const { entries, current } = await ipMemory();
    let item = current.index.get(ipHmac);
    if (!item) {
      item = {
        evidenceId: randomBytes(12).toString("hex"),
        requestId,
        userId,
        userIds: userId ? [userId] : [],
        username,
        ipHmac,
        encryptedIp: encryptIp(normalized.ip),
        family: normalized.family,
        firstSeenAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        requestCount: 1,
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() +
            Number(settings.values["network.ipRetentionDays"]) * 86400000,
        ).toISOString(),
      };
      entries.unshift(item);
      current.index.set(ipHmac, item);
      while (entries.length > Number(settings.values["network.ipIndexCapacity"])) { const removed = entries.pop(); if (removed) current.index.delete(removed.ipHmac); }
    } else {
      item.lastSeenAt = now.toISOString();
      item.requestCount += 1;
      const previousUserId = item.userId;
      item.userId = userId || item.userId;
      const userIds = new Set(
        item.userIds || (previousUserId ? [previousUserId] : []),
      );
      if (userId) userIds.add(userId);
      item.userIds = [...userIds].slice(-maxAccounts);
      item.username = username || item.username;
      item.requestId = requestId;
      item.expiresAt = new Date(
        now.getTime() +
          Number(settings.values["network.ipRetentionDays"]) * 86400000,
      ).toISOString();
      item.encryptedIp ||= encryptIp(normalized.ip);
    }
    if (userId) {
      item.users ||= {};
      const previous = item.users[String(userId)];
      item.users[String(userId)] = {
        firstSeenAt: previous?.firstSeenAt || now.toISOString(),
        lastSeenAt: now.toISOString(),
        requestCount: (previous?.requestCount || 0) + 1,
        requestId,
      };
      const ids = Object.keys(item.users); for (const id of ids.slice(0, Math.max(0, ids.length - maxAccounts))) delete item.users[id];
    }
    if (buffered) {
      if (!current.timer) { current.timer = setTimeout(() => { current.timer = undefined; void withLock(() => persistIpMemory(entries, current)).catch(() => console.error("[lfn] IP diagnostic batch write failed")); }, Number(settings.values["audit.flushSeconds"]) * 1000); current.timer.unref?.(); }
    } else await persistIpMemory(entries, current);
    return item;
  });
}

export async function listIpEvidence(limit = 100): Promise<IpEvidence[]> {
  try {
    return (await ipMemory()).entries
      .filter((item) => Date.parse(item.expiresAt) > Date.now())
      .slice(0, Math.min(20_000, Math.max(1, limit)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("IP 证据读取失败");
  }
}

export async function getIpEvidence(
  evidenceId: string,
): Promise<IpEvidence | null> {
  return (
    (await listIpEvidence(20_000)).find(
      (item) => item.evidenceId === evidenceId,
    ) || null
  );
}

export async function revealIpEvidence(
  evidenceId: string,
): Promise<string | null> {
  const evidence = await getIpEvidence(evidenceId);
  return evidence ? decryptIp(evidence) : null;
}

async function updateGeo(evidenceId: string, geo: IpGeoSnapshot): Promise<void> {
  await withLock(async () => {
    const { entries, current } = await ipMemory();
    const item = entries.find(e => e.evidenceId === evidenceId);
    if (!item) return;
    item.geo = geo;
    await persistIpMemory(entries, current);
  });
}

export async function queryIpGeo(
  evidenceId: string,
): Promise<IpGeoSnapshot | null> {
  const provider =
    process.env.LFN_IP_GEO_PROVIDER?.trim().toLowerCase() || "ip2region";
  const ip = await revealIpEvidence(evidenceId);
  if (!ip) return null;
  if (
    provider === "none" ||
    provider === "ip2region" ||
    !process.env.LFN_IP_GEO_URL?.trim()
  ) {
    const geo = await import("./ip-geolocation").then((module) =>
      module.ipGeolocation(ip),
    );
    await updateGeo(evidenceId, geo);
    return geo;
  }
  const configuredUrl = process.env.LFN_IP_GEO_URL?.trim();
  if (!configuredUrl || !/^https:\/\//i.test(configuredUrl)) return null;
  const url = configuredUrl.includes("%IP%")
    ? configuredUrl.replaceAll("%IP%", encodeURIComponent(ip))
    : `${configuredUrl}${configuredUrl.includes("?") ? "&" : "?"}ip=${encodeURIComponent(ip)}`;
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as Record<string, unknown>;
  const geo: IpGeoSnapshot = {
    countryCode:
      typeof payload.countryCode === "string"
        ? payload.countryCode
        : typeof payload.country_code === "string"
          ? payload.country_code
          : undefined,
    countryName:
      typeof payload.countryName === "string"
        ? payload.countryName
        : typeof payload.country === "string"
          ? payload.country
          : undefined,
    region: typeof payload.region === "string" ? payload.region : undefined,
    city: typeof payload.city === "string" ? payload.city : undefined,
    timezone:
      typeof payload.timezone === "string" ? payload.timezone : undefined,
    asn:
      typeof payload.asn === "string" || typeof payload.asn === "number"
        ? String(payload.asn)
        : undefined,
    organization:
      typeof payload.organization === "string"
        ? payload.organization
        : typeof payload.org === "string"
          ? payload.org
          : undefined,
    isp: typeof payload.isp === "string" ? payload.isp : undefined,
    connectionType:
      typeof payload.connectionType === "string"
        ? payload.connectionType
        : undefined,
    isVpn: typeof payload.isVpn === "boolean" ? payload.isVpn : undefined,
    isProxy: typeof payload.isProxy === "boolean" ? payload.isProxy : undefined,
    isTor: typeof payload.isTor === "boolean" ? payload.isTor : undefined,
    isHosting:
      typeof payload.isHosting === "boolean" ? payload.isHosting : undefined,
    provider,
    queriedAt: new Date().toISOString(),
    confidence: "medium",
  };
  await updateGeo(evidenceId, geo);
  return geo;
}
