import { RateLimitError, retryAfterSeconds } from "@/lib/retry-after";
export { RateLimitError } from "@/lib/retry-after";
export class SessionExpiredError extends Error {}

export async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const result: unknown = await response.json().catch(() => null);
  const record = result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown> : null;
  const message = typeof record?.message === "string" ? record.message : "";
  if (response.status === 401 || record?.sessionExpired === true)
    throw new SessionExpiredError(message || "登录状态已过期");
  if (response.status === 429)
    throw new RateLimitError(message || "请求过于频繁，请稍后重试。", retryAfterSeconds(response.headers.get("retry-after")));
  if (response.status === 413)
    throw new Error(message || "上传请求过大，请检查参赛图和校验原图大小（每张不超过 20 MB），或联系管理员检查上传限制。");
  if (!response.ok)
    throw new Error(message || `${fallback}（HTTP ${response.status}），请稍后重试。`);
  if (result === null)
    throw new Error(`${fallback}：服务器返回了无法解析的响应，请稍后重试。`);
  return result as T;
}
