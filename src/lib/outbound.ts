import { ProxyAgent } from "undici";

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

export function outboundFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const dispatcher = proxyAgent();
  return fetch(
    url,
    dispatcher
      ? ({ ...init, dispatcher } as RequestInit & { dispatcher: ProxyAgent })
      : init,
  );
}
