export type AssistantErrorInfo = {
  code: "UPSTREAM_CONTENT_BLOCKED";
  reason: string;
  retryable: false;
};

export class AssistantModelBlockedError extends Error {
  readonly info: AssistantErrorInfo;
  constructor(reason: string) {
    super(`上游助手模型拒绝了本次请求（${reason}）。任务已暂停，本次建议未应用，也未触发下一轮生成。请检查本次输入与参考图；来源拦截无法由应用解除。`);
    this.name = "AssistantModelBlockedError";
    this.info = { code: "UPSTREAM_CONTENT_BLOCKED", reason, retryable: false };
  }
}

type ChatResult = {
  error?: { message?: string; code?: string; type?: string };
  choices?: Array<{ finish_reason?: string; message?: { content?: unknown; refusal?: string | null } }>;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string }>;
};

/** Recognize both OpenAI-compatible gateway errors and native Gemini block fields. */
export function assertAssistantModelNotBlocked(result: ChatResult): void {
  const reasons = /\b(PROHIBITED_CONTENT|SAFETY|BLOCKLIST|IMAGE_SAFETY|IMAGE_PROHIBITED_CONTENT|SPII|CONTENT_FILTER|CONTENT_POLICY_VIOLATION)\b/i;
  const explicitReason = result.promptFeedback?.blockReason;
  const candidateReason = result.candidates?.map((item) => item.finishReason).find((value) => value && reasons.test(value));
  const choice = result.choices?.[0];
  const finishReason = choice?.finish_reason?.match(reasons)?.[1];
  const errorText = [result.error?.code, result.error?.type, result.error?.message].filter(Boolean).join(" ");
  const errorReason = errorText.match(reasons)?.[1];
  if (explicitReason && explicitReason !== "BLOCK_REASON_UNSPECIFIED") throw new AssistantModelBlockedError(explicitReason);
  if (candidateReason || errorReason || finishReason) throw new AssistantModelBlockedError((candidateReason || errorReason || finishReason)!.toUpperCase());
  if (choice?.message?.refusal) throw new AssistantModelBlockedError("MODEL_REFUSAL");
}
