import { NextResponse } from "next/server";
import { bindExternalApiKey } from "@/lib/external-api-bindings";
import { getSession } from "@/lib/session";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

// 只绑定当前登录用户自己名下的 NewAPI token ID；不接受客户端直接提交的
// Bearer key，避免把他人的 key 绑定到当前用户的 LFN 账本。
export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后绑定 API 密钥", sessionExpired: true },
      { status: 401 },
    );
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const tokenId = raw.tokenId;
  if (
    typeof tokenId !== "number" ||
    !Number.isSafeInteger(tokenId) ||
    tokenId <= 0
  )
    return NextResponse.json({ message: "缺少合法的 tokenId" }, { status: 400 });

  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/token/${tokenId}/key`, {
      method: "POST",
      headers: userHeaders(session),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await upstream.json()) as {
      success?: boolean;
      message?: string;
      data?: { key?: string };
    };
    if (!upstream.ok || !result.success || !result.data?.key)
      return NextResponse.json(
        { message: result.message || "该 token 不属于当前账号或无法读取" },
        { status: upstream.status || 403 },
      );
    const publicKey = result.data.key.startsWith("sk-")
      ? result.data.key
      : `sk-${result.data.key}`;
    await bindExternalApiKey(session.userId, `Bearer ${publicKey}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "API 密钥绑定失败" },
      { status: 502 },
    );
  }
}
