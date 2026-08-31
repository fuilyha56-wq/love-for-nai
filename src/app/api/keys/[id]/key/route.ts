import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, newApiBaseUrl, userHeaders } from "@/lib/newapi";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后复制密钥", sessionExpired: true },
      { status: 401 },
    );

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ message: "无效的密钥 ID" }, { status: 400 });

  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/token/${id}/key`, {
      method: "POST",
      headers: userHeaders(session),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await upstream.json()) as {
      success: boolean;
      message?: string;
      data?: { key?: string };
    };
    if (!upstream.ok || !result.success || !result.data?.key)
      throw new Error(result.message || "无法读取密钥明文");
    // 上游返回裸密钥，调用方按 OpenAI 习惯需要 sk- 前缀。
    const key = result.data.key;
    return NextResponse.json({ key: key.startsWith("sk-") ? key : `sk-${key}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取密钥明文";
    if (isUpstreamAuthError(message))
      return NextResponse.json(
        { message: "登录状态已过期，请重新登录", sessionExpired: true },
        { status: 401 },
      );
    return NextResponse.json({ message }, { status: 502 });
  }
}
