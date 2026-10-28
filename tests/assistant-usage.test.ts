import { describe, expect, it } from "vitest";
import { modelUsageReceipt, summarizeAssistantUsage } from "@/lib/assistant-usage";
import { validGoalGenerations } from "@/lib/assistant-limits";

describe("assistant usage accounting", () => {
  it("distinguishes missing usage from a reported zero and excludes reasoning/cache subsets from totals", () => {
    const missing = modelUsageReceipt("missing", null, {});
    expect(missing.inputTokens).toBeNull();
    expect(missing.balanceCost).toBeNull();
    const used = modelUsageReceipt("used", "req-test", { prompt_tokens: 100, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 20 } });
    const zero = modelUsageReceipt("zero", "req-zero", { input_tokens: 0, output_tokens: 0 });
    expect(zero.totalTokens).toBe(0);
    expect(summarizeAssistantUsage([missing, used, zero])).toMatchObject({ contextTokens: 0, inputTokens: 100, outputTokens: 40, totalTokens: 140, reasoningTokens: 20, cachedInputTokens: 30, missingTokens: 1 });
  });
  it("replaces repeated receipts instead of charging the same job/image twice", () => {
    const first = modelUsageReceipt("call-one", "req-one", { prompt_tokens: 100, completion_tokens: 20 });
    const settled = { ...first, billing: "settled" as const, quota: 2500, balanceCost: .005 };
    const image = { id: "image-one", aff: 5.75, balanceCost: null, billing: "settled" as const };
    expect(summarizeAssistantUsage([first, settled], [image, image])).toMatchObject({ calls: 1, modelBalance: .005, totalTokens: 120, images: 1, imageAff: 5.75, pending: 0 });
  });
  it.each([1, 2, 5, 50, 100])("accepts a custom %i-round run", value => expect(validGoalGenerations(value)).toBe(true));
  it.each([0, -1, 1.5, 101, NaN, "5", null])("rejects an invalid round limit %s", value => expect(validGoalGenerations(value)).toBe(false));
});
