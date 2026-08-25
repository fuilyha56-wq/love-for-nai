import { getSession } from "@/lib/session";

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

// 绘图渠道只服务这些分组；Draw-Limit 由管理员分配，用户不可自选。
const DRAW_GROUPS = ["Draw", "Draw-Limit", "Draw-Limit-2"];
const LFN_TOKEN_NAME = "lfn-image-studio";

export function newApiBaseUrl(): string {
  return process.env.NEWAPI_BASE_URL || "http://127.0.0.1:3000";
}

export function userHeaders(session: Session): Record<string, string> {
  return {
    Cookie: session.upstreamCookie,
    "New-Api-User": String(session.userId),
    "Content-Type": "application/json",
    // 新版 NewAPI 控制台接口只认 access token，Cookie 仅用于刷新。
    ...(session.accessToken
      ? { Authorization: `Bearer ${session.accessToken}` }
      : {}),
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

// 绘图密钥必须落在绘图分组上，否则 NewAPI 会以 no available channel 拒绝。
function pickDrawGroup(candidates: Array<string | undefined>): string | null {
  const available = candidates.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  for (const group of DRAW_GROUPS) {
    if (available.includes(group)) return group;
  }
  return null;
}

export async function getImageToken(session: Session): Promise<string> {
  const baseUrl = newApiBaseUrl();
  const headers = userHeaders(session);
  const selfResponse = await fetch(`${baseUrl}/api/user/self`, {
    headers,
    cache: "no-store",
  });
  const selfResult = (await selfResponse.json()) as ApiResult<{
    group?: string;
    user?: { group?: string };
  }>;
  if (!selfResult.success)
    throw new Error(selfResult.message || "无法读取用户分组");
  const selfGroup = selfResult.data?.user?.group ?? selfResult.data?.group;

  const listTokens = async (): Promise<Token[]> => {
    const response = await fetch(`${baseUrl}/api/token/?p=1&size=100`, {
      headers,
      cache: "no-store",
    });
    const result = (await response.json()) as ApiResult<
      { items?: Token[] } | Token[]
    >;
    if (!result.success) throw new Error(result.message || "无法读取 API 密钥");
    return Array.isArray(result.data) ? result.data : result.data?.items || [];
  };

  const tokens = await listTokens();
  const usableDrawTokens = tokens.filter(
    (item) =>
      item.status === 1 &&
      typeof item.group === "string" &&
      DRAW_GROUPS.includes(item.group) &&
      !item.model_limits_enabled,
  );
  // 已有可用绘图密钥时直接复用，优先 LFN 自建的那把。
  let token: Token | undefined =
    usableDrawTokens.find((item) => item.name === LFN_TOKEN_NAME) ??
    usableDrawTokens[0];

  if (!token) {
    const usableGroups = await readUsableGroups(baseUrl, headers);
    const group = pickDrawGroup([selfGroup, ...usableGroups]);
    if (!group)
      throw new Error(
        "当前账号没有绘图分组权限，请联系管理员加入 Draw 或 Draw-Limit 分组",
      );
    const created = await fetch(`${baseUrl}/api/token/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: LFN_TOKEN_NAME,
        expired_time: -1,
        remain_quota: 0,
        unlimited_quota: true,
        model_limits_enabled: false,
        model_limits: "",
        allow_ips: "",
        group,
        cross_group_retry: false,
      }),
    });
    const result = (await created.json()) as ApiResult<unknown>;
    if (!result.success)
      throw new Error(result.message || "无法创建 LFN 专用密钥");
    token = (await listTokens()).find(
      (item) => item.name === LFN_TOKEN_NAME && item.status === 1,
    );
  }
  if (!token) throw new Error("LFN 专用密钥创建后未找到");
  const keyResponse = await fetch(`${baseUrl}/api/token/${token.id}/key`, {
    method: "POST",
    headers,
    cache: "no-store",
  });
  const keyResult = (await keyResponse.json()) as ApiResult<{ key?: string }>;
  if (!keyResult.success || !keyResult.data?.key)
    throw new Error(keyResult.message || "无法读取 LFN 专用密钥");
  return keyResult.data.key;
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
