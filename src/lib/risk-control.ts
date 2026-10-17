import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { recordImageRequestUsage, requestCountInWindow } from "@/lib/request-audit";
import { evaluateLightRisk } from "@/lib/light-risk";
import { getRiskSettings } from "@/lib/risk-settings";

export type RiskLevel = "normal" | "watch" | "elevated" | "risk" | "critical" | "severe" | "isolated" | "banned";
export type RiskDecision = "allow" | "rate-limit" | "deny";
export type RiskRuleAction = "observe" | "rate-limit" | "deny";

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
  duplicateEnabled: boolean;
  duplicateAction: RiskRuleAction;
  duplicateWindowMs: number;
  duplicateMinRequests: number;
  duplicateMinUsers: number;
  duplicateScore: number;
  sameUserEnabled: boolean;
  sameUserAction: RiskRuleAction;
  sameUserWindowMs: number;
  sameUserMaxRequests: number;
  sameUserScore: number;
  highVolumeEnabled: boolean;
  highVolumeAction: RiskRuleAction;
  highVolume5hRequests: number;
  highVolume7dRequests: number;
  highVolumeScore: number;
  watchScore: number;
  riskScore: number;
  criticalScore: number;
  referralRiskEnabled: boolean;
  referralMaxDepth: number;
  autoRateLimitCritical: boolean;
  retryAfterSeconds: number;
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
  retryAfterSeconds?: number;
  reason?: string;
  usage?: { requests5h: number; requests7d: number; requests30d: number };
};

export type RiskAction = {
  actionId: string;
  action: "mark-risk" | "mark-false-positive" | "ban-user" | "ban-referral-chain" | "unban-user" | "unban-referral-chain" | "reveal-ip" | "policy-update";
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
const policyPath = () => path.join(riskRoot(), "policy.json");


const riskRuntime = globalThis as typeof globalThis & { __lfnLegacyRisk?: { lock: Promise<unknown>; policyCache: RiskPolicy | null; policyRoot: string; storeCache?: { root: string; pending: Promise<RiskStore> }; storeTimer?: ReturnType<typeof setTimeout>; resetCutoff?: { root: string; pending: Promise<number> } } };
const shared = (riskRuntime.__lfnLegacyRisk ??= { lock: Promise.resolve(), policyCache: null, policyRoot: "" });
const defaultPolicy: RiskPolicy = {
  enabled: true,
  duplicateEnabled: true,
  duplicateAction: "observe",
  duplicateWindowMs: 10 * 60_000,
  duplicateMinRequests: 5,
  duplicateMinUsers: 3,
  duplicateScore: 12,
  sameUserEnabled: true,
  sameUserAction: "observe",
  sameUserWindowMs: 10 * 60_000,
  sameUserMaxRequests: 8,
  sameUserScore: 5,
  highVolumeEnabled: true,
  highVolumeAction: "observe",
  highVolume5hRequests: 80,
  highVolume7dRequests: 500,
  highVolumeScore: 5,
  watchScore: 40,
  riskScore: 60,
  criticalScore: 80,
  referralRiskEnabled: true,
  referralMaxDepth: 20,
  autoRateLimitCritical: false,
  retryAfterSeconds: 300,
  policyVersion: "risk-v1",
};

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = shared.lock.then(task, task);
  shared.lock = current.catch(() => undefined);
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
  const root = riskRoot();
  if (shared.storeCache?.root !== root) {
    if (shared.storeTimer) { clearTimeout(shared.storeTimer); shared.storeTimer = undefined; }
    shared.storeCache = { root, pending: loadStore() };
  }
  return shared.storeCache.pending;
}

