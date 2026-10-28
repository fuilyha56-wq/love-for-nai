import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelUsageReceipt } from "@/lib/assistant-usage";
const mocks = vi.hoisted(() => ({ query: vi.fn(), pool: vi.fn(), audit: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/newapi-db", () => ({ newApiDbPool: mocks.pool }));
vi.mock("@/lib/runtime-config", () => ({ runtimeQuotaPerUnit: async () => 500000 }));
vi.mock("@/lib/request-audit", () => ({ findRequestAudit: mocks.audit }));
vi.mock("@/lib/assistant-conversations", () => ({ updateConversationUsage: mocks.update }));
import { assistantImageReceipt, refreshAssistantJobUsage, settleAssistantCalls } from "@/lib/assistant-usage-billing";
import { createAssistantJob } from "@/lib/assistant-jobs";

beforeEach(() => { vi.resetAllMocks(); mocks.pool.mockReturnValue({ query: mocks.query }); mocks.query.mockResolvedValue({ rows: [] }); mocks.update.mockResolvedValue(undefined); });
describe("actual assistant billing", () => {
  it("matches exact request IDs within the owner and uses logged quota without balance-delta estimates", async () => {
    mocks.query.mockResolvedValue({ rows: [{ request_id: "request-owned", quota: "2500", prompt_tokens: "123", completion_tokens: "45" }] });
    const [receipt] = await settleAssistantCalls(77, [modelUsageReceipt("call", "request-owned", {})]);
    expect(mocks.query.mock.calls[0][1]).toEqual([77, ["request-owned"]]);
    expect(mocks.query.mock.calls[0][0]).toMatch(/user_id=\$1 AND request_id=ANY\(\$2::text\[\]\)/);
    expect(receipt).toMatchObject({ balanceCost: .005, inputTokens: 123, outputTokens: 45, totalTokens: 168, billing: "settled" });
  });
  it("keeps delayed or unavailable bills unknown, but accepts confirmed zero-cost logs", async () => {
    const call = modelUsageReceipt("call", "request-owned", {});
    expect((await settleAssistantCalls(77, [call]))[0]).toMatchObject({ balanceCost: null, billing: "pending" });
    mocks.query.mockRejectedValueOnce(new Error("unavailable"));
    expect((await settleAssistantCalls(77, [call]))[0].balanceCost).toBeNull();
    mocks.query.mockResolvedValueOnce({ rows: [{ request_id: "request-owned", quota: "0", prompt_tokens: "0", completion_tokens: "0" }] });
    expect((await settleAssistantCalls(77, [call]))[0]).toMatchObject({ balanceCost: 0, billing: "settled" });
    mocks.pool.mockReturnValue(null);
    expect((await settleAssistantCalls(77, [call]))[0]).toMatchObject({ balanceCost: null, billing: "unavailable" });
  });
  it("preserves model calls appended while the ledger is queried", async () => {
    let release!: (value: { rows: never[] }) => void;
    mocks.query.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const job = createAssistantJob(77);
    job.usage.push(modelUsageReceipt("first", "req-first", {}));
    const pending = refreshAssistantJobUsage(job, true);
    job.usage.push(modelUsageReceipt("second", "req-second", {}));
    release({ rows: [] }); await pending;
    expect(job.usage.map(call => call.id)).toEqual(["first", "second"]);
  });
  it("rejects other users' images and reads net AFF after refunds", async () => {
    mocks.audit.mockResolvedValueOnce({ userId: 88, billing: { lfnChargedAff: 5 } });
    expect(await assistantImageReceipt(77, "image")).toBeNull();
    mocks.audit.mockResolvedValueOnce({ userId: 77, status: 200, settlement: { paymentSource: "mixed", chargedAmount: 11.5, refundedAmount: 5.75 } });
    expect(await assistantImageReceipt(77, "image")).toMatchObject({ aff: 5.75, billing: "settled" });
    mocks.audit.mockResolvedValueOnce({ userId: 77, status: 500, billing: { lfnChargedAff: 0 } });
    expect(await assistantImageReceipt(77, "image")).toMatchObject({ aff: 0, billing: "settled" });
  });
  it("sums independent NewAPI image batches only after all are settled", async () => {
    mocks.audit.mockResolvedValue({ userId: 77, status: 200, paymentSource: "newapi", billing: { newApiRequestIds: ["req-1", "req-2"] } });
    mocks.query.mockResolvedValueOnce({ rows: [{ request_id: "req-1", quota: "2500", prompt_tokens: "0", completion_tokens: "0" }] });
    expect(await assistantImageReceipt(77, "image")).toMatchObject({ balanceCost: null, billing: "pending" });
    mocks.query.mockResolvedValueOnce({ rows: [1, 2].map(n => ({ request_id: `req-${n}`, quota: "2500", prompt_tokens: "0", completion_tokens: "0" })) });
    expect(await assistantImageReceipt(77, "image")).toMatchObject({ balanceCost: .01, billing: "settled" });
  });
});
