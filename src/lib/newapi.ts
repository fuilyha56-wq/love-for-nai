import { getSession } from "@/lib/session";
import { fetchNewApiSelf } from "@/lib/shared-user-self";
import {
  runtimeAdminToken,
  runtimeAffGateway,
  runtimeImageUpstream,
  runtimeNaiAccountUpstream,
  runtimeNaiImageUpstream,
  runtimeNewApiBaseUrl,
  type NaiNativeUpstream,
} from "@/lib/runtime-config";

type Token = {
  id: number;
  name: string;
  status: number;
  group?: string;
  model_limits_enabled?: boolean;
  model_limits?: string;
  expired_time?: number;
  remain_quota?: number;
  unlimited_quota?: boolean;
  allow_ips?: string | null;
  deleted_at?: unknown;
};
type ApiResult<T> = { success: boolean; message?: string; data?: T };
export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const LFN_TOKEN_PREFIX = "lfn-image-studio";
const LFN_CHAT_TOKEN_PREFIX = "lfn-assistant";

// 生成密钥本身是 NewAPI 的管理操作：一次请求会触发多次用户/分组/密钥查询。
// 密钥默认长期有效，因此在单个 Web 进程内短时间复用即可显著减少上游请求，
// 同时用 TTL 避免管理员禁用密钥后长期使用旧缓存。
const TOKEN_CACHE_TTL_MS = 15 * 60 * 1000;
const TOKEN_CACHE_MAX_ENTRIES = 256;
type TokenCacheEntry = {
  token?: string;
  expiresAt: number;
  pending?: Promise<string>;
};
// Next 的各个路由可能打包出独立模块；缓存与创建锁必须在进程内共享。
const tokenState = globalThis as typeof globalThis & {
  lfnNewApiTokens?: Map<string, TokenCacheEntry>;
  lfnNewApiTokenLocks?: Map<string, Promise<unknown>>;
};
const tokenCache = (tokenState.lfnNewApiTokens ??= new Map());
const tokenLocks = (tokenState.lfnNewApiTokenLocks ??= new Map());

async function withTokenLock<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = tokenLocks.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(action);
  tokenLocks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (tokenLocks.get(key) === pending) tokenLocks.delete(key);
  }
}