async function loadStore(): Promise<RiskStore> {
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
function scheduleObservationWrite(seconds: number) {
  if (shared.storeTimer) return;
  const root = riskRoot();
  shared.storeTimer = setTimeout(() => {
    shared.storeTimer = undefined;
    if (riskRoot() !== root) return;
    void withLock(async () => writeStore(await readStore())).catch(() => console.error("[lfn] risk observation batch write failed"));
  }, seconds * 1000);
  shared.storeTimer.unref?.();
}

function hashSecret(): string | null {
  return process.env.LFN_RISK_HASH_SECRET?.trim() || null;
}

function envPolicy(): Partial<RiskPolicy> {
  return {
    enabled: process.env.LFN_RISK_ENABLED !== "false",
  };
}

function normalizeRiskPolicy(raw?: Partial<RiskPolicy> | null): RiskPolicy {
  const source = { ...defaultPolicy, ...envPolicy(), ...(raw || {}) };
  const integer = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
    const number = Number(value);
    return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  };
  return {
    enabled: Boolean(source.enabled),
    duplicateEnabled: Boolean(source.duplicateEnabled),
    duplicateAction: "observe",
    duplicateWindowMs: integer(source.duplicateWindowMs, defaultPolicy.duplicateWindowMs, 10_000, 7 * 24 * 60 * 60_000),
    duplicateMinRequests: integer(source.duplicateMinRequests, defaultPolicy.duplicateMinRequests, 2, 100_000),
    duplicateMinUsers: integer(source.duplicateMinUsers, defaultPolicy.duplicateMinUsers, 2, 100_000),
    duplicateScore: integer(source.duplicateScore, defaultPolicy.duplicateScore, 0, 100),
    sameUserEnabled: Boolean(source.sameUserEnabled),
    sameUserAction: "observe",
    sameUserWindowMs: integer(source.sameUserWindowMs, defaultPolicy.sameUserWindowMs, 10_000, 7 * 24 * 60 * 60_000),
    sameUserMaxRequests: integer(source.sameUserMaxRequests, defaultPolicy.sameUserMaxRequests, 2, 100_000),
    sameUserScore: integer(source.sameUserScore, defaultPolicy.sameUserScore, 0, 100),
    highVolumeEnabled: Boolean(source.highVolumeEnabled),
    highVolumeAction: "observe",
    highVolume5hRequests: integer(source.highVolume5hRequests, defaultPolicy.highVolume5hRequests, 1, 1_000_000),
    highVolume7dRequests: integer(source.highVolume7dRequests, defaultPolicy.highVolume7dRequests, 1, 1_000_000),
    highVolumeScore: integer(source.highVolumeScore, defaultPolicy.highVolumeScore, 0, 100),
    watchScore: integer(source.watchScore, defaultPolicy.watchScore, 1, 100),
    riskScore: integer(source.riskScore, defaultPolicy.riskScore, 1, 100),
    criticalScore: integer(source.criticalScore, defaultPolicy.criticalScore, 1, 100),
    referralRiskEnabled: Boolean(source.referralRiskEnabled),
    referralMaxDepth: integer(source.referralMaxDepth, defaultPolicy.referralMaxDepth, 1, 100),
    autoRateLimitCritical: false,
    retryAfterSeconds: integer(source.retryAfterSeconds, defaultPolicy.retryAfterSeconds, 1, 86_400),
    policyVersion: typeof source.policyVersion === "string" && source.policyVersion.trim()
      ? source.policyVersion.trim().slice(0, 80)
      : defaultPolicy.policyVersion,
  };
}

export function riskPolicy(): RiskPolicy {
  const policy = normalizeRiskPolicy(shared.policyCache);
  return { ...policy };
}

export async function getRiskPolicy(): Promise<RiskPolicy> {
  if (!shared.policyCache || shared.policyRoot !== riskRoot()) { shared.policyCache = normalizeRiskPolicy(await readJson<Partial<RiskPolicy> | null>(policyPath(), null)); shared.policyRoot = riskRoot(); }
  return { ...shared.policyCache };
}

export async function updateRiskPolicy(patch: Partial<RiskPolicy>): Promise<RiskPolicy> {
  return withLock(async () => {
    const current = await getRiskPolicy();
    for (const [key, value] of Object.entries(patch)) {
      if (key === "policyVersion") continue;
      if (!(key in defaultPolicy)) throw new Error(`未知风控配置：${key}`);
      const fallback = defaultPolicy[key as keyof RiskPolicy];
      if (typeof fallback === "boolean" && typeof value !== "boolean") throw new Error(`${key} 必须为布尔值`);
      if (typeof fallback === "number" && (typeof value !== "number" || !Number.isSafeInteger(value))) throw new Error(`${key} 必须为整数`);
      if (key === "autoRateLimitCritical" && value === true) throw new Error("旧版自动处置已停用，请使用轻量风控配置");
      if (key.endsWith("Action") && value !== "observe") throw new Error(`${key} 动作无效`);
    }
    const next = normalizeRiskPolicy({ ...current, ...patch, policyVersion: `risk-${Date.now()}` });
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === "number" && next[key as keyof RiskPolicy] !== value) throw new Error(`${key} 超出允许范围`);
    }
    if (next.watchScore > next.riskScore || next.riskScore > next.criticalScore) throw new Error("分数线必须满足 Watch <= Risk <= Critical");
    await writeJson(policyPath(), next);
    shared.policyCache = next;
    return next;
  });
}

