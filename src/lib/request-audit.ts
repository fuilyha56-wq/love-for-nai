import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, appendFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getRuntimeSettings } from "@/lib/runtime-config";
import { RequestUsageIndex } from "@/lib/request-usage-index";
import { registerRiskRequest, finishLightRisk, releaseRiskContext } from "@/lib/light-risk";
import { getRiskSettings } from "@/lib/risk-settings";
import { maintainRiskStorage } from "@/lib/risk-maintenance";
import { resolveClientIp } from "@/lib/risk-ip";
import { naiUsageModel } from "@/lib/nai-native-request";
import { estimatePoints, type ImagePricingGeneration } from "@/lib/image-pricing";
import { userDisplayNames } from "@/lib/user-display";
import { settleDailyImageUsage } from "@/lib/daily-image-billing";

type JsonRecord = Record<string, unknown>;

export type RequestAuditRisk = {
  score: number;
  level: "normal" | "watch" | "elevated" | "risk" | "critical" | "severe" | "isolated" | "banned";
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
  estimatedAnlasCost?: number;
};

export type RequestUsageSummary = {
  userId: number;
  requests5h: number;
  requests7d: number;
  requests30d: number;
  retainedRecords: number;
};

export type RequestRankingMetric = "calls" | "anlas";

export type RequestRankings = {
  days: number;
  metric: RequestRankingMetric;
  totalCalls: number;
  totalAnlas: number;
  totalEstimatedAnlas: number;
  unreportedRecords: number;
  anlasRecords: number;
  totalUsers: number;
  from: string;
  to: string;
  bucket: "hour" | "day";
  retainedLimit: number;
  users: Array<{
    userId?: number;
    username: string;
    calls: number;
    anlas: number;
    lastAt: string;
    anlasRecords: number;
    estimatedAnlas: number;
    unreportedRecords: number;
    breakdown: Record<string, { calls: number; anlas: number }>;
  }>;
  times: Array<{
    bucket: string;
    label: string;
    calls: number;
    anlas: number;
    breakdown: Record<string, { calls: number; anlas: number }>;
  }>;
  models: Array<{
    name: string;
    calls: number;
    anlas: number;
    anlasRecords: number;
    estimatedAnlas: number;
    unreportedRecords: number;
  }>;
};

export type RequestAuditRecord = {
  generatedSamples?: number;
  moderation?: "denied" | "passed";
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
type UsageEvent = { userId: number; at: number; requestId?: string; username?: string; model?: string; source?: "lfn" | "api"; anlas?: number; estimatedAnlas?: number };
type UsageStore = { events: UsageEvent[] };

const auditRoot = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "request-audit");
const MAX_RECORDS = 5000;
const MAX_USAGE_EVENTS = 100_000;
const auditLocks = globalThis as typeof globalThis & { __lfnAuditLock?: Promise<unknown> };

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = (auditLocks.__lfnAuditLock || Promise.resolve()).then(task, task);
  auditLocks.__lfnAuditLock = current.catch(() => undefined);
  return current;
}