// AFF 支付直连 Gateway：返回 { baseUrl, token }；未配置时返回 null。
export function affGateway(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.LFN_AFF_GATEWAY_URL?.trim().replace(/\/+$/, "");
  const token = process.env.LFN_AFF_GATEWAY_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function resolvedAffGateway(): Promise<{
  baseUrl: string;
  token: string;
} | null> {
  try {
    return await runtimeAffGateway();
  } catch {
    return affGateway();
  }
}

export async function resolvedImageUpstream(): Promise<{
  baseUrl: string;
  token: string;
} | null> {
  try {
    const upstream = await runtimeImageUpstream();
    if (upstream) return { baseUrl: upstream.baseUrl, token: upstream.token };
  } catch {
    // fall through to environment
  }
  return affGateway() || genericImageFromEnv();
}

function trimNativeBase(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") || "";
}

function naiAccountFromEnv(): NaiNativeUpstream | null {
  const baseUrl =
    trimNativeBase(process.env.LFN_NAI_API_URL) ||
    trimNativeBase(process.env.LFN_AFF_GATEWAY_URL);
  const token =
    process.env.LFN_NAI_API_TOKEN?.trim() ||
    process.env.LFN_AFF_GATEWAY_TOKEN?.trim() ||
    "";
  return baseUrl && token ? { baseUrl, token } : null;
}

function naiImageFromEnv(): NaiNativeUpstream | null {
  const imageUrl = trimNativeBase(process.env.LFN_NAI_IMAGE_API_URL);
  const imageToken = process.env.LFN_NAI_IMAGE_API_TOKEN?.trim() || "";
  if (imageUrl && imageToken) return { baseUrl: imageUrl, token: imageToken };
  if (imageUrl) {
    const fallback =
      process.env.LFN_NAI_API_TOKEN?.trim() ||
      process.env.LFN_AFF_GATEWAY_TOKEN?.trim() ||
      "";
    if (fallback) return { baseUrl: imageUrl, token: fallback };
  }
  return naiAccountFromEnv();
}

export async function resolvedNaiAccountUpstream(): Promise<NaiNativeUpstream | null> {
  try {
    const upstream = await runtimeNaiAccountUpstream();
    if (upstream) return upstream;
  } catch {
    // fall through to environment
  }
  return naiAccountFromEnv();
}

export async function resolvedNaiImageUpstream(): Promise<NaiNativeUpstream | null> {
  try {
    const upstream = await runtimeNaiImageUpstream();
    if (upstream) return upstream;
  } catch {
    // fall through to environment
  }
  return naiImageFromEnv();
}

function genericImageFromEnv(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.LFN_IMAGE_PROVIDER_URL?.trim().replace(
    /\/+$/,
    "",
  );
  const token = process.env.LFN_IMAGE_PROVIDER_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
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

export async function readUsableGroups(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/user/self/groups`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json()) as ApiResult<
    Record<string, unknown> | string[]
  >;
  if (!response.ok || !result.success || !result.data)
    throw new Error(result.message || "无法读取可用分组，请稍后重试");
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
  const result = (await response.json()) as {
    data?: Array<{ model_name?: string; enable_groups?: string[] }>;
    message?: string;
  };
  if (!response.ok || !Array.isArray(result.data))
    throw new Error(result.message || "无法读取模型分组，请稍后重试");
  const entry = result.data?.find((item) => item.model_name === model);
  return entry?.enable_groups?.filter((item) => typeof item === "string") ?? [];
}

export const LFN_MODEL_GROUP = "ikun";

export function selectModelGroup(
  modelGroups: string[],
  usableGroups: string[],
  selfGroup?: string,
  requiredGroup?: string,
): string | undefined {
  const owned = new Set(
    [...(selfGroup ? [selfGroup] : []), ...usableGroups].filter(Boolean),
  );
  const preferred =
    requiredGroup &&
    owned.has(requiredGroup) &&
    modelGroups.some(
      (item) => item.toLowerCase() === requiredGroup.toLowerCase(),
    )
      ? requiredGroup
      : undefined;
  return preferred ?? modelGroups.find((item) => owned.has(item));
}

async function resolveToken(
  session: Session,
  model: string,
  prefix: string,
  requiredGroup?: string,
  baseUrl = newApiBaseUrl(),
  strictGroup = false,
): Promise<string> {
  const headers = userHeaders(session);
  const selfResponse = await fetchNewApiSelf(baseUrl, headers);
  const selfResult = (await selfResponse.json()) as ApiResult<{
    group?: string;
    user?: { group?: string };
  }>;
  if (!selfResponse.ok || !selfResult.success)
    throw new Error(selfResult.message || "无法读取用户分组");
  const selfGroup = selfResult.data?.user?.group ?? selfResult.data?.group;

  const [modelGroups, usableGroups] = await Promise.all([
    readModelGroups(baseUrl, headers, model),
    readUsableGroups(baseUrl, headers),
  ]);
  // 不再硬性要求特定分组（历史上是 ikun，但 NewAPI 上未必存在该分组的
  // 渠道）：优先取模型确实开放且用户可用的固定分组，否则在模型可用的
  // 渠道分组里挑一个当前用户有权使用的，保证没有图包余额、走 NewAPI
  // 计费的用户也能正常生图。
  const group = selectModelGroup(
    modelGroups,
    usableGroups,
    selfGroup,
    requiredGroup,
  );
  if (strictGroup && group !== requiredGroup)
    throw new Error("所选分组不支持此模型或当前账号无权使用，请刷新模型列表");
  if (!group) {
    if (!modelGroups.length) throw new Error(`模型 ${model} 当前不可用`);
    throw new Error(
      `当前账号没有 ${modelGroups.join(" / ")} 分组权限，无法使用 ${model}`,
    );
  }
  const listTokens = async (): Promise<Token[]> => {
    const tokens = new Map<number, Token>();
    for (let page = 1; page <= 1000; page++) {
      const response = await fetch(
        `${baseUrl}/api/token/?p=${page}&page_size=100&size=100`,
        {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      const result = (await response.json()) as ApiResult<
        { items?: Token[]; total?: number } | Token[]
      >;
      if (!response.ok || !result.success || !result.data)
        throw new Error(
          result.message || "无法读取 API 密钥，请重新登录或稍后重试",
        );
      const items = Array.isArray(result.data)
        ? result.data
        : result.data.items;
      if (!Array.isArray(items))
        throw new Error("API 密钥列表不完整，未创建新密钥");
      const total = Array.isArray(result.data) ? undefined : result.data.total;
      const previousSize = tokens.size;
      for (const item of items) tokens.set(item.id, item);
      if (typeof total === "number" && tokens.size >= total)
        return [...tokens.values()];
      if (!items.length) {
        if (typeof total === "number" && tokens.size < total)
          throw new Error("API 密钥列表不完整，未创建新密钥");
        return [...tokens.values()];
      }
      if (tokens.size === previousSize)
        throw new Error("API 密钥分页异常，未创建新密钥");
      // 老版本直接返回数组或不带总数；短页表示查询结束。
      if (total === undefined && items.length < 100)
        return [...tokens.values()];
    }
    throw new Error("API 密钥列表过大，未创建新密钥");
  };

  // 助手先检查所有兼容分组的已有密钥，再决定是否创建；不能因为模型
  // 的第一个分组没有密钥，就忽略另一个兼容分组中用户已经持有的密钥。
  const compatibleGroups =
    prefix === LFN_CHAT_TOKEN_PREFIX && !strictGroup
      ? new Set(
          modelGroups.filter((item) =>
            [selfGroup, ...usableGroups].includes(item),
          ),
        )
      : new Set([group]);
  const isUsable = (item: Token) =>
    item.status === 1 &&
    !item.deleted_at &&
    compatibleGroups.has(item.group || selfGroup || "") &&
    (item.expired_time == null ||
      item.expired_time === -1 ||
      item.expired_time > Date.now() / 1000) &&
    (item.unlimited_quota !== false || (item.remain_quota ?? 0) > 0) &&
    !item.allow_ips?.trim() &&
    (!item.model_limits_enabled ||
      (item.model_limits || "")
        .split(",")
        .map((value) => value.trim())
        .includes(model));
  const usable = (await listTokens()).filter(isUsable);
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
    if (!created.ok || !result.success)
      throw new Error(result.message || "无法创建 LFN 专用密钥");
    token = (await listTokens()).find(
      (item) =>
        item.name === name &&
        (item.group || selfGroup) === group &&
        isUsable(item),
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
  if (!keyResponse.ok || !keyResult.success || !keyResult.data?.key)
    throw new Error(keyResult.message || "无法读取 LFN 专用密钥");
  const key = keyResult.data.key.trim();
  if (!key || /[*…\s\u0000-\u001f\u007f]/.test(key))
    throw new Error("NewAPI 未返回完整密钥，请检查密钥读取权限");
  return key;
}

function tokenCacheKey(
  session: Session,
  model: string,
  prefix: string,
  baseUrl: string,
  requiredGroup?: string,
): string {
  return `${baseUrl}|${session.userId}|${prefix}|${model}|${requiredGroup || "auto"}`;
}

function pruneTokenCache(now: number): void {
  for (const [key, entry] of tokenCache) {
    if (!entry.pending && entry.expiresAt <= now) tokenCache.delete(key);
  }
  while (tokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
    const evictable = [...tokenCache.entries()].find(
      ([, entry]) => !entry.pending,
    );
    if (!evictable) break;
    tokenCache.delete(evictable[0]);
  }
}

async function cachedToken(
  session: Session,
  model: string,
  prefix: string,
  requiredGroup?: string,
  strictGroup = false,
): Promise<string> {
  // baseUrl 也放进 key，运行时切换 NewAPI 后不会误用旧实例密钥。
  const baseUrl = await resolvedNewApiBaseUrl();
  const key = tokenCacheKey(session, model, prefix, baseUrl, requiredGroup) + (strictGroup ? "|selected" : "");
  const now = Date.now();
  const existing = tokenCache.get(key);
  if (existing?.pending) return existing.pending;
  if (existing?.token && existing.expiresAt > now)
    return Promise.resolve(existing.token);

  pruneTokenCache(now);
  const entry: TokenCacheEntry = { expiresAt: now + TOKEN_CACHE_TTL_MS };
  const pending = withTokenLock(`${baseUrl}|${session.userId}`, () =>
    resolveToken(session, model, prefix, requiredGroup, baseUrl, strictGroup),
  );
  entry.pending = pending;
  tokenCache.set(key, entry);
  void pending.then(
    (token) => {
      if (tokenCache.get(key) !== entry) return;
      entry.token = token;
      entry.expiresAt = Date.now() + TOKEN_CACHE_TTL_MS;
      delete entry.pending;
    },
    () => {
      if (tokenCache.get(key) === entry) tokenCache.delete(key);
    },
  );
  return pending;
}

export function getImageToken(
  session: Session,
  model: string,
): Promise<string> {
  return cachedToken(session, model, LFN_TOKEN_PREFIX, LFN_MODEL_GROUP);
}

export function getChatToken(session: Session, model: string, group?: string): Promise<string> {
  return cachedToken(session, model, LFN_CHAT_TOKEN_PREFIX, group || LFN_MODEL_GROUP, Boolean(group));
}

export function getStoryToken(
  session: Session,
  model: string,
): Promise<string> {
  return cachedToken(session, model, LFN_CHAT_TOKEN_PREFIX, LFN_MODEL_GROUP);
}

/** 只清除被拒绝的旧密钥；重新查全用户已有密钥，不因一次鉴权错误盲目新建。 */
export async function refreshChatToken(
  session: Session,
  model: string,
  rejectedKey: string,
  group?: string,
): Promise<string> {
  const baseUrl = await resolvedNewApiBaseUrl();
  const scope = `${baseUrl}|${session.userId}|`;
  for (const [key, entry] of tokenCache) {
    if (key.startsWith(scope) && entry.token === rejectedKey)
      tokenCache.delete(key);
  }
  return getChatToken(session, model, group);
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