export function resetRiskPolicyCache(): void {
  shared.policyCache = null;
  shared.policyRoot = "";
}

export function normalizePrompt(prompt: string): string {
  return prompt.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function hmac(value: string): string {
  const secret = hashSecret();
  if (!secret) throw new Error("LFN_RISK_HASH_SECRET 未配置");
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
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
    // Raw prompt previews are intentionally not persisted.
  };
}

function levelForScore(score: number, policy: RiskPolicy): RiskLevel {
  if (score >= policy.criticalScore) return "critical";
  if (score >= policy.riskScore) return "risk";
  if (score >= policy.watchScore) return "watch";
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
  item.policyVersion = policy.policyVersion;
  if (requestId && !item.relatedRequestIds.includes(requestId)) item.relatedRequestIds.unshift(requestId);
  return item;
}

export async function isRiskBlocked(userId: number): Promise<RiskCase | null> {
  const store = await readStore();
  return store.cases.find((item) => item.userId === userId && item.enforcement?.blocked) || null;
}

export async function evaluateImageRisk(input: RiskEvaluationInput): Promise<RiskEvaluation> {
  const policy = await getRiskPolicy(), now = input.now ?? Date.now();
  const store = await readStore();
  const blocked = store.cases.find(c => c.userId === input.userId && c.enforcement?.blocked);
  if (blocked) return { decision: "deny", level: "banned", score: blocked.score, signalIds: [], caseId: blocked.caseId };
  const light = await evaluateLightRisk(input);
  if (!policy.enabled) return { ...light, signalIds: [], prompt: undefined };
  const usage = await recordImageRequestUsage(input.userId, input.requestId, now, { username: input.username, model: input.model });
  // Marks can be reset without deleting billing/audit history. An offline reset
  // restarts this process, so old usage must not immediately recreate old marks.
  if (shared.resetCutoff?.root !== riskRoot()) shared.resetCutoff = { root: riskRoot(), pending: readJson<{at?:string}>(path.join(riskRoot(), "marks-reset.json"), {}).then(v => { const at = Date.parse(v.at || ""); return Number.isFinite(at) ? at : 0; }) };
  const cutoff = Math.min(now, await shared.resetCutoff.pending);
  const observedWindow = (window: number) => cutoff ? Math.min(window, Math.max(0, now-cutoff)) : window;
  const [requests, requests5h, requests7d] = await Promise.all([
    requestCountInWindow(input.userId, observedWindow(policy.sameUserWindowMs), now),
    cutoff ? requestCountInWindow(input.userId, observedWindow(5*3600000), now) : Promise.resolve(usage.requests5h),
    cutoff ? requestCountInWindow(input.userId, observedWindow(7*86400000), now) : Promise.resolve(usage.requests7d),
  ]);
  const settings = await getRiskSettings(input.userId);
  const prompt = hashSecret() && input.prompt ? fingerprintPrompt(input.prompt) : null;
  return withLock(async () => {
    let item = store.cases.find(c => c.userId === input.userId && c.status !== "closed");
    const signals: RiskSignal[] = light.signals.map(e => signal(e.rule === "B02" ? `duplicate:${e.id}` : e.id, e.family === "content" ? "failure-retry" : e.family === "network" ? "ip-overlap" : e.family === "behavior" ? "duplicate-prompt" : "client-anomaly", e.points, settings.rules.find(r => r.id === e.rule)?.label || e.rule, { ...e.details, rule: e.rule, userId: input.userId }, e.at));
    const legacy = (id: string, active: boolean, _action: RiskRuleAction, points: number, windowMs: number, description: string) => {
      if (!active) return;
      if (!item?.signals.some(e => e.id === id && Date.parse(e.createdAt) >= now - windowMs)) signals.push(signal(id, "high-frequency", points, description, { userId: input.userId, requests }, now));
    };
    legacy(`frequency:${input.userId}`, policy.sameUserEnabled && requests >= policy.sameUserMaxRequests, policy.sameUserAction, policy.sameUserScore, policy.sameUserWindowMs, "同账号窗口请求数达到旧版资源条例阈值");
    const volume = requests5h >= policy.highVolume5hRequests || requests7d >= policy.highVolume7dRequests;
    legacy(`volume:${input.userId}:${policy.highVolume5hRequests}`, policy.highVolumeEnabled && volume, policy.highVolumeAction, policy.highVolumeScore, requests5h >= policy.highVolume5hRequests ? 5 * 3600000 : 7 * 86400000, "同账号累计调用量达到旧版资源条例阈值");

    if (signals.length) {
      item = updateCase(store, input, signals, 0, input.requestId, now, policy);
      item.score = Math.min(Number(settings.values["global.scoreCap"]), light.score + item.signals.filter(e => /^(frequency|volume):/.test(e.id) && now - Date.parse(e.createdAt) < 86400000).reduce((n,e) => n + e.severity * 2 ** (-(now - Date.parse(e.createdAt))/86400000), 0));
      item.level = [...settings.levels].reverse().find(l => item!.score >= l.minimum)!.id;
      store.events.unshift(...signals); store.events = store.events.slice(0, MAX_EVENTS);
      scheduleObservationWrite(Number(settings.values["audit.flushSeconds"]));
    }
    // Legacy prompt/volume heuristics are observational. Resource admission is
    // enforced by the bounded token bucket; heuristics cannot create a long ban.
    const decision = light.decision;
    return { decision, level: signals.length && item ? item.level : light.level, score: item?.score || light.score, signalIds: signals.map(e => e.id), prompt: prompt || undefined, caseId: item?.caseId, usage: { requests5h: usage.requests5h, requests7d: usage.requests7d, requests30d: usage.requests30d }, retryAfterSeconds: light.retryAfterSeconds, reason: light.reason };
  });
}

