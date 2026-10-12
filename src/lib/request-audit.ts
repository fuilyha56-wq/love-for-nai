import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimeSettings } from "@/lib/runtime-config";

type JsonRecord = Record<string, unknown>;

export type RequestAuditRisk = {
  score: number;
  level: "normal" | "watch" | "risk" | "critical" | "banned";
  signalIds: string[];
  promptFingerprint?: string;
  promptShapeFingerprint?: string;
  promptLength?: number;
  clusterId?: string;
  decision: "allow" | "rate-limit" | "deny";
};

export type RequestAuditSettlement = {
  settlementId: string;
  status: string;
  chargedAmount: number;
  refundedAmount: number;
  paymentSource: string;
  refundReferenceId?: string;
};

export type RequestAuditBilling = {
  lfnChargedAff?: number;
  gatewayAnlasCost?: number;
  gatewayUsage?: JsonRecord;
  gatewayPromptTokens?: number;
};

export type RequestUsageSummary = {
  userId: number;
  requests5h: number;
  requests7d: number;
  requests30d: number;
  retainedRecords: number;
};

export type RequestAuditRecord = {
  requestId: string;
  requestFingerprint: string;
  createdAt: string;
  source: "lfn" | "api";
  endpoint: string;
  operation?: string;
  model?: string;
  userId?: number;
  username?: string;
  clientIpHash?: string;
  userAgent?: string;
  referer?: string;
  parameters: JsonRecord;
  status?: number;
  durationMs?: number;
  historyIds: string[];
  upstreamRequestId?: string;
  paymentSource?: string;
  watermarkStatus?: "embedded" | "disabled" | "skipped" | "failed";
  error?: string;
  ipEvidenceId?: string;
  risk?: RequestAuditRisk;
  settlement?: RequestAuditSettlement;
  billing?: RequestAuditBilling;
};

type AuditStore = { records: RequestAuditRecord[] };
type UsageEvent = { userId: number; at: number; requestId?: string };
type UsageStore = { events: UsageEvent[] };

const auditRoot = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "request-audit");
const auditPath = () => path.join(auditRoot(), "index.json");
const usagePath = () => path.join(auditRoot(), "usage.json");
const MAX_RECORDS = 5000;
const MAX_USAGE_EVENTS = 100_000;
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<AuditStore> {
  try {
    const value = JSON.parse(await readFile(auditPath(), "utf8")) as Partial<AuditStore>;
    return { records: Array.isArray(value.records) ? value.records : [] };
  } catch {
    return { records: [] };
  }
}

async function writeStore(store: AuditStore): Promise<void> {
  await mkdir(auditRoot(), { recursive: true });
  const temporary = `${auditPath()}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rename(temporary, auditPath());
      return;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EACCES") throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function readUsageStore(): Promise<UsageStore> {
  try {
    const value = JSON.parse(await readFile(usagePath(), "utf8")) as Partial<UsageStore>;
    return { events: Array.isArray(value.events) ? value.events : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [] };
    throw new Error("调用量数据读取失败");
  }
}

async function writeUsageStore(store: UsageStore): Promise<void> {
  await mkdir(auditRoot(), { recursive: true });
  const temporary = `${usagePath()}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ events: store.events.slice(-MAX_USAGE_EVENTS) }), "utf8");
  await rename(temporary, usagePath());
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSensitiveKey(key: string): boolean {
  return /authorization|cookie|password|token|secret|api[_-]?key|private[_-]?key|verification[_-]?code/i.test(key);
}

function summarizeDataUrl(value: string): JsonRecord | string {
  const match = value.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i);
  if (!match) return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  const bytes = Buffer.from(match[2], "base64");
  return { type: "image", mime: match[1].toLowerCase(), bytes: bytes.length, sha256: sha256(bytes) };
}

/** Removes credentials and replaces image bodies with a digest/size summary. */
export function safeAuditValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 8) return "[depth-limit]";
  if (isSensitiveKey(key)) return "[redacted]";
  if (typeof value === "string") return value.startsWith("data:image/") ? summarizeDataUrl(value) : value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeAuditValue(item, key, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonRecord).slice(0, 200).map(([childKey, childValue]) => [childKey, safeAuditValue(childValue, childKey, depth + 1)]));
  }
  return String(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(name)?.trim();
  return value ? value.slice(0, 512) : undefined;
}

async function clientIpHash(request: Request): Promise<string | undefined> {
  const settings = await getRuntimeSettings().catch(() => null);
  const trustProxy = settings?.trustProxy || process.env.LFN_TRUST_PROXY === "true";
  const forwarded = trustProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const ip = forwarded || request.headers.get("x-real-ip")?.trim();
  return ip ? sha256(ip) : undefined;
}

