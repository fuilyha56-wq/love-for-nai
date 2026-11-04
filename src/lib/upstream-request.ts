import { headers } from "next/headers";
import { resolveTrustedClientIp } from "@/lib/risk-ip";
import { RateLimitError, retryAfterSeconds } from "@/lib/retry-after";
export { RateLimitError } from "@/lib/retry-after";

export function upstreamFailureResponse(error: unknown, fallback = "暂时无法连接账号服务"): Response {
  if (error instanceof RateLimitError) return Response.json({ message: error.message, retryAfter: error.retryAfter }, { status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" } });
  return Response.json({ message: fallback }, { status: 502, headers: { "Cache-Control": "no-store" } });
}

export async function upstreamClientHeaders(): Promise<Record<string, string>> {
  try {
    const requestHeaders = await headers();
    const client = await resolveTrustedClientIp(new Request("http://lfn.internal", { headers: requestHeaders }));
    return client.trusted && client.ip ? { "X-Forwarded-For": client.ip } : {};
  } catch { return {}; }
}

export async function readUpstreamJson<T>(response: Response, operation: string): Promise<T> {
  if (response.status === 429) throw new RateLimitError(`${operation}请求过于频繁，请稍后重试（HTTP 429）。`, retryAfterSeconds(response.headers.get("retry-after")));
  try { return await response.json() as T; }
  catch { throw new Error(`${operation}返回了无效响应（HTTP ${response.status}），请稍后重试。`); }
}
