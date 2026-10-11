import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordImageRequestUsage } from "@/lib/request-audit";

export type RiskLevel = "normal" | "watch" | "risk" | "critical" | "banned";
export type RiskDecision = "allow" | "rate-limit" | "deny";

export type RiskSignal = {
  id: string;
  category:
    | "duplicate-prompt"
    | "high-frequency"
    | "prompt-extraction"
    | "relay-intent"
    | "automation-abuse"
    | "suspicious-chain"
    | "ip-overlap"
    | "failure-retry"
    | "client-anomaly";
  severity: number;
  description: string;
  evidence: Record<string, unknown>;
  createdAt: string;
};

export type RiskCase = {
  caseId: string;
  userId: number;
  username?: string;
  level: RiskLevel;
  score: number;
  status: "open" | "confirmed" | "false-positive" | "closed";
  signals: RiskSignal[];
  relatedUserIds: number[];
  relatedRequestIds: string[];
  promptClusterIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastRequestId?: string;
  policyVersion: string;
  enforcement?: RiskEnforcement;
};

export type RiskEnforcement = {
  blocked: boolean;
  blockedAt?: string;
  blockedBy?: string;
  blockReason?: string;
  blockScope?: "user" | "referral-chain";
  previousUpstreamStatus?: number;
  syncedUpstream?: boolean;
  syncError?: string;
};

export type PromptFingerprint = {
  promptFingerprint: string;
  promptShapeFingerprint: string;
  normalizedLength: number;
  preview?: string;
};

export type PromptCluster = {
  clusterId: string;
  fingerprint: string;
  shapeFingerprint?: string;
  normalizedLength?: number;
  safePreview?: string;
  requestCount: number;
  distinctUserCount: number;
  userIds: number[];
  modelNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  riskLevel: RiskLevel;
  requestIds: string[];
};

export type RiskPolicy = {
  enabled: boolean;
  duplicateWindowMs: number;
  duplicateMinRequests: number;
  duplicateMinUsers: number;
  sameUserWindowMs: number;
  sameUserMaxRequests: number;
  highVolume5hRequests: number;
  highVolume7dRequests: number;
  riskScore: number;
  criticalScore: number;
  referralRiskEnabled: boolean;
  referralMaxDepth: number;
  autoRateLimitCritical: boolean;
  policyVersion: string;
};

export type RiskEvaluationInput = {
  userId: number;
  username?: string;
  model?: string;
  prompt?: string;
  requestId?: string;
  now?: number;
};

export type RiskEvaluation = {
  decision: RiskDecision;
  level: RiskLevel;
  score: number;
  signalIds: string[];
  prompt?: PromptFingerprint;
  clusterId?: string;
  caseId?: string;
  usage?: { requests5h: number; requests7d: number; requests30d: number };
};

export type RiskAction = {
  actionId: string;
  action: "mark-risk" | "mark-false-positive" | "ban-user" | "ban-referral-chain" | "unban-user" | "unban-referral-chain" | "reveal-ip";
  operatorUserId?: number;
  operatorUsername?: string;
  targetUserId: number;
  scope?: "user" | "referral-chain";
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  affectedUserIds: number[];
  upstreamSync?: { attempted: boolean; succeeded: boolean; message?: string };
  createdAt: string;
};

type RiskStore = {
  cases: RiskCase[];
  events: RiskSignal[];
  promptClusters: PromptCluster[];
};

const MAX_CASES = 5000;
const MAX_EVENTS = 20_000;
const MAX_CLUSTERS = 5000;
const riskRoot = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "risk");
const riskPath = () => path.join(riskRoot(), "cases.json");
const eventPath = () => path.join(riskRoot(), "events.json");
const clusterPath = () => path.join(riskRoot(), "prompt-clusters.json");
const actionPath = () => path.join(riskRoot(), "actions.json");
let lock: Promise<unknown> = Promise.resolve();

const defaultPolicy: RiskPolicy = {
  enabled: true,
  duplicateWindowMs: 10 * 60_000,
  duplicateMinRequests: 5,
  duplicateMinUsers: 3,
  sameUserWindowMs: 10 * 60_000,
  sameUserMaxRequests: 8,
  highVolume5hRequests: 80,
  highVolume7dRequests: 500,
  riskScore: 60,
  criticalScore: 80,
  referralRiskEnabled: true,
  referralMaxDepth: 20,
  autoRateLimitCritical: false,
  policyVersion: "risk-v1",
};

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`风控数据读取失败：${path.basename(file)}`);
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(riskRoot(), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, file);
}

