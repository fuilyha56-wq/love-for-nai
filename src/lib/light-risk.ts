import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTrustedClientIp, cachedIpGeo, type IpGeoSnapshot } from "./risk-ip";
import { getRiskSettings, riskFlag as flag, riskNumber as num, writeRiskJson, type RiskSettings, type RiskGradeId, type RiskRuleConfig } from "./risk-settings";
import { dailyImageDay } from "./daily-image-pricing";

export class RiskAdmissionError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 403, public readonly retryAfter = 0) { super(message); this.name = "RiskAdmissionError"; }
}
export function riskAdmissionResponse(error: unknown): Response | undefined {
  if (!(error instanceof RiskAdmissionError)) return;
  return Response.json({ message: error.message, error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
}
export async function moderationFromUpstream(payload: unknown): Promise<"denied" | "passed" | undefined> {
  if (!payload || typeof payload !== "object") return;
  const value = payload as { error?: { code?: unknown }; moderation?: { code?: unknown } };
  const code = value.error?.code ?? value.moderation?.code;
  if (typeof code !== "string") return;
  const s = await getRiskSettings();
  if (String(s.values["content.denyCodes"]).split(",").map(s => s.trim()).includes(code)) return "denied";
  if (String(s.values["content.passCodes"]).split(",").map(s => s.trim()).filter(Boolean).includes(code)) return "passed";
}
export function queuedRiskHeaders(requestId: string, initial?: HeadersInit): Headers {
  const headers = new Headers(initial); headers.set("x-lfn-internal-operation", requestId); return headers;
}
export async function recheckQueuedRisk(requestId: string) {
  const context = state().contexts.get(requestId);
  if (!context?.userId) return;
  const settings = await getRiskSettings(context.userId), a = await account(context.userId, settings, Date.now());
  if (a.restrictions.some(r => r.expiresAt > Date.now()) || await import("./risk-control").then(m => m.isRiskBlocked(context.userId!))) throw new RiskAdmissionError("排队期间账号生成权限发生变化，请查看账号安全状态", "lfn_queued_risk_denied");
}
type Evidence = { id: string; rule: string; family: string; points: number; strong: boolean; at: number; expires: number; details: Record<string, unknown> };
type Restriction = { id: string; rule: string; action: "deny" | "rate-limit"; startsAt: number; expiresAt: number; reason: string };
type Outcome = { requestId: string; at: number; acceptedAt: number; kind: "denied" | "passed" | "other"; cost: number; feedbackAt?: number };
type Account = {
  userId: number; at: number; tokens: number; tokenAt: number; inFlight: Map<string, number>; seen: Map<string, number>;
  prompts: Array<{ hash: string; at: number }>; devices: Array<{ id: string; at: number }>; switches: number[]; ips: Array<{ hash: string; at: number }>;
  evidence: Evidence[]; restrictions: Restriction[]; applied: Record<string, number>; outcomes: Outcome[]; firstFeedback?: number; retries: Map<number, number>;
  baseline: Record<string, { calls: number[]; cost: number; costs?: number[]; settlements: number }>; lastSaved: number;
  observedSince: number;
};
type Context = { userId?: number; request: Request; at: number; device?: string; newDevice?: boolean; cookie?: string; ip?: string; result?: LightEvaluation };
export type LightEvaluation = { decision: "allow" | "rate-limit" | "deny"; level: RiskGradeId; score: number; signalIds: string[]; signals: Evidence[]; retryAfterSeconds?: number; reason?: string; caseId?: string; policyVersion: string };
type Grant = { day: string; userId: number; id: string; ips: string[]; version: number; rebinds: number; changedAt: number; expiresAt: number };
type Runtime = { root: string; accounts: Map<number, Promise<Account>>; contexts: Map<string, Context>; clusters: Map<string, { at: number; count: number; users: Set<number> }>; devices: Map<string, Map<number, number>>; grants: Map<string, Promise<Grant | null>>; writes: Map<number, Promise<unknown>>; lastCleanup: number };
const shared = globalThis as typeof globalThis & { __lfnLightRisk?: Runtime; __lfnGrantLocks?: Map<string, Promise<unknown>> };
function state(): Runtime {
  const root = path.resolve(process.env.LFN_DATA_DIR || "data", "risk", "light");
  let runtime = shared.__lfnLightRisk;
  if (!runtime || runtime.root !== root) runtime = { root, accounts: new Map(), contexts: new Map(), clusters: new Map(), devices: new Map(), grants: new Map(), writes: new Map(), lastCleanup: 0 };
  shared.__lfnLightRisk = runtime;
  return runtime;
}
const secret = () => process.env.LFN_RISK_HASH_SECRET?.trim() || process.env.LFN_SESSION_SECRET?.trim();
function digest(value: string) { const key = secret(); return key ? createHmac("sha256", key).update(value).digest("hex") : undefined; }
function signDevice(id: string) { return `${id}.${digest(`device:${id}`)}`; }
function verifiedDevice(raw: string): string | undefined {
  if (!secret() || !/^[\da-f]{32}\.[\da-f]{64}$/.test(raw)) return;
  const expected = signDevice(raw.slice(0, 32));
  return timingSafeEqual(Buffer.from(raw), Buffer.from(expected)) ? raw.slice(0, 32) : undefined;
}
export async function registerRiskRequest(requestId: string, request: Request, userId?: number): Promise<{ apply: (headers: Headers) => void }> {
  const rt = state();
  const settings = await getRiskSettings(userId);
  cleanup(settings, Date.now());
  if (rt.contexts.size >= 10000) throw new RiskAdmissionError("请求准入容量暂满，请稍后重试", "lfn_risk_capacity", 503, 30);
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)lfn_device=([^;]+)/)?.[1] || "";
  const existing = verifiedDevice(cookie);
  const device = flag(settings, "device.enabled") ? existing || (secret() ? randomBytes(16).toString("hex") : undefined) : undefined;
  const ip = (await resolveTrustedClientIp(request)).ip;
  const context: Context = { userId, request, at: Date.now(), device, ip: ip ? digest(`ip:${ip}`) : undefined, ...(!existing && device ? { cookie: signDevice(device) } : {}) };
  // Do not retain request bodies/streams in this bounded registry.
  context.request = new Request(request.url, { headers: request.headers });
  rt.contexts.set(requestId, context);
  return { apply: (headers) => {
    if (context.cookie) headers.append("Set-Cookie", `lfn_device=${context.cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${num(settings, "device.ttlDays") * 86400}${process.env.LFN_COOKIE_SECURE === "true" ? "; Secure" : ""}`);
  } };
}
async function readOptional<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function account(userId: number, settings: RiskSettings, now: number): Promise<Account> {
  const rt = state();
  let pending = rt.accounts.get(userId);
  if (!pending) {
    if (rt.accounts.size >= num(settings, "capacity.accounts")) throw new RiskAdmissionError("风控容量暂满，请稍后重试", "lfn_risk_capacity", 503, 30);
    pending = readOptional<{ evidence?: Evidence[]; restrictions?: Restriction[]; applied?: Record<string, number>; baseline?: Account["baseline"]; observedSince?: number }>(path.join(rt.root, `user-${userId}.json`)).then(saved => ({ userId, at: now, tokens: num(settings, "rate.burst"), tokenAt: now, inFlight: new Map(), seen: new Map(), prompts: [], devices: [], switches: [], ips: [], evidence: saved?.evidence || [], restrictions: saved?.restrictions || [], applied: saved?.applied || {}, outcomes: [], retries: new Map(), baseline: saved?.baseline || {}, observedSince: saved?.observedSince || now, lastSaved: now }));
    rt.accounts.set(userId, pending);
    pending.catch(() => { if (rt.accounts.get(userId) === pending) rt.accounts.delete(userId); });
  }
  return pending;
}
function persist(a: Account): Promise<unknown> {
  const rt = state();
  const next = (rt.writes.get(a.userId) || Promise.resolve()).catch(() => undefined).then(() => writeRiskJson(path.join(rt.root, `user-${a.userId}.json`), { evidence: a.evidence, restrictions: a.restrictions, applied: a.applied, baseline: a.baseline, observedSince: a.observedSince }));
  rt.writes.set(a.userId, next);
  void next.finally(() => { if (rt.writes.get(a.userId) === next) rt.writes.delete(a.userId); }).catch(() => undefined);
  return next;
}
function cleanup(settings: RiskSettings, now: number) {
  const rt = state();
  if (now - rt.lastCleanup < 30000) return;
  rt.lastCleanup = now;
  let budget = num(settings, "capacity.cleanupBatch");
  for (const [id, context] of rt.contexts) { if (budget-- <= 0) break; if (now - context.at > num(settings, "rate.leaseSeconds") * 1000) rt.contexts.delete(id); }
  budget = num(settings, "capacity.cleanupBatch");
  for (const [hash, cluster] of rt.clusters) { if (budget-- <= 0) break; rt.clusters.delete(hash); if (now - cluster.at < num(settings, "prompt.windowSeconds") * 1000) rt.clusters.set(hash, cluster); }
  budget = num(settings, "capacity.cleanupBatch");
  for (const [id, pending] of rt.accounts) {
    if (budget-- <= 0) break;
    rt.accounts.delete(id); rt.accounts.set(id, pending);
    void pending.then(a => { if (now - a.at > num(settings, "capacity.idleSeconds") * 1000 && !a.restrictions.some(r => r.expiresAt > now) && a.inFlight.size === 0) rt.accounts.delete(id); });
  }
  budget = num(settings, "capacity.cleanupBatch");
  for (const [key] of rt.grants) { if (budget-- <= 0) break; if (!key.startsWith(`${dailyImageDay(now)}:`)) rt.grants.delete(key); }
  budget = num(settings, "capacity.cleanupBatch");
  for (const [device, linked] of rt.devices) {
    if (budget-- <= 0) break;
    rt.devices.delete(device);
    for (const [id, at] of linked) if (now - at > num(settings, "device.retentionDays") * 86400000) linked.delete(id);
    if (linked.size) rt.devices.set(device, linked);
  }
}
function prune(a: Account, settings: RiskSettings, now: number) {
  a.evidence = a.evidence.filter(e => e.expires > now);
  a.restrictions = a.restrictions.filter(r => r.expiresAt > now);
  a.outcomes = a.outcomes.filter(o => now - o.at < Math.max(num(settings, "content.ratioWindowSeconds"), num(settings, "quota.windowSeconds")) * 1000).slice(-512);
  for (const [id, at] of a.inFlight) if (now - at > num(settings, "rate.leaseSeconds") * 1000) a.inFlight.delete(id);
  for (const [id, at] of a.seen) if (now - at > 86400000) a.seen.delete(id);
  while (a.seen.size > 256) a.seen.delete(a.seen.keys().next().value!);
  for (const [minute] of a.retries) if (minute < Math.floor(now / 60000) - 10) a.retries.delete(minute);
  for (const key of Object.keys(a.applied)) if (a.applied[key] < now - 7 * 86400000) delete a.applied[key];
}
function add(a: Account, s: RiskSettings, id: string, key: string, details: Record<string, unknown>, now: number): Evidence | undefined {
  const rule = s.rules.find(r => r.id === id);
  if (!rule || rule.mode === "disabled") return;
  const evidenceId = `${id}:${key}`;
  if (a.evidence.some(e => e.id === evidenceId || e.rule === id && now - e.at < rule.cooldownSeconds * 1000)) return;
  const used = a.evidence.filter(e => e.rule === id && e.expires > now).reduce((sum, e) => sum + e.points, 0);
  const points = Math.max(0, Math.min(rule.points, rule.maxPoints - used));
  const e: Evidence = { id: evidenceId, rule: id, family: rule.family, points, strong: rule.strong, at: now, expires: now + rule.expiresSeconds * 1000, details };
  a.evidence.unshift(e); a.evidence = a.evidence.slice(0, num(s, "global.maxEvidence"));
  return e;
}
function score(a: Account, settings: RiskSettings, now: number) {
  const families = new Map<string, number>();
  for (const e of a.evidence) if (e.expires > now) families.set(e.family, (families.get(e.family) || 0) + e.points * 2 ** (-(now - e.at) / (num(settings, "global.halfLifeHours") * 3600000)));
  const points = Math.min(num(settings, "global.scoreCap"), Math.round([...families].reduce((sum, [family, value]) => sum + Math.min(settings.familyCaps[family] ?? 0, value), 0)));
  const grade = [...settings.levels].reverse().find(l => points >= l.minimum)!;
  return { points, grade };
}
async function restrict(a: Account, settings: RiskSettings, rule: RiskRuleConfig, reason: string, now: number) {
  if (rule.mode !== "enforce" || rule.action === "observe" || !rule.strong) return;
  if (a.restrictions.some(r => r.rule === rule.id && r.expiresAt > now)) return;
  const proof = `${rule.id}:${createHash("sha256").update(a.evidence.filter(e => e.strong && e.expires > now).map(e => e.id).sort().join("|")).digest("hex")}`;
  if (a.applied[proof]) return;
  a.applied[proof] = now;
  a.restrictions.push({ id: randomBytes(12).toString("hex"), rule: rule.id, action: rule.action, startsAt: now, expiresAt: now + Math.min(rule.durationSeconds, num(settings, "global.maxCooldownSeconds")) * 1000, reason });
  await persist(a);
}
export async function evaluateLightRisk(input: { userId: number; requestId?: string; prompt?: string; now?: number; geo?: IpGeoSnapshot }): Promise<LightEvaluation> {
  const settings = await getRiskSettings(input.userId), now = input.now ?? Date.now();
  cleanup(settings, now);
  const a = await account(input.userId, settings, now); prune(a, settings, now); a.at = now;
  const context = input.requestId ? state().contexts.get(input.requestId) : undefined;
  if (context?.result) return context.result;
  const hits: Evidence[] = [];
  const hit = (id: string, key: string, details: Record<string, unknown>) => { const e = add(a, settings, id, key, details, now); if (e) hits.push(e); };
  const active = a.restrictions.find(r => r.action === "deny") || a.restrictions.find(() => true);
  if (!flag(settings, "global.enabled")) return { decision: active?.action || "allow", level: "normal", score: 0, signalIds: [], signals: [], retryAfterSeconds: active ? Math.ceil((active.expiresAt - now) / 1000) : undefined, policyVersion: settings.version };
  let decision: LightEvaluation["decision"] = active?.action || "allow", reason = active?.reason;
  let retry = active ? Math.max(1, Math.ceil((active.expiresAt - now) / 1000)) : 0;
  const requestId = input.requestId || randomBytes(12).toString("hex");
  const firstAttempt = !a.seen.has(requestId);
  if (firstAttempt) a.seen.set(requestId, now);
  if (active && firstAttempt) {
    const minute = Math.floor(now / 60000); a.retries.set(minute, (a.retries.get(minute) || 0) + 1);
    const minutes = num(settings, "content.retryMinutes");
    if (Array.from({ length: minutes }, (_, i) => a.retries.get(minute - i) || 0).every(n => n >= num(settings, "content.retryPerMinute"))) hit("E01", active.id, { restrictionId: active.id });
  }
  if (decision === "allow" && firstAttempt && flag(settings, "rate.enabled")) {
    a.tokens = Math.min(num(settings, "rate.burst"), a.tokens + Math.max(0, now - a.tokenAt) * num(settings, "rate.perMinute") / 60000); a.tokenAt = now;
    if (a.tokens < 1 || a.inFlight.size >= num(settings, "rate.maxInFlight")) { decision = "rate-limit"; reason = "账号调用速率或在途数达到上限"; retry = num(settings, "rate.retrySeconds"); }
    else { a.tokens -= 1; a.inFlight.set(requestId, now); }
  }
  if (context?.ip && firstAttempt) {
    a.ips = a.ips.filter(i => now - i.at < 3600000);
    if (!a.ips.some(i => i.hash === context.ip)) a.ips.push({ hash: context.ip, at: now });
    a.ips = a.ips.slice(-16);
    if (a.ips.length >= 3) hit("N01", dailyImageDay(now), { exits: a.ips.length });
  }
  if (context?.device && firstAttempt && flag(settings, "device.enabled")) {
    context.newDevice = a.devices.length > 0 && !a.devices.some(d => d.id === context.device);
    const previous = a.devices[a.devices.length - 1]?.id;
    if (previous && previous !== context.device) a.switches.push(now);
    a.switches = a.switches.filter(t => now - t < 3600000).slice(-100);
    a.devices = a.devices.filter(d => d.id !== context.device && now - d.at < num(settings, "device.retentionDays") * 86400000);
    a.devices.push({ id: context.device, at: now }); a.devices = a.devices.slice(-num(settings, "device.maxDevices"));
    const devices = state().devices;
    let linked = devices.get(context.device);
    if (!linked && devices.size < num(settings, "capacity.devices")) { linked = new Map(); devices.set(context.device, linked); }
    if (linked) {
      for (const [id, t] of linked) if (now - t > num(settings, "device.retentionDays") * 86400000) linked.delete(id);
      const knownAt = linked.get(input.userId);
      if ((!knownAt && linked.size < num(settings, "device.maxAccounts")) || knownAt && now - knownAt >= num(settings, "device.refreshSeconds") * 1000) linked.set(input.userId, now);
      if (linked.size >= num(settings, "device.accountThreshold")) hit("D02", context.device, { accounts: linked.size, saturated: linked.size === num(settings, "device.maxAccounts") });
    }
    if (a.switches.length >= num(settings, "device.switchThreshold")) hit("D01", String(Math.floor(now / 3600000)), { switches: a.switches.length });
  }
  if (input.prompt && firstAttempt && flag(settings, "prompt.enabled") && (secret() || settings.values["prompt.algorithm"] === "sha256")) {
    let normalized = flag(settings, "prompt.unicode") ? input.prompt.normalize("NFKC") : input.prompt;
    if (flag(settings, "prompt.caseFold")) normalized = normalized.toLowerCase();
    if (flag(settings, "prompt.collapseWhitespace")) normalized = normalized.replace(/\s+/g, " ");
    normalized = normalized.trim();
    const hash = settings.values["prompt.algorithm"] === "sha256" ? createHash("sha256").update(normalized).digest("hex") : digest(`prompt-v2:${normalized}`)!;
    a.prompts.push({ hash, at: now }); a.prompts = a.prompts.filter(p => now - p.at < num(settings, "prompt.windowSeconds") * 1000).slice(-num(settings, "prompt.recentCount"));
    if (a.prompts.length >= num(settings, "prompt.minSamples") && (1 - new Set(a.prompts.map(p => p.hash)).size / a.prompts.length) * 100 >= num(settings, "prompt.repeatPercent")) hit("B01", hash, { samples: a.prompts.length });
    const clusters = state().clusters;
    let cluster = clusters.get(hash);
    if (cluster && now - cluster.at > num(settings, "prompt.windowSeconds") * 1000) { clusters.delete(hash); cluster = undefined; }
    if (!cluster && clusters.size < num(settings, "prompt.maxClusters")) { cluster = { at: now, count: 0, users: new Set() }; clusters.set(hash, cluster); }
    if (cluster) {
      cluster.count++; if (cluster.users.size < num(settings, "prompt.maxUsersPerCluster")) cluster.users.add(input.userId);
      if (cluster.count >= num(settings, "prompt.minRequests") && cluster.users.size >= num(settings, "prompt.minUsers")) hit("B02", hash, { requests: cluster.count, accounts: cluster.users.size, promptHash: hash });
    }
  }
  const observedGeo = input.geo || (context && flag(settings, "network.enabled") ? await cachedIpGeo(context.request) : undefined);
  if (observedGeo && flag(settings, "network.enabled") && now - Date.parse(observedGeo.queriedAt) < num(settings, "network.ttlHours") * 3600000) {
    const geo = observedGeo;
    if (geo.isVpn || geo.isProxy) hit("N02", geo.provider, { provider: geo.provider });
    if (geo.isTor) hit("N03", geo.provider, { provider: geo.provider });
    if (String(settings.values["network.countries"]).split(",").map(s => s.trim().toUpperCase()).includes(geo.countryCode?.toUpperCase() || "?") && geo.countryCode) hit("N04", geo.countryCode, { country: geo.countryCode });
  }
  const total = score(a, settings, now);
  for (const e of hits) {
    const r = settings.rules.find(r => r.id === e.rule)!;
    if (e.strong && r.action !== "observe") await restrict(a, settings, r, r.label, now);
  }
  if (flag(settings, "global.autoLevels") && total.grade.action !== "observe") {
    const live = a.evidence.filter(e => e.expires > now && settings.rules.find(r => r.id === e.rule)?.mode === "enforce");
    if (new Set(live.map(e => e.family)).size >= num(settings, "global.minimumIndependentSignals") && new Set(live.filter(e => e.strong).map(e => e.family)).size >= num(settings, "global.minimumStrongSignals")) {
      await restrict(a, settings, { ...settings.rules[0], id: `level:${total.grade.id}`, mode: "enforce", strong: true, action: total.grade.action, durationSeconds: total.grade.durationSeconds }, "多项独立证据达到配置风险等级", now);
      decision = total.grade.action; retry = total.grade.durationSeconds;
    }
  }
  if (hits.length) await persist(a);
  const finalRestriction = a.restrictions.find(r => r.action === "deny") || a.restrictions.find(() => true);
  if (finalRestriction) { decision = finalRestriction.action; retry = Math.max(1, Math.ceil((finalRestriction.expiresAt - now) / 1000)); reason = finalRestriction.reason; }
  const result = { decision, level: total.grade.id, score: total.points, signalIds: hits.map(e => `${e.rule}:${e.id}`), signals: hits, retryAfterSeconds: retry || undefined, reason, policyVersion: settings.version };
  if (context) context.result = result;
  return result;
}

