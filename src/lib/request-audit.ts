import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimeSettings } from "@/lib/runtime-config";

type JsonRecord = Record<string, unknown>;

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
};

type AuditStore = { records: RequestAuditRecord[] };

const auditRoot = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "request-audit");
const auditPath = () => path.join(auditRoot(), "index.json");
const MAX_RECORDS = 5000;
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