async function readStore(): Promise<RiskStore> {
  const [cases, events, promptClusters] = await Promise.all([
    readJson<RiskCase[]>(riskPath(), []),
    readJson<RiskSignal[]>(eventPath(), []),
    readJson<PromptCluster[]>(clusterPath(), []),
  ]);
  return {
    cases: Array.isArray(cases) ? cases : [],
    events: Array.isArray(events) ? events : [],
    promptClusters: Array.isArray(promptClusters) ? promptClusters : [],
  };
}

async function writeStore(store: RiskStore): Promise<void> {
  await Promise.all([
    writeJson(riskPath(), store.cases.slice(0, MAX_CASES)),
    writeJson(eventPath(), store.events.slice(0, MAX_EVENTS)),
    writeJson(clusterPath(), store.promptClusters.slice(0, MAX_CLUSTERS)),
  ]);
}

function hashSecret(): string | null {
  return process.env.LFN_RISK_HASH_SECRET?.trim() || null;
}

export function riskPolicy(): RiskPolicy {
  const secretConfigured = Boolean(hashSecret());
  return {
    ...defaultPolicy,
    enabled: secretConfigured && process.env.LFN_RISK_ENABLED !== "false",
  };
}

export function normalizePrompt(prompt: string): string {
  return prompt
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/data:[^\s]+/gi, "[data]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]")
    .replace(/\b\d{10,}\b/g, "[timestamp]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16_000);
}

function hmac(value: string): string {
  const secret = hashSecret();
  if (!secret) throw new Error("LFN_RISK_HASH_SECRET 未配置");
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function safePreview(value: string): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\b(sk-|bearer\s+)[^\s]+/gi, "[secret]")
    .replace(/\b(api[_-]?key|token|authorization)\s*[:=]\s*[^\s,]+/gi, "$1=[redacted]")
    .slice(0, 180);
}

export function fingerprintPrompt(prompt: string): PromptFingerprint | null {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return null;
  const shape = normalized
    .replace(/\b\d+(?:\.\d+)?\b/g, "[number]")
    .replace(/\[[^\]]+\]/g, "[value]");
  return {
    promptFingerprint: hmac(normalized),
    promptShapeFingerprint: hmac(shape),
    normalizedLength: normalized.length,
    preview: safePreview(normalized),
  };
}

function levelForScore(score: number, policy: RiskPolicy): RiskLevel {
  if (score >= policy.criticalScore) return "critical";
  if (score >= policy.riskScore) return "risk";
  if (score >= 40) return "watch";
  return "normal";
}

function signal(
  id: string,
  category: RiskSignal["category"],
  severity: number,
  description: string,
  evidence: Record<string, unknown>,
  now: number,
): RiskSignal {
  return { id, category, severity, description, evidence, createdAt: new Date(now).toISOString() };
}

function updateCase(
  store: RiskStore,
  input: RiskEvaluationInput,
  signals: RiskSignal[],
  score: number,
  requestId: string | undefined,
  now: number,
  policy: RiskPolicy,
): RiskCase {
  let item = store.cases.find((candidate) => candidate.userId === input.userId && candidate.status !== "closed");
  if (!item) {
    item = {
      caseId: randomUUID(),
      userId: input.userId,
      username: input.username,
      level: "normal",
      score: 0,
      status: "open",
      signals: [],
      relatedUserIds: [],
      relatedRequestIds: [],
      promptClusterIds: [],
      firstSeenAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      policyVersion: policy.policyVersion,
    };
    store.cases.unshift(item);
  }
  item.username = input.username || item.username;
  item.score = Math.min(100, item.score + signals.reduce((sum, current) => sum + current.severity, 0));
  item.level = item.enforcement?.blocked ? "banned" : levelForScore(item.score, policy);
  item.signals = [...signals, ...item.signals].slice(0, 100);
  item.lastSeenAt = new Date(now).toISOString();
  item.lastRequestId = requestId || item.lastRequestId;
  if (requestId && !item.relatedRequestIds.includes(requestId)) item.relatedRequestIds.unshift(requestId);
  return item;
}

export async function isRiskBlocked(userId: number): Promise<RiskCase | null> {
  const store = await readStore();
  return store.cases.find((item) => item.userId === userId && item.enforcement?.blocked) || null;
}

