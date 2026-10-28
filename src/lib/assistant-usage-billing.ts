import { newApiDbPool } from "@/lib/newapi-db";
import { runtimeQuotaPerUnit } from "@/lib/runtime-config";
import { usageNumber, type AssistantCallUsage, type AssistantImageReceipt } from "./assistant-usage";
import { findRequestAudit } from "./request-audit";
import type { AssistantJob } from "./assistant-jobs";
import { updateConversationUsage } from "./assistant-conversations";

export async function refreshAssistantJobUsage(job: AssistantJob, force = false): Promise<void> {
  if (job.usageRefresh) return job.usageRefresh;
  if (!force && Date.now() - (job.usageCheckedAt || 0) < 3_000) return;
  job.usageCheckedAt = Date.now();
  job.usageRefresh = (async () => {
    const previous = JSON.stringify(job.usage);
    const settled = new Map((await settleAssistantCalls(job.userId, job.usage)).map(call => [call.id, call]));
    // Model tool rounds can append while the ledger query is in flight.
    job.usage = job.usage.map(call => settled.get(call.id) ?? call);
    if (job.status === "done" && previous !== JSON.stringify(job.usage))
      await updateConversationUsage(job.userId, job.id, job.usage).catch(() => undefined);
  })();
  try { await job.usageRefresh; } finally { job.usageRefresh = undefined; }
}

type BillingRow = { request_id: string; quota: number | string; prompt_tokens: number | string; completion_tokens: number | string };

/** Scope the lookup to the signed-in user AND exact server-observed NewAPI request IDs. */
export async function settleAssistantCalls(userId: number, calls: AssistantCallUsage[]): Promise<AssistantCallUsage[]> {
  const pending = calls.filter(call => call.billing !== "settled" && call.requestId);
  const pool = newApiDbPool();
  if (!pending.length) return calls;
  if (!pool) return calls.map(call => call.billing === "settled" ? call : { ...call, billing: "unavailable" });
  try {
    const [result, unit] = await Promise.all([
      pool.query<BillingRow>(`SELECT request_id, SUM(quota)::text AS quota,
        MAX(prompt_tokens)::text AS prompt_tokens, MAX(completion_tokens)::text AS completion_tokens
        FROM logs WHERE user_id=$1 AND request_id=ANY($2::text[]) AND type=2 GROUP BY request_id`,
      [userId, [...new Set(pending.map(call => call.requestId))]]),
      runtimeQuotaPerUnit(),
    ]);
    const rows = new Map(result.rows.map(row => [row.request_id, row]));
    return calls.map(call => {
      if (call.billing === "settled") return call;
      const row = call.requestId ? rows.get(call.requestId) : undefined;
      const quota = row ? usageNumber(Number(row.quota)) : null;
      if (quota === null) return call;
      const inputTokens = call.inputTokens ?? usageNumber(Number(row!.prompt_tokens));
      const outputTokens = call.outputTokens ?? usageNumber(Number(row!.completion_tokens));
      return { ...call, inputTokens, outputTokens, totalTokens: call.totalTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null), quota, balanceCost: quota / unit, billing: "settled" };
    });
  } catch {
    // A missing/delayed ledger must never become a fabricated zero-cost receipt.
    return calls;
  }
}

export async function assistantImageReceipt(userId: number, id: string): Promise<AssistantImageReceipt | null> {
  const audit = await findRequestAudit(id);
  if (!audit || audit.userId !== userId) return null;
  const base: AssistantImageReceipt = { id, aff: null, balanceCost: null, billing: "pending" };
  if (audit.status === undefined) return base;
  const charged = usageNumber(audit.billing?.lfnChargedAff);
  const settlement = audit.settlement;
  const aff = charged ?? (settlement && settlement.paymentSource !== "newapi" ? Math.max(0, settlement.chargedAmount - settlement.refundedAmount) : null);
  if (aff !== null) return { ...base, aff, billing: "settled" };
  const requestIds = [...new Set(audit.billing?.newApiRequestIds ?? (audit.upstreamRequestId ? [audit.upstreamRequestId] : []))];
  if (audit.paymentSource === "newapi" && requestIds.length) {
    const calls = await settleAssistantCalls(userId, requestIds.map(requestId => ({ id: requestId, requestId, inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null, quota: null, balanceCost: null, billing: "pending" })));
    if (calls.every(call => call.billing === "settled")) return { ...base, balanceCost: calls.reduce((n, call) => n + (call.balanceCost ?? 0), 0), billing: "settled" };
    return { ...base, billing: calls.some(call => call.billing === "pending") ? "pending" : "unavailable" };
  }
  // Other API providers keep their own ledger; LFN has no confirmed amount.
  return { ...base, billing: "unavailable" };
}
