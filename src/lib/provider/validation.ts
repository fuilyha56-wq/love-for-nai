import { isIP } from "node:net";
import { isImageProviderProtocol, type ImageProviderProtocol } from "@/lib/image-model-capabilities";

export class ProviderInputError extends Error {}

function invalid(message: string): never { throw new ProviderInputError(message); }

export function validateImageProviderProtocol(value: unknown): ImageProviderProtocol {
  if (value === undefined) return "auto";
  if (!isImageProviderProtocol(value)) invalid("图像 API 协议无效");
  return value;
}

export function validateApiKey(value: unknown): string {
  if (typeof value !== "string") invalid("请输入 API Key");
  const key = value.trim();
  if (!key || key.length > 2048 || /[\u0000-\u001f\u007f]/.test(key)) invalid("API Key 格式无效");
  return key;
}

export function validateModelId(value: unknown): string {
  if (typeof value !== "string") invalid("模型 ID 无效");
  const model = value.trim();
  if (!model || model.length > 160 || /[\u0000-\u001f\u007f]/.test(model)) invalid("模型 ID 无效");
  return model;
}

export function validateModels(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) invalid("模型列表最多包含 100 项");
  return [...new Set(value.map(validateModelId))];
}

export function validateProviderName(value: unknown): string {
  if (typeof value !== "string") invalid("请输入配置名称");
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) invalid("配置名称格式无效");
  return name;
}

function privateIpv4(ip: string): boolean {
  const segments = ip.split(".").map(Number);
  const [a,b] = segments;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0) || (a === 198 && b === 51) || (a === 203 && b === 0);
}

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !privateIpv4(ip);
  if (family !== 6) return false;
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPublicIp(normalized.slice(7));
  const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return normalized !== "::" && normalized !== "::1" &&
    !normalized.startsWith("fe8") && !normalized.startsWith("fe9") &&
    !normalized.startsWith("fea") && !normalized.startsWith("feb") &&
    !(first >= 0xfc00 && first <= 0xfdff) &&
    !(first >= 0xff00 && first <= 0xffff) &&
    !(first >= 0x2001 && first <= 0x2001 && normalized.startsWith("2001:db8"));
}

export function validateProviderBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 500) invalid("请输入有效的 HTTPS API 地址");
  let url: URL;
  try { url = new URL(value.trim()); } catch { invalid("请输入有效的 HTTPS API 地址"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port && url.port !== "443")
    invalid("第三方 API 地址必须是公开的 HTTPS 地址");
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".") || hostname.endsWith(".local") || hostname.endsWith(".localhost") || hostname.endsWith(".internal") || isIP(hostname))
    invalid("第三方 API 地址不能使用本机、内网或 IP 地址");
  if (url.pathname.includes("%") || /[\u0000-\u001f]/.test(url.pathname)) invalid("第三方 API 地址路径无效");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1(?:beta)?$/i, "") || "/";
  return url.toString().replace(/\/$/, "");
}