type JournalEntry = { type: "audit"; record: RequestAuditRecord } | { type: "usage"; event: UsageEvent };
type AuditRuntime = { root: string; loaded: Promise<void>; store: AuditStore; usage: UsageStore; index: RequestUsageIndex; pending: Map<string, JournalEntry>; timer?: ReturnType<typeof setTimeout>; writing: Promise<unknown>; bytes: number; journal: string; dropped: number; usageKeys: Map<string, UsageEvent> };
const shared = globalThis as typeof globalThis & { __lfnAuditRuntime?: AuditRuntime };
async function auditState(): Promise<AuditRuntime> {
  const root = auditRoot();
  if (shared.__lfnAuditRuntime?.root !== root) {
    if (shared.__lfnAuditRuntime?.timer) clearTimeout(shared.__lfnAuditRuntime.timer);
    const rt: AuditRuntime = { root, loaded: Promise.resolve(), store: { records: [] }, usage: { events: [] }, index: new RequestUsageIndex(MAX_USAGE_EVENTS), pending: new Map(), writing: Promise.resolve(), bytes: 0, journal: `${Date.now()}-${randomUUID()}.jsonl`, dropped: 0, usageKeys: new Map() };
    rt.loaded = (async () => {
      const optional = async (file: string) => { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } };
      const [oldAudit, oldUsage] = await Promise.all([optional(path.join(root, "index.json")), optional(path.join(root, "usage.json"))]);
      const records = new Map<string, RequestAuditRecord>((oldAudit?.records || []).map((r: RequestAuditRecord) => [r.requestId, r]));
      for (const event of oldUsage?.events || []) rt.usageKeys.set(`${event.userId}:${event.requestId || event.at}`, event);
      let files: string[] = [];
      try { files = (await readdir(path.join(root, "journal"))).filter(f => /^\d+-[\da-f-]+\.jsonl$/.test(f)).sort().slice(-32); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      for (const file of files) {
        const lines = (await readFile(path.join(root, "journal", file), "utf8")).split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue;
          let entry: JournalEntry;
          try { entry = JSON.parse(lines[i]); } catch { if (i === lines.length - 1) continue; throw new Error("审计日志中存在无效记录"); }
          if (entry.type === "audit") { records.delete(entry.record.requestId); records.set(entry.record.requestId, entry.record); }
          else if (entry.type === "usage") rt.usageKeys.set(`${entry.event.userId}:${entry.event.requestId || entry.event.at}`, entry.event);
        }
      }
      rt.store.records = [...records.values()].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_RECORDS);
      rt.usage.events = [...rt.usageKeys.values()].filter(e => e.at > Date.now() - 30 * 86400000).slice(-MAX_USAGE_EVENTS);
      rt.usageKeys = new Map(rt.usage.events.map(e => [`${e.userId}:${e.requestId || e.at}`, e]));
      for (const e of rt.usage.events) rt.index.add(e.userId, e.at, e.requestId);
      for (const r of rt.store.records) if (r.userId) rt.index.add(r.userId, Date.parse(r.createdAt), r.requestId);
    })();
    shared.__lfnAuditRuntime = rt;
  }
  await shared.__lfnAuditRuntime.loaded;
  return shared.__lfnAuditRuntime;
}
async function readStore(): Promise<AuditStore> { return (await auditState()).store; }
async function readUsageStore(): Promise<UsageStore> { return (await auditState()).usage; }
async function enqueueAudit(entry: JournalEntry) {
  const rt = await auditState(), settings = await getRiskSettings();
  const key = entry.type === "audit" ? `audit:${entry.record.requestId}` : `usage:${entry.event.userId}:${entry.event.requestId || entry.event.at}`;
  if (rt.pending.size >= Number(settings.values["audit.queueLimit"]) && !rt.pending.has(key)) { rt.dropped++; return; }
  rt.pending.set(key, entry);
  if (rt.pending.size >= Number(settings.values["audit.batch"])) await flushAuditRuntime(rt).catch(() => console.error("[lfn] audit diagnostic batch write failed"));
  else if (!rt.timer) { rt.timer = setTimeout(() => { rt.timer = undefined; void flushAuditRuntime(rt).catch(() => console.error("[lfn] audit diagnostic batch write failed")); }, Number(settings.values["audit.flushSeconds"]) * 1000); rt.timer.unref?.(); }
}
async function flushAuditRuntime(rt: AuditRuntime) {
  if (!rt.pending.size) return rt.writing;
  const batch = [...rt.pending.values()]; rt.pending.clear();
  const task = rt.writing.catch(() => undefined).then(async () => {
    const serialized = batch.map(e => JSON.stringify(e)).join("\n") + "\n";
    if (rt.bytes >= 5 * 1024 * 1024) { rt.journal = `${Date.now()}-${randomUUID()}.jsonl`; rt.bytes = 0; }
    await mkdir(path.join(rt.root, "journal"), { recursive: true });
    await appendFile(path.join(rt.root, "journal", rt.journal), serialized, "utf8"); rt.bytes += Buffer.byteLength(serialized);
    void maintainRiskStorage().catch(() => console.error("[lfn] risk diagnostic retention cleanup failed"));
  });
  rt.writing = task;
  await task;
}
export async function flushRequestAudits() { const rt = await auditState(); if (rt.timer) { clearTimeout(rt.timer); rt.timer = undefined; } await flushAuditRuntime(rt); }
async function saveUsageEvent(event: UsageEvent) {
  const rt = await auditState(), key = `${event.userId}:${event.requestId || event.at}`, previous = rt.usageKeys.get(key);
  if (previous) Object.assign(previous, event);
  else { rt.usage.events.push(event); rt.usageKeys.set(key, event); rt.index.add(event.userId, event.at, event.requestId); }
  if (rt.usage.events.length > MAX_USAGE_EVENTS + 1000) { rt.usage.events = rt.usage.events.slice(-MAX_USAGE_EVENTS); rt.usageKeys = new Map(rt.usage.events.map(e => [`${e.userId}:${e.requestId || e.at}`, e])); }
  await enqueueAudit({ type: "usage", event: previous || event });
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
  if (isSensitiveKey(key) || /^(?:prompt|negative_prompt|negativePrompt|input|text)$/i.test(key)) return "[redacted]";
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
  if (name === "referer" && value) { try { const url = new URL(value); return `${url.origin}${url.pathname}`.slice(0, 512); } catch { return undefined; } }
  return value ? value.slice(0, 512) : undefined;
}

