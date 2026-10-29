/** Public upstream errors must never echo server credentials or deployment addresses. */
export type UpstreamErrorPrivacy = {
  secrets?: readonly string[];
  urls?: readonly string[];
  fallback?: string;
};

const HIDDEN = "[已隐藏]";

function errorText(value: unknown, depth = 0): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") {
    if (depth < 3 && /^[\s]*[\[{]/.test(value)) {
      try { return errorText(JSON.parse(value), depth + 1); } catch { return ""; }
    }
    return value;
  }
  if (!value || typeof value !== "object" || depth >= 3) return "";
  const record = value as Record<string, unknown>;
  return errorText(record.error, depth + 1) || errorText(record.detail, depth + 1) || errorText(record.message, depth + 1);
}

export function safeUpstreamMessage(value: unknown, privacy: UpstreamErrorPrivacy = {}): string {
  const fallback = privacy.fallback || "上游服务暂时无法完成请求，请稍后重试";
  let message = errorText(value).trim();
  // HTML diagnostic pages and stack traces do not contain a safe user-facing error.
  if (!message || /<!doctype|<\/?(?:html|body|script|pre)\b|Traceback \(most recent call last\)|\n\s+at\s+.*:\d+/i.test(message)) return fallback;
  const hidden = new Set<string>();
  for (const secret of privacy.secrets || []) {
    if (!secret) continue;
    hidden.add(secret);
    hidden.add(encodeURIComponent(secret));
    hidden.add(JSON.stringify(secret).slice(1, -1));
  }
  for (const address of privacy.urls || []) {
    if (!address) continue;
    hidden.add(address);
    hidden.add(encodeURIComponent(address));
    try {
      const url = new URL(address);
      hidden.add(url.host);
      hidden.add(url.hostname);
      if (url.password) { hidden.add(url.password); hidden.add(decodeURIComponent(url.password)); }
      if (url.username) hidden.add(url.username);
    } catch { /* The full configured address is still hidden. */ }
  }
  for (const item of [...hidden].sort((a, b) => b.length - a.length)) message = message.split(item).join(HIDDEN);
  message = message
    .replace(/\b(?:https?|wss?):(?:\/|\\\/){2}[^\s"'<>]+/gi, HIDDEN)
    .replace(/\b(?:authorization|proxy-authorization)\s*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/gi, `Authorization: ${HIDDEN}`)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.~%-]+/gi, HIDDEN)
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|gateway[_-]?(?:token|password)|password|secret|token)\s*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, HIDDEN)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, HIDDEN)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, HIDDEN)
    .replace(/\b(?:127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|0\.0\.0\.0)(?::\d+)?\b/g, HIDDEN)
    .replace(/\b(?:localhost|[\w.-]+\.(?:internal|local|lan))(?::\d+)?\b/gi, HIDDEN)
    .replace(/\[(?:::1|f[cd][0-9a-f:]+|fe80:[0-9a-f:]+)\](?::\d+)?/gi, HIDDEN)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return message.slice(0, 500) || fallback;
}

/** Only error responses are rebuilt; successful image/ZIP/embedding streams are untouched. */
export async function safeUpstreamErrorResponse(response: Response, privacy: UpstreamErrorPrivacy = {}): Promise<Response> {
  if (response.ok) return response;
  let raw = "";
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let length = 0;
    try {
      while (length < 16384) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = 16384 - length;
        raw += decoder.decode(value.subarray(0, remaining), { stream: true });
        length += value.byteLength;
      }
      raw += decoder.decode();
    } catch { raw = ""; }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  // Diagnostic headers can echo the same secrets as a response body. Forward
  // only the numeric fields needed for backoff and failed-request billing.
  for (const name of ["retry-after", "x-anlas-cost", "x-prompt-tokens"]) {
    const value = response.headers.get(name)?.trim();
    if (value && /^\d+(?:\.\d+)?$/.test(value)) headers.set(name, value);
  }
  return Response.json({ error: { message: safeUpstreamMessage(raw, privacy), type: "api_error", code: "lfn_upstream_error" } }, {
    status: response.status >= 400 && response.status <= 599 ? response.status : 502,
    headers,
  });
}
