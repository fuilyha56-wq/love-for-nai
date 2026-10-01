import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { isPublicIp, validateProviderBaseUrl } from "./validation";

/** Resolve and pin a public address for each request so a later DNS answer cannot reach the LAN. */
export async function safeProviderFetch(baseUrl: string, path: string, init: { method?: string; headers?: Record<string,string>; body?: string | FormData; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
  const validated = validateProviderBaseUrl(baseUrl);
  if (!/^\/v1\/(?:models|images\/(?:generations|edits)|chat\/completions)$/.test(path) && !/^\/v1beta\/models(?:\?pageSize=1000|\/[A-Za-z0-9._%-]+:generateContent)?$/.test(path)) throw new Error("不支持的第三方 API 路径");
  const configured = new URL(validated);
  // Google publishes both native REST and an OpenAI compatibility base. Accept
  // either documented base without duplicating their version/path prefixes.
  const googleBase = configured.hostname === "generativelanguage.googleapis.com" && ["/", "/v1beta/openai"].includes(configured.pathname);
  const endpoint = googleBase
    ? new URL(path.startsWith("/v1beta/") ? `${configured.origin}${path}` : `${configured.origin}/v1beta/openai${path.replace(/^\/v1/, "")}`)
    : new URL(`${validated}${path}`);
  const addresses = await lookup(endpoint.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address)))
    throw new Error("第三方 API 域名解析到了非公网地址");
  const chosen = addresses[0];
  const agent = new Agent({ connect: { lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family) } });
  try {
    const response = await undiciFetch(endpoint, {
      method: init.method ?? "GET",
      headers: init.headers,
      // Node's native FormData is accepted by Undici; its DOM type omits the runtime toStringTag.
      body: init.body as UndiciRequestInit["body"],
      redirect: "manual",
      dispatcher: agent,
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeoutMs ?? 15_000)]) : AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
    // Do not follow redirects, which could target an internal host or leak the key.
    const maxBytes = path === "/v1/models" || path.startsWith("/v1beta/models?") ? 2_000_000 : 50_000_000;
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error("第三方 API 响应过大");
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
      finally { reader.releaseLock(); }
    }
    return new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") || "application/octet-stream" },
    });
  } finally {
    await agent.close();
  }
}

/** Fetch a returned image without credentials. Signed CDN queries are retained, redirects are not followed. */
export async function downloadProviderImage(rawUrl: string, signal?: AbortSignal): Promise<string> {
  let endpoint: URL;
  try { endpoint = new URL(rawUrl); } catch { throw new Error("上游图片 URL 无效"); }
  if (rawUrl.length > 8192 || !["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error("上游图片 URL 无效");
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) throw new Error("上游图片地址解析到了非公网地址");
  const chosen = addresses[0];
  const agent = new Agent({ connect: { lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family) } });
  try {
    const response = await undiciFetch(endpoint, { headers: { Accept: "image/png,image/jpeg,image/webp" }, redirect: "manual", dispatcher: agent, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`上游图片下载失败（${response.status}）`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("上游图片响应为空");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 25 * 1024 * 1024) throw new Error("上游图片超过 25 MiB");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
    if (!mime) throw new Error("上游图片不是受支持的 PNG、JPEG 或 WebP");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } finally { await agent.close(); }
}