export type RequestAuditContext = {
  requestId: string;
  requestFingerprint: string;
  startedAt: number;
  record: RequestAuditRecord;
  finish: (patch?: Partial<RequestAuditRecord>) => Promise<void>;
  responseHeaders: (headers?: HeadersInit) => Headers;
};

export async function startRequestAudit(input: {
  request: Request;
  source: "lfn" | "api";
  endpoint: string;
  userId?: number;
  username?: string;
  operation?: string;
  model?: string;
  parameters?: Record<string, unknown>;
}): Promise<RequestAuditContext> {
  const requestId = randomUUID();
  const parameters = (safeAuditValue(input.parameters || {}) || {}) as JsonRecord;
  const requestFingerprint = sha256(canonical({ endpoint: input.endpoint, operation: input.operation, model: input.model, parameters }));
  const startedAt = Date.now();
  const record: RequestAuditRecord = {
    requestId,
    requestFingerprint,
    createdAt: new Date(startedAt).toISOString(),
    source: input.source,
    endpoint: input.endpoint,
    operation: input.operation,
    model: input.model,
    userId: input.userId,
    username: input.username,
    clientIpHash: await clientIpHash(input.request),
    userAgent: headerValue(input.request, "user-agent"),
    referer: headerValue(input.request, "referer"),
    parameters,
    historyIds: [],
  };
  return {
    requestId,
    requestFingerprint,
    startedAt,
    record,
    finish: async (patch = {}) => {
      const completed = { ...record, ...patch, durationMs: Date.now() - startedAt };
      await withLock(async () => {
        const store = await readStore();
        const index = store.records.findIndex((item) => item.requestId === requestId);
        if (index >= 0) store.records[index] = completed;
        else store.records.unshift(completed);
        store.records = store.records.slice(0, MAX_RECORDS);
        await writeStore(store);
      });
    },
    responseHeaders: (init) => {
      const headers = new Headers(init);
      headers.set("X-LFN-Request-ID", requestId);
      headers.set("X-LFN-Request-Fingerprint", requestFingerprint);
      return headers;
    },
  };
}

export async function findRequestAudit(requestId: string): Promise<RequestAuditRecord | null> {
  if (!requestId) return null;
  return (await readStore()).records.find((item) => item.requestId === requestId) || null;
}

export async function listRequestAudits(limit = 100): Promise<RequestAuditRecord[]> {
  return (await readStore()).records.slice(0, Math.max(1, Math.min(limit, MAX_RECORDS)));
}

export async function requestUsageByUser(now = Date.now()): Promise<Map<number, RequestUsageSummary>> {
  const [records, usage] = await Promise.all([readStore(), readUsageStore()]);
  const cutoffs = [now - 5 * 60 * 60_000, now - 7 * 24 * 60 * 60_000, now - 30 * 24 * 60 * 60_000];
  const summaries = new Map<number, RequestUsageSummary>();
  const events = [
    ...records.records
      .filter((record) => record.userId)
      .map((record) => ({ userId: record.userId!, at: Date.parse(record.createdAt), requestId: record.requestId })),
    ...usage.events,
  ];
  const seen = new Set<string>();
  for (const event of events) {
    if (!Number.isInteger(event.userId) || !event.userId || !Number.isFinite(event.at)) continue;
    const key = event.requestId ? `${event.userId}:${event.requestId}` : `${event.userId}:${event.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = summaries.get(event.userId) || {
      userId: event.userId,
      requests5h: 0,
      requests7d: 0,
      requests30d: 0,
      retainedRecords: 0,
    };
    summary.retainedRecords += 1;
    if (event.at >= cutoffs[0]) summary.requests5h += 1;
    if (event.at >= cutoffs[1]) summary.requests7d += 1;
    if (event.at >= cutoffs[2]) summary.requests30d += 1;
    summaries.set(event.userId, summary);
  }
  return summaries;
}

export async function recordImageRequestUsage(userId: number, requestId?: string, now = Date.now()): Promise<RequestUsageSummary> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("用户 id 无效");
  return withLock(async () => {
    const store = await readUsageStore();
    const deduped = store.events.filter((event) => now - event.at < 30 * 24 * 60 * 60_000);
    if (!deduped.some((event) => event.userId === userId && requestId && event.requestId === requestId))
      deduped.push({ userId, at: now, requestId });
    store.events = deduped.slice(-MAX_USAGE_EVENTS);
    await writeUsageStore(store);
    const summaries = await requestUsageByUser(now);
    return summaries.get(userId) || { userId, requests5h: 0, requests7d: 0, requests30d: 0, retainedRecords: 0 };
  });
}
