import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getRiskSettings, publishRiskSettings, riskNumber, riskFlag, writeRiskJson } from "./risk-settings";
import { isRiskBlocked } from "./risk-control";
import { riskUserSnapshot } from "./light-risk";
export type RiskAccessRequest = { id: string; userId: number; reason: string; perMinute: number; concurrency: number; hours: number; createdAt: string; status: "pending" | "approved" | "declined" | "revoked"; decidedAt?: string; expiresAt?: string; operator?: string; decisionReason?: string };
const file = () => path.resolve(process.env.LFN_DATA_DIR || "data", "risk", "access-requests.json");
const accessRuntime = globalThis as typeof globalThis & { __lfnRiskAccessLock?: Promise<unknown> };
function lock<T>(fn: () => Promise<T>): Promise<T> { const task = (accessRuntime.__lfnRiskAccessLock || Promise.resolve()).catch(() => undefined).then(fn); accessRuntime.__lfnRiskAccessLock = task; return task; }
export async function listRiskAccessRequests(userId?: number): Promise<RiskAccessRequest[]> {
  let entries: RiskAccessRequest[];
  try { entries = JSON.parse(await readFile(file(), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") entries = []; else throw e; }
  return entries.filter(e => !userId || e.userId === userId).slice(0, 200);
}
async function approve(entry: RiskAccessRequest, operator: string, reason: string) {
  const current = structuredClone(await getRiskSettings());
  const previouslyApplied = current.overrides.find(o => o.userId === entry.userId && o.reason.startsWith(`access:${entry.id} `));
  const expiresAt = previouslyApplied?.expiresAt || new Date(Date.now() + entry.hours * 3600000).toISOString();
  if (!previouslyApplied) {
    current.overrides = [...current.overrides.filter(o => o.userId !== entry.userId), { userId: entry.userId, expiresAt, reason: `access:${entry.id} ${reason}`.slice(0, 500), values: { "rate.perMinute": entry.perMinute, "rate.burst": Math.min(entry.perMinute, 1000), "rate.maxInFlight": entry.concurrency } }];
    await publishRiskSettings(current, current.version, operator, `批准高频申请 ${entry.id}：${reason}`);
  }
  return { ...entry, status: "approved" as const, operator, expiresAt, decidedAt: entry.decidedAt || new Date().toISOString(), decisionReason: reason.slice(0, 500) };
}
export async function submitRiskAccessRequest(userId: number, input: { reason: string; perMinute: number; concurrency: number; hours: number }): Promise<RiskAccessRequest> {
  return lock(async () => {
    const settings = await getRiskSettings(), multiplier = riskNumber(settings, "trust.maxRateMultiplier");
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500 || ![input.perMinute, input.concurrency, input.hours].every(Number.isSafeInteger) || input.perMinute < 1 || input.perMinute > riskNumber(settings, "rate.perMinute") * multiplier || input.concurrency < 1 || input.concurrency > riskNumber(settings, "rate.maxInFlight") * multiplier || input.hours < 1 || input.hours > riskNumber(settings, "trust.grantHours")) throw new Error("申请超出当前允许的速率、并发或期限，请联系管理员");
    const entries = await listRiskAccessRequests();
    if (entries.some(e => e.userId === userId && Date.now() - Date.parse(e.createdAt) < riskNumber(settings, "trust.requestCooldownSeconds") * 1000)) throw new Error("申请提交过于频繁，请稍后再试");
    let entry: RiskAccessRequest = { id: randomUUID(), userId, ...input, reason: input.reason.trim(), createdAt: new Date().toISOString(), status: "pending" };
    const snapshot = await riskUserSnapshot(userId);
    if (!await isRiskBlocked(userId) && riskFlag(settings, "trust.autoApprove") && snapshot.trust.observedDays >= riskNumber(settings, "trust.minimumAccountDays") && snapshot.trust.activeDays >= riskNumber(settings, "trust.minimumActiveDays") && !snapshot.trust.unresolvedStrongEvidence && snapshot.restrictions.length === 0 && snapshot.score < settings.levels[1].minimum) entry = await approve(entry, "system:limited-access", "正常观测历史达到配置条件；不增加免费总额度");
    await writeRiskJson(file(), [entry, ...entries].slice(0, 200)); return entry;
  });
}
export async function decideRiskAccessRequest(id: string, action: "approve" | "decline" | "revoke", operator: string, reason: string) {
  return lock(async () => {
    if (!reason.trim()) throw new Error("请填写审批原因");
    const entries = await listRiskAccessRequests(), index = entries.findIndex(e => e.id === id);
    if (index < 0) throw new Error("申请不存在");
    const entry = entries[index];
    if (action === "approve") {
      if (entry.status !== "pending") throw new Error("申请已处理");
      const settings = await getRiskSettings(), snapshot = await riskUserSnapshot(entry.userId);
      if (await isRiskBlocked(entry.userId) || snapshot.restrictions.length || snapshot.trust.unresolvedStrongEvidence) throw new Error("存在未解决的明确风险，请先复核案件");
      if (entry.perMinute > riskNumber(settings, "rate.perMinute") * riskNumber(settings, "trust.maxRateMultiplier") || entry.concurrency > riskNumber(settings, "rate.maxInFlight") * riskNumber(settings, "trust.maxRateMultiplier") || entry.hours > riskNumber(settings, "trust.grantHours")) throw new Error("策略变化后此申请超限，请重新申请");
      entries[index] = await approve(entry, operator, reason);
    } else {
      if (action === "revoke") {
        const current = structuredClone(await getRiskSettings());
        const specific = current.overrides.find(o => o.userId === entry.userId && o.reason.startsWith(`access:${entry.id} `));
        if (specific) { current.overrides = current.overrides.filter(o => o !== specific); await publishRiskSettings(current, current.version, operator, `撤销高频申请 ${id}：${reason}`); }
      }
      entries[index] = { ...entry, status: action === "revoke" ? "revoked" : "declined", operator, decisionReason: reason.slice(0, 500), decidedAt: new Date().toISOString() };
    }
    await writeRiskJson(file(), entries); return entries[index];
  });
}
