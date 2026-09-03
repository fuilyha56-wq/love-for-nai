import { getSession } from "@/lib/session";
import {
  runtimeAdminToken,
  runtimeAffGateway,
  runtimeNewApiBaseUrl,
} from "@/lib/runtime-config";

type Token = {
  id: number;
  name: string;
  status: number;
  group?: string;
  model_limits_enabled?: boolean;
  model_limits?: string;
};
type ApiResult<T> = { success: boolean; message?: string; data?: T };
export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const LFN_TOKEN_PREFIX = "lfn-image-studio";
const LFN_CHAT_TOKEN_PREFIX = "lfn-assistant";

// AFF 支付直连 Gateway：返回 { baseUrl, token }；未配置时返回 null。
export function affGateway(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.LFN_AFF_GATEWAY_URL?.trim().replace(/\/+$/, "");
  const token = process.env.LFN_AFF_GATEWAY_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function resolvedAffGateway(): Promise<{ baseUrl: string; token: string } | null> {
  try {
    return await runtimeAffGateway();
  } catch {
    return affGateway();
  }
}

function tokenNameFor(prefix: string, group: string): string {
  return `${prefix}-${group.toLowerCase()}`;
}

export function newApiBaseUrl(): string {
  return process.env.NEWAPI_BASE_URL || "http://127.0.0.1:3000";
}

export async function resolvedNewApiBaseUrl(): Promise<string> {
  try {
    return await runtimeNewApiBaseUrl();
  } catch {
    return newApiBaseUrl();
  }
}

export async function resolvedAdminToken(): Promise<string | null> {
  try {
    return await runtimeAdminToken();
  } catch {
    const token = process.env.LFN_ADMIN_TOKEN?.trim();
    return token || null;
  }
}

export function userHeaders(session: Session): Record<string, string> {
  // 系统访问令牌不带 Bearer 前缀；登录派发的 access_token 需要 Bearer。
  const authorization = session.systemToken
    ? session.systemToken
    : session.accessToken
      ? `Bearer ${session.accessToken}`
      : "";
  return {
    "New-Api-User": String(session.userId),
    "Content-Type": "application/json",
    ...(session.upstreamCookie ? { Cookie: session.upstreamCookie } : {}),
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

async function readUsableGroups(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/user/self/groups`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return [];
  const result = (await response.json()) as ApiResult<
    Record<string, unknown> | string[]
  >;
  if (!result.success || !result.data) return [];
  return Array.isArray(result.data)
    ? result.data.filter((item): item is string => typeof item === "string")
    : Object.keys(result.data);
}

// 每个模型只在特定分组的渠道上可用，密钥分组必须与之匹配。
async function readModelGroups(
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/pricing`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const result = (await response.json()) as {
    data?: Array<{ model_name?: string; enable_groups?: string[] }>;
  };
  const entry = result.data?.find((item) => item.model_name === model);
  return entry?.enable_groups?.filter((item) => typeof item === "string") ?? [];
}

// 图像模型的渠道统一挂在 Draw 分组；UserUsableGroups 可能没收录它，
// 所以密钥分组优先精确命中 Draw，而不是拿交集的第一个。
const IMAGE_TOKEN_GROUP = "draw";

function pickImageGroup(modelGroups: string[]): string | undefined {
  const byLower = new Map(
    modelGroups.map((group) => [group.toLowerCase(), group]),
  );
  return byLower.get(IMAGE_TOKEN_GROUP) ?? modelGroups[0];
}

async function resolveToken(
  session: Session,
  model: string,
  prefix: string,
): Promise<string> {
  const baseUrl = newApiBaseUrl();
  const headers = userHeaders(session);
  const selfResponse = await fetch(`${baseUrl}/api/user/self`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const selfResult = (await selfResponse.json()) as ApiResult<{
    group?: string;
    user?: { group?: string };
  }>;
  if (!selfResult.success)
    throw new Error(selfResult.message || "无法读取用户分组");
  const selfGroup = selfResult.data?.user?.group ?? selfResult.data?.group;

  const [modelGroups, usableGroups] = await Promise.all([
    readModelGroups(baseUrl, headers, model),
    readUsableGroups(baseUrl, headers),
  ]);
  const owned = new Set(
    [...(selfGroup ? [selfGroup] : []), ...usableGroups].filter(Boolean),
  );
  // 图像模型：渠道分组就是密钥该用的分组（Draw），账号可用分组交集只用于校验。
  const isImageKey = prefix === LFN_TOKEN_PREFIX;
  const group = isImageKey
    ? pickImageGroup(modelGroups)
    : modelGroups.filter((item) => owned.has(item))[0];
  if (!group) {
    if (!modelGroups.length) throw new Error(`模型 ${model} 当前不可用`);
    throw new Error(
      `当前账号没有 ${modelGroups.join(" / ")} 分组权限，无法使用 ${model}`,
    );
  }
  if (isImageKey && !owned.has(group)) {
    // Draw 不在 UserUsableGroups 时 NewAPI 仍会按渠道分组放行，这里只提示不打断。
    console.warn(`[lfn] 分组 ${group} 不在账号可用分组列表，继续尝试`);
  }

  const listTokens = async (): Promise<Token[]> => {
    const response = await fetch(`${baseUrl}/api/token/?p=1&size=100`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as ApiResult<
      { items?: Token[] } | Token[]
    >;
    if (!result.success) throw new Error(result.message || "无法读取 API 密钥");
    return Array.isArray(result.data) ? result.data : result.data?.items || [];
  };

  // 已有同分组可用密钥时直接复用，优先 LFN 自建的那把。
  const usable = (await listTokens()).filter(
    (item) =>
      item.status === 1 &&
      typeof item.group === "string" &&
      item.group === group &&
      !item.model_limits_enabled,
  );
  let token: Token | undefined =
    usable.find((item) => item.name.startsWith(prefix)) ?? usable[0];

  if (!token) {
    const name = tokenNameFor(prefix, group);
    const created = await fetch(`${baseUrl}/api/token/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        expired_time: -1,
        remain_quota: 0,
        unlimited_quota: true,
        model_limits_enabled: false,
        model_limits: "",
        allow_ips: "",
        group,
        cross_group_retry: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await created.json()) as ApiResult<unknown>;
    if (!result.success)
      throw new Error(result.message || "无法创建 LFN 专用密钥");
    token = (await listTokens()).find(
      (item) => item.name === name && item.status === 1,
    );
  }
  if (!token) throw new Error("LFN 专用密钥创建后未找到");
  const keyResponse = await fetch(`${baseUrl}/api/token/${token.id}/key`, {
    method: "POST",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const keyResult = (await keyResponse.json()) as ApiResult<{ key?: string }>;
  if (!keyResult.success || !keyResult.data?.key)
    throw new Error(keyResult.message || "无法读取 LFN 专用密钥");
  return keyResult.data.key;
}

export function getImageToken(
  session: Session,
  model: string,
): Promise<string> {
  return resolveToken(session, model, LFN_TOKEN_PREFIX);
}

export function getChatToken(
  session: Session,
  model: string,
): Promise<string> {
  return resolveToken(session, model, LFN_CHAT_TOKEN_PREFIX);
}

// 上游会话过期时消息是英文的，前端需要据此提示重新登录而不是展示原文。
export function isUpstreamAuthError(message?: string): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return (
    text.includes("unauthorized") ||
    text.includes("invalid access token") ||
    text.includes("not logged in")
  );
}

// nai-chat 是 Gateway 的文本模型，不能按 nai- 前缀当成图像模型排除。
export function isNaiImageModel(model: string): boolean {
  const name = model.toLowerCase();
  return name.startsWith("nai-") && name !== "nai-chat";
}

export function imageFromResult(result: {
  data?: Array<{ b64_json?: string; url?: string }>;
}): string[] {
  return (result.data || [])
    .map((item) =>
      item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url || "",
    )
    .filter(Boolean);
}