export async function evaluateImageRisk(input: RiskEvaluationInput): Promise<RiskEvaluation> {
  const policy = riskPolicy();
  const now = input.now ?? Date.now();
  const usage = await recordImageRequestUsage(input.userId, input.requestId, now);
  const usageSummary = {
    requests5h: usage.requests5h,
    requests7d: usage.requests7d,
    requests30d: usage.requests30d,
  };
  if (!policy.enabled) return { decision: "allow", level: "normal", score: 0, signalIds: [], usage: usageSummary };
  const prompt = input.prompt ? fingerprintPrompt(input.prompt) : null;
  return withLock(async () => {
    const store = await readStore();
    const blocked = store.cases.find((item) => item.userId === input.userId && item.enforcement?.blocked);
    if (blocked) return {
      decision: "deny",
      level: "banned",
      score: blocked.score,
      signalIds: blocked.signals.slice(0, 10).map((item) => item.id),
      prompt: prompt || undefined,
      caseId: blocked.caseId,
      usage: usageSummary,
    };
    const signals: RiskSignal[] = [];
    let clusterId: string | undefined;
    if (prompt) {
      let cluster = store.promptClusters.find((item) => item.fingerprint === prompt.promptFingerprint);
      if (!cluster) {
        cluster = {
          clusterId: randomUUID(),
          fingerprint: prompt.promptFingerprint,
          shapeFingerprint: prompt.promptShapeFingerprint,
          normalizedLength: prompt.normalizedLength,
          safePreview: prompt.preview,
          requestCount: 0,
          distinctUserCount: 0,
          userIds: [],
          modelNames: [],
          firstSeenAt: new Date(now).toISOString(),
          lastSeenAt: new Date(now).toISOString(),
          riskLevel: "normal",
          requestIds: [],
        };
        store.promptClusters.unshift(cluster);
      }
      cluster.requestCount += 1;
      if (!cluster.userIds.includes(input.userId)) cluster.userIds.push(input.userId);
      cluster.distinctUserCount = cluster.userIds.length;
      if (input.model && !cluster.modelNames.includes(input.model)) cluster.modelNames.push(input.model);
      cluster.lastSeenAt = new Date(now).toISOString();
      if (input.requestId) cluster.requestIds.unshift(input.requestId);
      cluster.requestIds = cluster.requestIds.slice(0, 100);
      clusterId = cluster.clusterId;
      const windowStart = now - policy.duplicateWindowMs;
      const recent = store.events.filter((event) => event.id === `prompt:${prompt.promptFingerprint}` && Date.parse(event.createdAt) >= windowStart);
      const distinctUsers = new Set(recent.flatMap((event) => Array.isArray(event.evidence.userIds) ? event.evidence.userIds as number[] : []));
      distinctUsers.add(input.userId);
      const recentRequestCount = recent.length + 1;
      if (recentRequestCount >= policy.duplicateMinRequests && distinctUsers.size >= policy.duplicateMinUsers) {
        signals.push(signal(`duplicate:${cluster.clusterId}`, "duplicate-prompt", 45, "多个账号在短时间内重复使用相同提示词", { clusterId: cluster.clusterId, requestCount: recentRequestCount, distinctUsers: distinctUsers.size }, now));
        cluster.riskLevel = "risk";
        for (const relatedUserId of distinctUsers) {
          if (relatedUserId === input.userId) continue;
          const relatedCase = store.cases.find((candidate) => candidate.userId === relatedUserId && candidate.status !== "closed");
          if (relatedCase) {
            relatedCase.score = Math.min(100, relatedCase.score + 45);
            relatedCase.level = levelForScore(relatedCase.score, policy);
            if (!relatedCase.relatedUserIds.includes(input.userId)) relatedCase.relatedUserIds.unshift(input.userId);
            if (!relatedCase.promptClusterIds.includes(cluster.clusterId)) relatedCase.promptClusterIds.unshift(cluster.clusterId);
          }
        }
      }
      store.events.unshift(signal(`prompt:${prompt.promptFingerprint}`, "duplicate-prompt", 0, "提示词聚类样本", { userId: input.userId, userIds: [input.userId], clusterId: cluster.clusterId }, now));
    }
    const recentUserEvents = store.events.filter((event) => event.evidence.userId === input.userId && Date.parse(event.createdAt) >= now - policy.sameUserWindowMs);
    if (recentUserEvents.length + 1 >= policy.sameUserMaxRequests && prompt)
      signals.push(signal(`frequency:${input.userId}`, "high-frequency", 25, "用户在短时间内重复请求图像", { requestCount: recentUserEvents.length + 1 }, now));
    const volumeThreshold = usage.requests5h >= policy.highVolume5hRequests
      ? policy.highVolume5hRequests
      : policy.highVolume7dRequests;
    const volumeWindowStart = now - (usage.requests5h >= policy.highVolume5hRequests ? 5 * 60 * 60_000 : 7 * 24 * 60 * 60_000);
    const existingVolumeSignal = store.events.find((event) =>
      event.id === `volume:${input.userId}:${volumeThreshold}` &&
      Date.parse(event.createdAt) >= volumeWindowStart,
    );
    const overVolumeLimit = usage.requests5h >= policy.highVolume5hRequests || usage.requests7d >= policy.highVolume7dRequests;
    if (!existingVolumeSignal && overVolumeLimit) {
      signals.push(signal(
        `volume:${input.userId}:${volumeThreshold}`,
        "high-frequency",
        25,
        "用户图像调用量超过风控窗口阈值",
        {
          requests5h: usage.requests5h,
          requests7d: usage.requests7d,
          requests30d: usage.requests30d,
          thresholds: {
            requests5h: policy.highVolume5hRequests,
            requests7d: policy.highVolume7dRequests,
          },
        },
        now,
      ));
    } else if (existingVolumeSignal) {
      existingVolumeSignal.evidence = {
        ...existingVolumeSignal.evidence,
        requests5h: usage.requests5h,
        requests7d: usage.requests7d,
        requests30d: usage.requests30d,
      };
    }
    const item = signals.length
      ? updateCase(store, input, signals, 0, input.requestId, now, policy)
      : undefined;
    for (const current of signals) store.events.unshift(current);
    if (item && clusterId && !item.promptClusterIds.includes(clusterId)) item.promptClusterIds.unshift(clusterId);
    await writeStore(store);
    const level = item?.level || "normal";
    const decision: RiskDecision = level === "critical" && policy.autoRateLimitCritical ? "rate-limit" : "allow";
    return { decision, level, score: item?.score || 0, signalIds: signals.map((current) => current.id), prompt: prompt || undefined, clusterId, caseId: item?.caseId, usage: usageSummary };
  });
}

