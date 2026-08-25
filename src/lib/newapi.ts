import { getSession } from "@/lib/session";

type Token = { id: number; name: string; status: number };
type ApiResult<T> = { success: boolean; message?: string; data?: T };
export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export function newApiBaseUrl(): string {
  return process.env.NEWAPI_BASE_URL || "http://127.0.0.1:3000";
}

export function userHeaders(session: Session) {
  return {
    Cookie: session.upstreamCookie,
    "New-Api-User": String(session.userId),
    "Content-Type": "application/json",
  };
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
  }>;
  if (!selfResult.success)
    throw new Error(selfResult.message || "无法读取用户分组");

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

  let token = (await listTokens()).find(
    (item) => item.name === "lfn-image-studio" && item.status === 1,
  );
  if (!token) {
    const created = await fetch(`${baseUrl}/api/token/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "lfn-image-studio",
        expired_time: -1,
        remain_quota: 0,
        unlimited_quota: true,
        model_limits_enabled: false,
        model_limits: "",
        allow_ips: "",
        group: selfResult.data?.group || "default",
        cross_group_retry: false,
      }),
    });
    const result = (await created.json()) as ApiResult<unknown>;
    if (!result.success)
      throw new Error(result.message || "无法创建 LFN 专用密钥");
    token = (await listTokens()).find(
      (item) => item.name === "lfn-image-studio" && item.status === 1,
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
