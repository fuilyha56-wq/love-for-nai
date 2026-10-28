import { fetchWithModelConcurrency } from "@/lib/model-concurrency";
import { assistantReasoningParams } from "@/lib/assistant-reasoning";

export type AssistantKeyAuth = {
  key: string;
  refreshKey?: (rejectedKey: string) => Promise<string>;
  refreshed?: boolean;
  reasoningEffort?: string;
  /** Server-owned transport for saved custom providers; never accept a client URL. */
  transport?: (init: RequestInit) => Promise<Response>;
};

// Only retry a rejected NewAPI API key, never quota/rate limits, provider errors,
// successful model rounds, or personal API configurations without a callback.
export async function fetchAssistantModel(
  url: string,
  init: RequestInit,
  auth: AssistantKeyAuth,
): Promise<Response> {
  // All assistant entry points share the requested reasoning level, including
  // native tool rounds and the bounded authentication retry.
  if (typeof init.body === "string") {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (typeof body.model === "string") {
      const requested = auth.reasoningEffort ?? body.reasoning_effort;
      delete body.reasoning_effort;
      if (/gpt-[56]|(?:^|\/)o[134](?:-|$)/i.test(body.model) && requested !== "none") delete body.temperature;
      init = { ...init, body: JSON.stringify({ ...body, ...assistantReasoningParams(body.model, requested) }) };
    }
  }
  const send = () => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${auth.key}`);
    return auth.transport ? auth.transport({ ...init, headers }) : fetchWithModelConcurrency(url, { ...init, headers });
  };
  const response = await send();
  if (
    !auth.refreshKey ||
    auth.refreshed ||
    ![401, 403].includes(response.status)
  )
    return response;
  const result = (await response
    .clone()
    .json()
    .catch(() => null)) as {
    error?: { message?: string; code?: string };
    message?: string;
  } | null;
  const message = result?.error?.message || result?.message || "";
  const rejected =
    /^(?:invalid token|invalid api key|token (?:has expired|expired|is disabled|not found)|无效的令牌|令牌已过期|令牌已被禁用|令牌不存在)(?:\b|[（(:：\s]|$)/i.test(
      message,
    );
  if (!rejected) return response;
  init.signal?.throwIfAborted();
  auth.refreshed = true;
  const freshKey = await auth.refreshKey(auth.key);
  if (freshKey === auth.key) return response;
  auth.key = freshKey;
  init.signal?.throwIfAborted();
  return send();
}
