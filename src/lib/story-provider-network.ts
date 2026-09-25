import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("::ffff:")) return true;
  if (isIP(address) === 4) {
    const [first, second] = address.split(".").map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 ||
      first === 192 && second === 168 || first === 100 && second >= 64 && second <= 127 ||
      first === 192 && second === 0 || first === 198 && (second === 18 || second === 19);
  }
  return false;
}

export async function validateStoryProviderUrl(input: string): Promise<string> {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("请输入有效的 API 地址"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port && url.port !== "443")
    throw new Error("模型接口必须是标准 HTTPS 地址");
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local"))
    throw new Error("不允许连接本机或内网地址");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw new Error("不允许连接本机或内网地址");
  return url.toString().replace(/\/+$/, "");
}