export async function markRiskCase(userId: number, level: Exclude<RiskLevel, "banned" | "normal">, reason: string, operator?: string): Promise<RiskCase> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.cases.find((candidate) => candidate.userId === userId) || updateCase(store, { userId }, [], 0, undefined, Date.now(), await getRiskPolicy());
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
    const policy = await getRiskPolicy();
    const item = store.cases.find((candidate) => candidate.userId === userId) || updateCase(store, { userId }, [], 0, undefined, Date.now(), policy);
    item.enforcement = blocked ? { blocked: true, blockedAt: new Date().toISOString(), blockedBy: operator, blockReason: reason.slice(0, 500), blockScope: scope } : { blocked: false };
    item.level = blocked ? "banned" : levelForScore(item.score, policy);
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

export function riskBlockedResponse(evaluation?: RiskEvaluation): NextResponse {
  return NextResponse.json({ error: { code: "lfn_risk_blocked", message: evaluation?.reason || "账号因风控策略暂时无法使用图像服务", ...(evaluation?.retryAfterSeconds ? { retryAt: new Date(Date.now() + evaluation.retryAfterSeconds * 1000).toISOString() } : {}) } }, { status: 403, headers: { "Cache-Control": "no-store", ...(evaluation?.retryAfterSeconds ? { "Retry-After": String(evaluation.retryAfterSeconds) } : {}) } });
}

export async function riskRateLimitedResponse(evaluation?: RiskEvaluation): Promise<NextResponse> {
  return NextResponse.json({ error: { code: "lfn_risk_rate_limited", message: evaluation?.reason || "账号触发风控限流，请稍后重试" } }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(evaluation?.retryAfterSeconds || (await getRiskPolicy()).retryAfterSeconds) } });
}

export async function riskCasesForUsers(userIds: number[]): Promise<Map<number, RiskCase>> {
  const ids = new Set(userIds);
  return new Map((await readStore()).cases.filter((item) => ids.has(item.userId) && item.status !== "closed").map((item) => [item.userId, item]));
}
