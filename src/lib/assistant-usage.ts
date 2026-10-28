/** Public usage receipts contain counts and costs only, never model messages or credentials. */
export type AssistantCallUsage = {
  id: string;
  requestId?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  quota: number | null;
  balanceCost: number | null;
  billing: "pending" | "settled" | "unavailable";
};
export type AssistantImageReceipt = {
  id: string;
  aff: number | null;
  balanceCost: number | null;
  billing: "pending" | "settled" | "unavailable";
};

export function usageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function modelUsageReceipt(id: string, requestId: string | null, value: unknown): AssistantCallUsage {
  const u = record(value), prompt = record(u.prompt_tokens_details ?? u.input_tokens_details), completion = record(u.completion_tokens_details ?? u.output_tokens_details);
  const inputTokens = usageNumber(u.prompt_tokens ?? u.input_tokens), outputTokens = usageNumber(u.completion_tokens ?? u.output_tokens);
  return {
    id, ...(requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ? { requestId } : {}),
    inputTokens, outputTokens,
    totalTokens: usageNumber(u.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    cachedInputTokens: usageNumber(prompt.cached_tokens ?? u.prompt_cache_hit_tokens),
    reasoningTokens: usageNumber(completion.reasoning_tokens),
    quota: null, balanceCost: null, billing: requestId ? "pending" : "unavailable",
  };
}

export function summarizeAssistantUsage(calls: AssistantCallUsage[], images: AssistantImageReceipt[] = []) {
  // Reasoning and cache tokens are subsets, not additional input/output tokens.
  const uniqueCalls = [...new Map(calls.map(call => [call.id, call])).values()];
  const uniqueImages = [...new Map(images.map(image => [image.id, image])).values()];
  const sum = (key: "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens" | "reasoningTokens" | "balanceCost") => uniqueCalls.reduce((n, call) => n + (call[key] ?? 0), 0);
  return {
    calls: uniqueCalls.length,
    contextTokens: uniqueCalls.at(-1)?.inputTokens ?? null,
    inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens"),
    cachedInputTokens: sum("cachedInputTokens"), reasoningTokens: sum("reasoningTokens"),
    missingTokens: uniqueCalls.filter(call => call.inputTokens === null || call.outputTokens === null).length,
    modelBalance: sum("balanceCost"),
    imageBalance: uniqueImages.reduce((n, image) => n + (image.balanceCost ?? 0), 0),
    imageAff: uniqueImages.reduce((n, image) => n + (image.aff ?? 0), 0),
    images: uniqueImages.length,
    pending: [...uniqueCalls, ...uniqueImages].filter(item => item.billing === "pending").length,
    unavailable: [...uniqueCalls, ...uniqueImages].filter(item => item.billing === "unavailable").length,
    settledModels: uniqueCalls.filter(call => call.billing === "settled").length,
    settledImages: uniqueImages.filter(image => image.billing === "settled").length,
  };
}