async function clientIpHash(request: Request): Promise<string | undefined> {
  const settings = await getRuntimeSettings().catch(() => null);
  const trustProxy = settings?.trustProxy || process.env.LFN_TRUST_PROXY === "true";
  const ip = trustProxy ? resolveClientIp(request, true).ip : null;
  const secret = process.env.LFN_RISK_HASH_SECRET || process.env.LFN_SESSION_SECRET;
  return ip && secret ? createHmac("sha256", secret).update(`audit-ip:${ip}`).digest("hex") : undefined;
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
  const riskContext = await registerRiskRequest(requestId, input.request, input.userId);
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
      // Error text can echo a provider's prompt or a signed URL. Retain a stable
      // category and HTTP/moderation results rather than copying that text to disk.
      const completed = { ...record, ...patch, ...(patch.error ? { error: "request_failed" } : {}), durationMs: Date.now() - startedAt };
      await withLock(async () => {
        const store = await readStore();
        const index = store.records.findIndex((item) => item.requestId === requestId);
        if (index >= 0) store.records[index] = completed;
        else store.records.unshift(completed);
        store.records = store.records.slice(0, MAX_RECORDS);
        await enqueueAudit({ type: "audit", record: completed });
        if (completed.userId) {
          const details = { userId: completed.userId, at: Date.parse(completed.createdAt), requestId, username: completed.username, model: completed.model, source: completed.source,
            ...(completed.billing?.gatewayAnlasCost != null ? { anlas: completed.billing.gatewayAnlasCost } : {}), ...(estimateAuditAnlas(completed) != null ? { estimatedAnlas: estimateAuditAnlas(completed) } : {}) };
          await saveUsageEvent(details);
        }
      });
      if (completed.userId && completed.status !== undefined) {
        await finishLightRisk({ userId: completed.userId, requestId, acceptedAt: startedAt, status: completed.status, cost: completed.billing?.lfnChargedAff, moderation: completed.moderation });
        const generation = auditGeneration(completed);
        const successful = completed.status >= 200 && completed.status < 300 && !/custom|personal-key|provider/.test(completed.paymentSource || "");
        await settleDailyImageUsage(completed.userId, requestId, generation, successful ? completed.generatedSamples ?? (completed.historyIds.length || generation?.samples || 0) : 0, Date.parse(completed.createdAt));
      }
      if (completed.status !== undefined) releaseRiskContext(requestId);
    },
    responseHeaders: (init) => {
      const headers = new Headers(init);
      riskContext.apply(headers);
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

function auditGeneration(record: RequestAuditRecord): ImagePricingGeneration | null {
  if (!record.model || !/^nai-|^nai-diffusion/.test(record.model)) return null;
  const params = record.parameters;
  const source = params.parameters && typeof params.parameters === "object" ? params.parameters as JsonRecord : params;
  const size = typeof source.size === "string" ? source.size.match(/^(\d+)[x×](\d+)$/) : null;
  const generation: ImagePricingGeneration = { model: naiUsageModel(record.model), width: Number(source.width || size?.[1]), height: Number(source.height || size?.[2]), steps: Number(source.steps || 28), samples: Number(source.n ?? source.n_samples ?? source.samples ?? 1), operation: record.operation || "generate", strength: typeof source.strength === "number" ? source.strength : undefined, referenceImageCount: Number(source.referenceImageCount || 0), hasInputImage: Boolean(source.hasInputImage || source.image) };
  if (![generation.width, generation.height, generation.steps, generation.samples].every((value) => Number.isSafeInteger(value) && value > 0)) return null;
  return generation;
}
function estimateAuditAnlas(record: RequestAuditRecord): number | undefined {
  if (record.billing?.estimatedAnlasCost != null) return record.billing.estimatedAnlasCost;
  if (!record.status || record.status < 200 || record.status >= 300) return undefined;
  const generation = auditGeneration(record);
  return generation ? estimatePoints(generation) : undefined;
}

export async function requestRankings(
  days = 7,
  metric: RequestRankingMetric = "calls",
  now = Date.now(),
  filter: { keyword?: string; source?: "lfn" | "api"; userId?: number; bucket?: "hour" | "day" } = {},
): Promise<RequestRankings> {
  const normalizedDays = Math.min(30, Math.max(1, Math.floor(Number(days) || 7)));
  const normalizedMetric: RequestRankingMetric = metric === "anlas" ? "anlas" : "calls";
  const cutoff = now - normalizedDays * 24 * 60 * 60_000;
  const [audit, usage] = await Promise.all([readStore(), readUsageStore()]);
  const merged = new Map<string, { userId?: number; username?: string; model?: string; at: number; source?: "lfn" | "api"; anlas?: number; estimatedAnlas?: number }>();
  for (const event of usage.events) if (event.at >= cutoff && event.at <= now) merged.set(event.requestId || `${event.userId}:${event.at}`, event);
  for (const record of audit.records) {
    const existing = merged.get(record.requestId);
    merged.set(record.requestId, {
      ...existing,
      userId: record.userId ?? existing?.userId,
      username: record.username || existing?.username,
      model: record.model || record.endpoint || existing?.model,
      at: Date.parse(record.createdAt),
      source: record.source || existing?.source,
      anlas: record.billing?.gatewayAnlasCost ?? existing?.anlas,
      estimatedAnlas: estimateAuditAnlas(record) ?? existing?.estimatedAnlas,
    });
  }
  const keyword = filter.keyword?.trim().toLowerCase() || "";
  const candidates = [...merged.values()].filter((record) => Number.isFinite(record.at) && record.at >= cutoff && record.at <= now &&
    (!filter.userId || record.userId === filter.userId) && (!filter.source || record.source === filter.source));
  const identities = await userDisplayNames(candidates.filter((record) => record.userId && !record.username).map((record) => record.userId!)).catch(() => new Map());
  const records = candidates.filter((record) => !keyword || `${record.userId || ""} ${record.username || identities.get(record.userId || 0)?.name || ""} ${naiUsageModel(record.model || "")}`.toLowerCase().includes(keyword));
  const userMap = new Map<string, RequestRankings["users"][number]>();
  const timeMap = new Map<string, RequestRankings["times"][number]>();
  const modelMap = new Map<string, RequestRankings["models"][number]>();
  const bucketSize = (filter.bucket || (normalizedDays > 7 ? "day" : "hour")) === "day" ? 86_400_000 : 3_600_000;
  const bucketAt = (at: number) => Math.floor((at + 28_800_000) / bucketSize) * bucketSize - 28_800_000;
  for (let at = bucketAt(cutoff); at <= now; at += bucketSize) {
    const date = new Date(at + 28_800_000);
    const label = `${date.getUTCMonth() + 1}/${date.getUTCDate()}${bucketSize === 3_600_000 ? ` ${String(date.getUTCHours()).padStart(2, "0")}:00` : ""}`;
    const bucket = new Date(at).toISOString();
    timeMap.set(bucket, { bucket, label, calls: 0, anlas: 0, breakdown: {} });
  }
  let totalAnlas = 0;
  let anlasRecords = 0;
  let totalEstimatedAnlas = 0;
  let unreportedRecords = 0;
  for (const record of records) {
    const knownAnlas = typeof record.anlas === "number" && Number.isFinite(record.anlas) && record.anlas >= 0;
    const safeAnlas = knownAnlas ? record.anlas! : 0;
    const estimated = !knownAnlas && typeof record.estimatedAnlas === "number" && Number.isFinite(record.estimatedAnlas) ? record.estimatedAnlas : 0;
    if (!knownAnlas && record.estimatedAnlas == null) unreportedRecords += 1;
    totalEstimatedAnlas += estimated;
    const modelName = naiUsageModel(record.model || "其他端点");
    if (knownAnlas) anlasRecords += 1;
    totalAnlas += safeAnlas;
    const userKey = record.userId ? String(record.userId) : "anonymous";
    const user: RequestRankings["users"][number] = userMap.get(userKey) || {
      ...(record.userId ? { userId: record.userId } : {}),
      username: record.username || identities.get(record.userId || 0)?.name || (record.userId ? `账号 #${record.userId}` : "外部请求（未关联账号）"),
      calls: 0,
      anlas: 0,
      lastAt: new Date(record.at).toISOString(),
      anlasRecords: 0,
      estimatedAnlas: 0,
      unreportedRecords: 0,
      breakdown: {},
    };
    user.calls += 1;
    user.anlas += safeAnlas;
    user.estimatedAnlas += estimated;
    if (!knownAnlas && record.estimatedAnlas == null) user.unreportedRecords += 1;
    const userDetail = user.breakdown[modelName] || { calls: 0, anlas: 0 };
    userDetail.calls += 1; userDetail.anlas += safeAnlas; user.breakdown[modelName] = userDetail;
    if (knownAnlas) user.anlasRecords += 1;
    if (record.at > Date.parse(user.lastAt)) user.lastAt = new Date(record.at).toISOString();
    userMap.set(userKey, user);

    const bucket = new Date(bucketAt(record.at)).toISOString();
    const time = timeMap.get(bucket)!;
    time.calls += 1;
    time.anlas += safeAnlas;
    timeMap.set(bucket, time);

    const detail = time.breakdown[modelName] || { calls: 0, anlas: 0 };
    detail.calls += 1;
    detail.anlas += safeAnlas;
    time.breakdown[modelName] = detail;
    const model = modelMap.get(modelName) || { name: modelName, calls: 0, anlas: 0, anlasRecords: 0, estimatedAnlas: 0, unreportedRecords: 0 };
    model.calls += 1;
    model.anlas += safeAnlas;
    model.estimatedAnlas += estimated;
    if (!knownAnlas && record.estimatedAnlas == null) model.unreportedRecords += 1;
    if (knownAnlas) model.anlasRecords += 1;
    modelMap.set(modelName, model);
  }
  const order = (left: { calls: number; anlas: number }, right: { calls: number; anlas: number }) =>
    (normalizedMetric === "anlas" ? right.anlas - left.anlas : right.calls - left.calls) || right.calls - left.calls;
  return {
    days: normalizedDays,
    metric: normalizedMetric,
    totalCalls: records.length,
    totalAnlas,
    totalEstimatedAnlas,
    unreportedRecords,
    anlasRecords,
    totalUsers: userMap.size,
    from: new Date(cutoff).toISOString(),
    to: new Date(now).toISOString(),
    bucket: bucketSize === 3_600_000 ? "hour" : "day",
    retainedLimit: MAX_USAGE_EVENTS,
    users: [...userMap.values()].sort(order).slice(0, 50),
    times: [...timeMap.values()].sort((left, right) => left.bucket.localeCompare(right.bucket)),
    models: [...modelMap.values()].sort(order).slice(0, 50),
  };
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

export async function recordImageRequestUsage(userId: number, requestId?: string, now = Date.now(), details: { username?: string; model?: string; source?: "lfn" | "api"; anlas?: number } = {}): Promise<RequestUsageSummary> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("用户 id 无效");
  return withLock(async () => {
    const rt = await auditState();
    const key = `${userId}:${requestId || now}`;
    if (!rt.usageKeys.has(key)) await saveUsageEvent({ userId, at: now, requestId, ...details });
    return rt.index.summary(userId, now);
  });
}

export async function requestCountInWindow(userId: number, windowMs: number, now = Date.now()): Promise<number> {
  return (await auditState()).index.count(userId, windowMs, now);
}
