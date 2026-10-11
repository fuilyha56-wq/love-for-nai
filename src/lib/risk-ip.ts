import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type IpGeoSnapshot = {
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
  username?: string;
  ipHmac: string;
  encryptedIp?: { ciphertext: string; nonce: string; authTag: string; keyVersion: number };
  family: "ipv4" | "ipv6" | "unknown";
  firstSeenAt: string;
  lastSeenAt: string;
  requestCount: number;
  geo?: IpGeoSnapshot;
  createdAt: string;
  expiresAt: string;
};

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "risk");
const file = () => path.join(root(), "ip-evidence.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

function secret(name: string): Buffer | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const decoded = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  return decoded.length === 32 ? decoded : createHmac("sha256", name).update(value).digest();
}

function normalizeIp(value: string): { ip: string; family: IpEvidence["family"] } | null {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  const candidate = bracketed?.[1] || (/^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(trimmed) ? trimmed.replace(/:\d+$/, "") : trimmed);
  const family = isIP(candidate);
  if (family === 4) return { ip: candidate, family: "ipv4" };
  if (family === 6) return { ip: candidate.toLowerCase(), family: "ipv6" };
  return null;
}

export function resolveClientIp(request: Request): { ip: string | null; source: "direct" | "x-real-ip" | "x-forwarded-for" | "unknown"; trusted: boolean } {
  const trustProxy = process.env.LFN_TRUST_PROXY === "true";
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const normalized = forwarded ? normalizeIp(forwarded) : null;
    if (normalized) return { ip: normalized.ip, source: "x-forwarded-for", trusted: true };
    const real = request.headers.get("x-real-ip");
    const realNormalized = real ? normalizeIp(real) : null;
    if (realNormalized) return { ip: realNormalized.ip, source: "x-real-ip", trusted: true };
  }
  return { ip: null, source: "unknown", trusted: false };
}

function encryptIp(ip: string): IpEvidence["encryptedIp"] | undefined {
  const key = secret("LFN_IP_ENCRYPTION_KEY");
  if (!key) return undefined;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(ip, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: 1 };
}

export function decryptIp(evidence: IpEvidence): string | null {
  if (!evidence.encryptedIp) return null;
  const key = secret("LFN_IP_ENCRYPTION_KEY");
  if (!key) return null;
  try {
    const item = evidence.encryptedIp;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(item.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(item.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(item.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function recordIpEvidence(request: Request, requestId: string, userId?: number, username?: string): Promise<IpEvidence | null> {
  const resolved = resolveClientIp(request);
  const hashSecret = process.env.LFN_RISK_HASH_SECRET?.trim();
  const normalized = resolved.ip ? normalizeIp(resolved.ip) : null;
  if (!normalized || !hashSecret) return null;
  const ipHmac = createHmac("sha256", hashSecret).update(normalized.ip).digest("hex");
  const now = new Date();
  return withLock(async () => {
    let entries: IpEvidence[];
    try { entries = JSON.parse(await readFile(file(), "utf8")) as IpEvidence[]; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") entries = [];
      else throw new Error("IP 证据读取失败");
    }
    let item = entries.find((candidate) => candidate.ipHmac === ipHmac);
    if (!item) {
      item = { evidenceId: randomBytes(12).toString("hex"), requestId, userId, username, ipHmac, encryptedIp: encryptIp(normalized.ip), family: normalized.family, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), requestCount: 1, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + Number(process.env.LFN_IP_RETENTION_DAYS || 30) * 86400000).toISOString() };
      entries.unshift(item);
    } else {
      item.lastSeenAt = now.toISOString();
      item.requestCount += 1;
      item.userId = userId || item.userId;
      item.username = username || item.username;
      item.requestId = requestId;
    }
    await mkdir(root(), { recursive: true });
    const temporary = `${file()}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(entries.slice(0, 20_000), null, 2), "utf8");
    await rename(temporary, file());
    return item;
  });
}

export async function listIpEvidence(limit = 100): Promise<IpEvidence[]> {
  try { return (JSON.parse(await readFile(file(), "utf8")) as IpEvidence[]).slice(0, Math.min(5000, Math.max(1, limit))); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("IP 证据读取失败");
  }
}

export async function getIpEvidence(evidenceId: string): Promise<IpEvidence | null> {
  return (await listIpEvidence(20_000)).find((item) => item.evidenceId === evidenceId) || null;
}

export async function revealIpEvidence(evidenceId: string): Promise<string | null> {
  const evidence = await getIpEvidence(evidenceId);
  return evidence ? decryptIp(evidence) : null;
}

async function updateGeo(evidenceId: string, geo: IpGeoSnapshot): Promise<IpEvidence | null> {
  return withLock(async () => {
    let entries: IpEvidence[];
    try { entries = JSON.parse(await readFile(file(), "utf8")) as IpEvidence[]; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("IP 证据读取失败");
    }
    const item = entries.find((candidate) => candidate.evidenceId === evidenceId);
    if (!item) return null;
    item.geo = geo;
    await mkdir(root(), { recursive: true });
    const temporary = `${file()}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(entries, null, 2), "utf8");
    await rename(temporary, file());
    return item;
  });
}

export async function queryIpGeo(evidenceId: string): Promise<IpGeoSnapshot | null> {
  const provider = process.env.LFN_IP_GEO_PROVIDER?.trim().toLowerCase() || "none";
  if (provider === "none") return null;
  const ip = await revealIpEvidence(evidenceId);
  if (!ip) return null;
  const configuredUrl = process.env.LFN_IP_GEO_URL?.trim();
  if (!configuredUrl || !/^https:\/\//i.test(configuredUrl)) return null;
  const url = configuredUrl.includes("%IP%")
    ? configuredUrl.replaceAll("%IP%", encodeURIComponent(ip))
    : `${configuredUrl}${configuredUrl.includes("?") ? "&" : "?"}ip=${encodeURIComponent(ip)}`;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const payload = await response.json() as Record<string, unknown>;
  const geo: IpGeoSnapshot = {
    countryCode: typeof payload.countryCode === "string" ? payload.countryCode : typeof payload.country_code === "string" ? payload.country_code : undefined,
    countryName: typeof payload.countryName === "string" ? payload.countryName : typeof payload.country === "string" ? payload.country : undefined,
    region: typeof payload.region === "string" ? payload.region : undefined,
    city: typeof payload.city === "string" ? payload.city : undefined,
    timezone: typeof payload.timezone === "string" ? payload.timezone : undefined,
    asn: typeof payload.asn === "string" || typeof payload.asn === "number" ? String(payload.asn) : undefined,
    organization: typeof payload.organization === "string" ? payload.organization : typeof payload.org === "string" ? payload.org : undefined,
    isp: typeof payload.isp === "string" ? payload.isp : undefined,
    connectionType: typeof payload.connectionType === "string" ? payload.connectionType : undefined,
    isVpn: typeof payload.isVpn === "boolean" ? payload.isVpn : undefined,
    isProxy: typeof payload.isProxy === "boolean" ? payload.isProxy : undefined,
    isTor: typeof payload.isTor === "boolean" ? payload.isTor : undefined,
    isHosting: typeof payload.isHosting === "boolean" ? payload.isHosting : undefined,
    provider,
    queriedAt: new Date().toISOString(),
    confidence: "medium",
  };
  await updateGeo(evidenceId, geo);
  return geo;
}