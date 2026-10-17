/** Cookie-authenticated state changes require same-origin JSON. */
export function validRiskMutation(request: Request): boolean {
  if (!request.headers.get("content-type")?.includes("application/json")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return Boolean(request.headers.get("authorization"));
  try { const host = new URL(origin).host; return host === new URL(request.url).host || host === request.headers.get("host"); } catch { return false; }
}
export async function readRiskJson(request: Request, limit = 256000): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); if (!reader) throw new Error("请求体为空");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new Error("配置或请求内容过大"); } chunks.push(value); }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请求必须为对象");
  return parsed;
}
