import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { isPublicIp, validateProviderBaseUrl } from "./validation";

/** Resolve and pin a public address for each request so a later DNS answer cannot reach the LAN. */
export async function safeProviderFetch(baseUrl: string, path: string, init: { method?: string; headers?: Record<string,string>; body?: string; timeoutMs?: number } = {}): Promise<Response> {
  const validated = validateProviderBaseUrl(baseUrl);
  if (!/^\/v1\/(?:models|images\/generations)$/.test(path)) throw new Error("不支持的第三方 API 路径");
  const endpoint = new URL(`${validated}${path}`);
  const addresses = await lookup(endpoint.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address)))
    throw new Error("第三方 API 域名解析到了非公网地址");
  const chosen = addresses[0];
  const agent = new Agent({ connect: { lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family) } });
  try {
    const response = await undiciFetch(endpoint, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      dispatcher: agent,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
    // Do not follow redirects, which could target an internal host or leak the key.
    const maxBytes = path === "/v1/models" ? 2_000_000 : 50_000_000;
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
      } finally { reader.releaseLock(); }
    }
    return new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") || "application/octet-stream" },
    });
  } finally {
    await agent.close();
  }
}