export async function finishLightRisk(input: { userId: number; requestId: string; acceptedAt: number; status: number; cost?: number; moderation?: "denied" | "passed" }) {
  const rt = state(), context = rt.contexts.get(input.requestId), settings = await getRiskSettings(input.userId), now = Date.now();
  const a = await account(input.userId, settings, now); prune(a, settings, now); a.inFlight.delete(input.requestId);
  if (!flag(settings, "global.enabled")) { rt.contexts.delete(input.requestId); return; }
  const existing = a.outcomes.findIndex(o => o.requestId === input.requestId);
  const outcome: Outcome = { requestId: input.requestId, at: now, acceptedAt: input.acceptedAt, kind: input.moderation || "other", cost: Math.max(0, input.cost || 0) };
  if (existing >= 0) a.outcomes[existing] = outcome; else a.outcomes.push(outcome);
  if (input.moderation === "denied" && existing < 0) {
    if (a.firstFeedback && now - a.firstFeedback > num(settings, "content.windowSeconds") * 1000) a.firstFeedback = undefined;
    const after = a.firstFeedback !== undefined && input.acceptedAt > a.firstFeedback;
    if (!a.firstFeedback) a.firstFeedback = now;
    outcome.feedbackAt = after ? a.firstFeedback : undefined;
    add(a, settings, "C01", input.requestId, { verified: true }, now);
    await restrict(a, settings, settings.rules.find(r => r.id === "C01")!, "明确内容违规触发配置动作", now);
    const recent = a.outcomes.filter(o => o.kind === "denied" && now - o.at < num(settings, "content.windowSeconds") * 1000);
    const reviewed = a.outcomes.filter(o => o.kind !== "other" && now - o.at < num(settings, "content.ratioWindowSeconds") * 1000);
    const ratioHit = reviewed.length >= num(settings, "content.minReviewed") && reviewed.filter(o => o.kind === "denied").length * 100 / reviewed.length >= num(settings, "content.deniedPercent");
    if (recent.length >= num(settings, "content.minDenials") && recent.filter(o => o.feedbackAt !== undefined).length >= num(settings, "content.afterFeedback")) {
      add(a, settings, "E02", String(a.firstFeedback), { denials: recent.length, reviewed: reviewed.length }, now);
      await restrict(a, settings, settings.rules.find(r => r.id === "E02")!, "多次明确内容拒绝后的持续违规", now);
    }
    if (ratioHit && reviewed.filter(o => o.kind === "denied" && o.feedbackAt !== undefined).length >= num(settings, "content.afterFeedback")) {
      add(a, settings, "C02", String(Math.floor(now / (num(settings, "content.ratioWindowSeconds") * 1000))), { reviewed: reviewed.length }, now);
      await restrict(a, settings, settings.rules.find(r => r.id === "C02")!, "有效审核样本内持续高比例明确违规", now);
    }
    await persist(a);
  }
  const day = dailyImageDay(input.acceptedAt), bucket = a.baseline[day] ||= { calls: Array(24).fill(0), cost: 0, settlements: 0 };
  if (existing < 0 && input.status >= 200 && input.status < 300) { const hour = new Date(input.acceptedAt + 28800000).getUTCHours(); bucket.calls[hour]++; bucket.cost += outcome.cost; bucket.costs ||= Array(24).fill(0); bucket.costs![hour] += outcome.cost; bucket.settlements++; }
  const baselineDays = Math.max(32, num(settings, "quota.baselineDays") + 7, num(settings, "trust.minimumActiveDays") + 7);
  for (const date of Object.keys(a.baseline)) if (date < dailyImageDay(now - baselineDays * 86400000)) delete a.baseline[date];
  if (flag(settings, "quota.enabled") && outcome.cost > 0) {
    const history = Object.entries(a.baseline).filter(([date]) => date < dailyImageDay(now - num(settings, "quota.baselineDelayHours") * 3600000));
    const settled = history.reduce((sum, [, b]) => sum + b.settlements, 0);
    const currentHour = new Date(input.acceptedAt + 28800000).getUTCHours();
    const average = history.reduce((sum, [, b]) => sum + (b.costs?.[currentHour] || 0), 0) / Math.max(1, history.length) * num(settings, "quota.windowSeconds") / 3600;
    const recentCost = a.outcomes.filter(o => now - o.at < num(settings, "quota.windowSeconds") * 1000).reduce((sum, o) => sum + o.cost, 0);
    if (average > 0 && history.length >= num(settings, "quota.baselineDays") && settled >= num(settings, "quota.minimumSettlements") && recentCost >= num(settings, "quota.minimumAff") && recentCost >= average * num(settings, "quota.acceleration")) {
      add(a, settings, "Q01", String(Math.floor(now / (num(settings, "quota.windowSeconds") * 1000))), { recentCost, average }, now);
      if (context?.newDevice) { add(a, settings, "Q02", input.requestId, { recentCost, average, newDevice: true }, now); await restrict(a, settings, settings.rules.find(r => r.id === "Q02")!, "新设备伴随消费显著突增，保护性暂停", now); }
    }
  }
  if (now - a.lastSaved >= num(settings, "quota.updateSeconds") * 1000) {
    if (flag(settings, "behavior.enabled")) {
      const history = Object.entries(a.baseline).filter(([date]) => date < day);
      const historical = history.reduce((sum, [, b]) => sum + b.calls.reduce((n, v) => n + v, 0), 0);
      const recent = bucket.calls.reduce((sum, n) => sum + n, 0);
      if (recent >= num(settings, "behavior.minimumRecent") && historical >= num(settings, "behavior.minimumHistory") && history.length >= num(settings, "quota.baselineDays")) {
        const slots = num(settings, "behavior.slots"), before = Array(slots).fill(0) as number[], current = Array(slots).fill(0) as number[];
        for (const [, b] of history) b.calls.forEach((n, h) => { before[Math.min(slots - 1, Math.floor(h * slots / 24))] += n; });
        bucket.calls.forEach((n, h) => { current[Math.min(slots - 1, Math.floor(h * slots / 24))] += n; });
        const deviation = current.reduce((sum, n, i) => sum + Math.abs(n / recent - before[i] / historical), 0) * 50;
        if (deviation >= num(settings, "behavior.deviationPercent")) add(a, settings, "B03", day, { deviation, recent, historical }, now);
      }
    }
    // A baseline is diagnostic state: a disk fault here must not discard a paid image.
    await persist(a).catch(() => console.error("[lfn] risk baseline write failed")); a.lastSaved = now;
  }
  if (context) rt.contexts.delete(input.requestId);
}