export async function markRiskCase(userId: number, level: Exclude<RiskLevel, "banned" | "normal">, reason: string, operator?: string): Promise<RiskCase> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.cases.find((candidate) => candidate.userId === userId) || updateCase(store, { userId }, [], 0, undefined, Date.now(), riskPolicy());
    item.level = level;
    item.status = level === "risk" || level === "critical" ? "confirmed" : "open";
    item.signals.unshift(signal(`manual:${randomUUID()}`, "client-anomaly", level === "critical" ? 80 : 40, reason.slice(0, 500), { operator: operator || "admin" }, Date.now()));
    await writeStore(store);
    return item;
  });
}

export async function setRiskBlocked(userId: number, blocked: boolean, reason: string, operator?: string, scope: "user" | "referral-chain" = "user"): Promise<RiskCase> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.cases.find((candidate) => candidate.userId === userId) || updateCase(store, { userId }, [], 0, undefined, Date.now(), riskPolicy());
    item.enforcement = blocked ? { blocked: true, blockedAt: new Date().toISOString(), blockedBy: operator, blockReason: reason.slice(0, 500), blockScope: scope } : { blocked: false };
    item.level = blocked ? "banned" : levelForScore(item.score, riskPolicy());
    item.status = blocked ? "confirmed" : "open";
    await writeStore(store);
    return item;
  });
}

export async function recordRiskAction(action: Omit<RiskAction, "actionId" | "createdAt">): Promise<RiskAction> {
  return withLock(async () => {
    const actions = await readJson<RiskAction[]>(actionPath(), []);
    const item: RiskAction = { ...action, actionId: randomUUID(), createdAt: new Date().toISOString() };
    await writeJson(actionPath(), [item, ...(Array.isArray(actions) ? actions : [])].slice(0, 20_000));
    return item;
  });
}

export async function listRiskActions(limit = 100): Promise<RiskAction[]> {
  return (await readJson<RiskAction[]>(actionPath(), [])).slice(0, Math.max(1, Math.min(5000, limit)));
}

export async function listRiskCases(limit = 100): Promise<RiskCase[]> {
  return (await readStore()).cases.slice(0, Math.max(1, Math.min(5000, limit)));
}

export async function getRiskCase(caseId: string): Promise<RiskCase | null> {
  return (await readStore()).cases.find((item) => item.caseId === caseId) || null;
}

export async function getRiskCaseForUser(userId: number): Promise<RiskCase | null> {
  return (await readStore()).cases.find((item) => item.userId === userId) || null;
}

export async function listPromptClusters(limit = 100): Promise<PromptCluster[]> {
  return (await readStore()).promptClusters.slice(0, Math.max(1, Math.min(5000, limit)));
}

export function riskBlockedResponse(): Response {
  return new Response(JSON.stringify({ error: { code: "lfn_risk_blocked", message: "账号因风控策略暂时无法使用图像服务" } }), { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}