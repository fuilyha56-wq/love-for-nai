import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

type Token = { id: number; name: string; status: number };
type ApiResult<T> = { success: boolean; message?: string; data?: T };
type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function userHeaders(session: Session) {
  return {
    Cookie: session.upstreamCookie,
    "New-Api-User": String(session.userId),
    "Content-Type": "application/json",
  };
}

async function getGenerationKey(
  baseUrl: string,
  session: Session,
): Promise<string> {
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
        model_limits_enabled: true,
        model_limits: "nai-v5-full,nai-v5-curated,nai-v4.5-full,nai-v3",
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

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录后生成" }, { status: 401 });
  const body = (await request.json()) as {
    model?: string;
    prompt?: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    scale?: number;
  };
  if (!body.model || !body.prompt || !body.width || !body.height)
    return NextResponse.json({ message: "生成参数不完整" }, { status: 400 });
  const allowedModels = new Set([
    "nai-v5-full",
    "nai-v5-curated",
    "nai-v4.5-full",
    "nai-v3",
  ]);
  if (!allowedModels.has(body.model))
    return NextResponse.json(
      { message: "当前模型不允许使用" },
      { status: 400 },
    );

  const baseUrl = process.env.NEWAPI_BASE_URL || "http://127.0.0.1:3000";
  try {
    const key = await getGenerationKey(baseUrl, session);
    const upstream = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model,
        prompt: body.prompt,
        negative_prompt: body.negativePrompt || "",
        width: body.width,
        height: body.height,
        size: `${body.width}x${body.height}`,
        steps: body.steps || 28,
        scale: body.scale || 5,
        n: 1,
        response_format: "b64_json",
      }),
      cache: "no-store",
    });
    const result = await upstream.json();
    if (!upstream.ok || result.error)
      return NextResponse.json(
        { message: result.error?.message || result.message || "上游生成失败" },
        { status: upstream.status || 502 },
      );
    const image = result.data?.[0];
    if (!image?.b64_json && !image?.url)
      return NextResponse.json({ message: "上游未返回图片" }, { status: 502 });
    return NextResponse.json({
      image: image.b64_json
        ? `data:image/png;base64,${image.b64_json}`
        : image.url,
      usage: result.usage || null,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "生成请求失败" },
      { status: 502 },
    );
  }
}
