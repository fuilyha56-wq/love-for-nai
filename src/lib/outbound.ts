import { fetch as undiciFetch, ProxyAgent } from "undici";

// 服务器直连 danbooru.donmai.us 会超时，需要经出站代理访问。
let agent: ProxyAgent | null = null;
let resolved = false;

function proxyAgent(): ProxyAgent | null {
  if (resolved) return agent;
  resolved = true;
  const url = process.env.LFN_OUTBOUND_PROXY?.trim();
  if (url) agent = new ProxyAgent(url);
  return agent;
}

export async function outboundFetch(
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> {
  const dispatcher = proxyAgent();
  if (!dispatcher) return fetch(url, init);

  // 必须用 undici 自带的 fetch，全局 fetch 会忽略这里的 dispatcher。
  const response = await undiciFetch(url, {
    headers: init.headers,
    signal: init.signal,
    dispatcher,
  });
  return new Response(await response.text(), {
    status: response.status,
    statusText: response.statusText,
    headers: { "Content-Type": "application/json" },
  });
}
