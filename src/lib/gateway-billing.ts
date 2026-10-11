import type { AffGeneration } from "@/lib/aff";
import { roundBillingAmount } from "@/lib/image-pricing";

export type GatewayImageQuote = {
  anlasCost: number;
  promptTokens: number;
  affCost: number;
};

export function sameGatewayQuote(
  quote: GatewayImageQuote,
  anlasCost: number,
): boolean {
  return Number.isSafeInteger(anlasCost) && anlasCost === quote.anlasCost;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\/v1$/i, "").toLowerCase();
}

export function isSameGatewayUpstream(
  candidate: { baseUrl: string } | null,
  gateway: { baseUrl: string } | null,
): boolean {
  return Boolean(candidate && gateway && normalizeBaseUrl(candidate.baseUrl) === normalizeBaseUrl(gateway.baseUrl));
}

export async function requestGatewayImageQuote(
  baseUrl: string,
  token: string,
  generation: AffGeneration,
): Promise<GatewayImageQuote> {
  const quoteBaseUrl = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
  const response = await fetch(`${quoteBaseUrl}/v1/images/price-quote`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: generation.model,
      operation: generation.operation || "generate",
      width: generation.width,
      height: generation.height,
      steps: generation.steps,
      samples: generation.samples,
      strength: generation.strength,
      uncond_scale: generation.uncondScale,
      reference_count: generation.referenceImageCount || 0,
      encoded_vibe_count: generation.encodedVibeCount || 0,
      character_prompt_count: generation.characterPromptCount || 0,
      service_tier: generation.serviceTier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Gateway 报价失败（${response.status}）`);
  const payload = await response.json() as {
    anlas_cost?: unknown;
    usage?: { prompt_tokens?: unknown };
  };
  const anlasCost = Number(response.headers.get("x-anlas-cost") ?? payload.anlas_cost);
  const promptTokens = Number(response.headers.get("x-prompt-tokens") ?? payload.usage?.prompt_tokens);
  if (!Number.isSafeInteger(anlasCost) || anlasCost < 0 || !Number.isSafeInteger(promptTokens) || promptTokens < 0)
    throw new Error("Gateway 报价响应格式无效");
  if (payload.anlas_cost != null && Number(payload.anlas_cost) !== anlasCost)
    throw new Error("Gateway 报价响应的 Anlas 字段不一致");
  if (payload.usage?.prompt_tokens != null && Number(payload.usage.prompt_tokens) !== promptTokens)
    throw new Error("Gateway 报价响应的 usage 字段不一致");
  return {
    anlasCost,
    promptTokens,
    affCost: roundBillingAmount(anlasCost),
  };
}