function grantKey(userId: number, day: string) { return `${day}:${userId}`; }
async function loadGrant(userId: number, now: number) {
  const rt = state(), day = dailyImageDay(now), key = grantKey(userId, day);
  if (!rt.grants.has(key)) {
    const read = readOptional<Grant>(path.join(rt.root, "grants", `${userId}-${day}.json`)); rt.grants.set(key, read);
    read.catch(() => rt.grants.delete(key));
  }
  return rt.grants.get(key)!;
}
const grantLocks = (shared.__lfnGrantLocks ??= new Map<string, Promise<unknown>>());
async function grantLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (grantLocks.get(key) || Promise.resolve()).catch(() => undefined).then(fn);
  grantLocks.set(key, next); void next.finally(() => { if (grantLocks.get(key) === next) grantLocks.delete(key); }).catch(() => undefined); return next;
}
export async function assertFreeGrant(userId: number, requestId: string) {
  const context = state().contexts.get(requestId), settings = await getRiskSettings(userId);
  if (!flag(settings, "grant.enabled") || !context) return; // Internal, non-HTTP accounting calls have no visitor identity.
  if (!context.ip) {
    if (settings.values["grant.unknownIp"] === "observe") return;
    throw new RiskAdmissionError("暂时无法确认可信访问来源，免费额度请求已暂停", "lfn_source_unavailable", 503);
  }
  const now = Date.now(), day = dailyImageDay(now), key = grantKey(userId, day);
  await grantLock(`${state().root}:${key}`, async () => {
    let grant = await loadGrant(userId, now);
    if (grant && !grant.ips.includes(context.ip!)) {
      if (grant.ips.length >= num(settings, "grant.maxActiveExits")) throw new RiskAdmissionError("今日免费授权绑定其他网络，请在账号安全中确认换绑", "lfn_daily_grant_mismatch");
      grant = { ...grant, ips: [...grant.ips, context.ip!], version: grant.version + 1 };
      await writeRiskJson(path.join(state().root, "grants", `${userId}-${day}.json`), grant); state().grants.set(key, Promise.resolve(grant));
    }
    if (!grant) {
      grant = { day, userId, id: randomBytes(16).toString("hex"), ips: [context.ip!], version: 1, rebinds: 0, changedAt: now, expiresAt: Date.parse(`${day}T00:00:00+08:00`) + 86400000 };
      await writeRiskJson(path.join(state().root, "grants", `${userId}-${day}.json`), grant);
      state().grants.set(key, Promise.resolve(grant));
    }
  });
}
export async function rebindFreeGrant(userId: number, request: Request, authenticatedAt: number) {
  const settings = await getRiskSettings(userId), now = Date.now();
  const a = await account(userId, settings, now);
  if (a.restrictions.some(r => r.expiresAt > now) || await import("./risk-control").then(m => m.isRiskBlocked(userId))) throw new RiskAdmissionError("账号当前有有效限制，换绑不能绕过该限制", "lfn_rebind_restricted");
  if (!authenticatedAt || now - authenticatedAt > num(settings, "grant.reauthMinutes") * 60000) throw new RiskAdmissionError("请重新登录后确认换绑", "lfn_recent_login_required", 401);
  if (flag(settings, "grant.strictNoRebind")) throw new RiskAdmissionError("当前策略禁止当日换绑", "lfn_rebind_disabled");
  const raw = (await resolveTrustedClientIp(request)).ip, ip = raw ? digest(`ip:${raw}`) : undefined;
  if (!ip) throw new RiskAdmissionError("可信访问来源不可用", "lfn_source_unavailable", 503);
  const key = grantKey(userId, dailyImageDay(now));
  return grantLock(`${state().root}:${key}`, async () => {
    const grant = await loadGrant(userId, now);
    if (!grant) throw new RiskAdmissionError("今日尚无免费授权，无需换绑", "lfn_grant_missing", 409);
    if (grant.ips.includes(ip)) return { ...grant, ips: undefined };
    if (grant.rebinds >= num(settings, "grant.maxRebinds") || now - grant.changedAt < num(settings, "grant.minRebindSeconds") * 1000) throw new RiskAdmissionError("换绑次数已用完或尚在换绑冷却期", "lfn_rebind_limited", 429);
    const next = { ...grant, ips: [ip], version: grant.version + 1, rebinds: grant.rebinds + 1, changedAt: now };
    await writeRiskJson(path.join(state().root, "grants", `${userId}-${grant.day}.json`), next); state().grants.set(key, Promise.resolve(next));
    return { ...next, ips: undefined };
  });
}
export async function riskUserSnapshot(userId: number) {
  const settings = await getRiskSettings(userId), now = Date.now(), a = await account(userId, settings, now); prune(a, settings, now);
  const total = score(a, settings, now), grant = await loadGrant(userId, now);
  const days = Object.keys(a.baseline).sort();
  return { userId, score: total.points, level: total.grade.id, grade: total.grade.name, evidence: a.evidence, restrictions: a.restrictions, grant: grant ? { ...grant, ips: undefined, exits: grant.ips.length } : null, counts: { inFlight: a.inFlight.size, devices: a.devices.length, exits: a.ips.length, retainedOutcomes: a.outcomes.length, outcomeCapacity: 512 }, trust: { observedDays: Math.max(0, Math.floor((now - a.observedSince) / 86400000)), activeDays: days.length, unresolvedStrongEvidence: a.evidence.some(e => e.strong && e.expires > now) }, readiness: { content: "explicit-upstream-results-only", semantic: false, externalReputation: false, sharedAtomic: false }, policyVersion: settings.version };
}
export function releaseRiskContext(requestId: string) { state().contexts.delete(requestId); }
export async function confirmRiskEvidence(userId: number, ruleId: string, reference: string, operator: number) {
  if (!["N05", "R01", "G01"].includes(ruleId) || !reference.trim() || reference.length > 200) throw new Error("请提供已人工核验的证据编号和支持的规则");
  const referenceHash = digest(`verified:${reference.trim()}`); if (!referenceHash) throw new Error("风控摘要密钥不可用");
  const settings = await getRiskSettings(userId), now = Date.now(), a = await account(userId, settings, now); prune(a, settings, now);
  const rule = settings.rules.find(r => r.id === ruleId)!;
  if (rule.mode === "disabled") throw new Error("对应规则已关闭");
  const fresh = add(a, settings, ruleId, referenceHash, { verifiedBy: operator, referenceHash }, now);
  if (fresh) await restrict(a, settings, rule, `人工核验：${rule.label}`, now);
  await persist(a);
  return riskUserSnapshot(userId);
}
export async function releaseRiskRestriction(userId: number, restrictionId: string) {
  const settings = await getRiskSettings(userId), a = await account(userId, settings, Date.now());
  a.restrictions = a.restrictions.filter(r => r.id !== restrictionId); await persist(a);
}
export function resetLightRisk() { shared.__lfnLightRisk = undefined; }
