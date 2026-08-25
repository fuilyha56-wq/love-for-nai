import { NextResponse } from "next/server";
import { encodeSession, sessionCookie } from "@/lib/session";
import { newApiBaseUrl } from "@/lib/newapi";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

type SelfResponse = {
  success: boolean;
  message?: string;
  data?: {
    id?: number;
    username?: string;
    display_name?: string;
    user?: { id?: number; username?: string; display_name?: string };
  };
};

export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const token = optionalString(raw.token)?.trim() || "";
  if (!token)
    return NextResponse.json({ message: "请输入访问令牌" }, { status: 400 });
  if (token.length > 200)
    return NextResponse.json({ message: "访问令牌格式不正确" }, { status: 400 });

  try {
    // 系统访问令牌可直接鉴权并反查用户，因此不需要用户名。
    const upstream = await fetch(`${newApiBaseUrl()}/api/user/self`, {
      headers: { Authorization: token },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const result = (await upstream.json()) as SelfResponse;
    const user = result.data?.user ?? result.data;
    if (!upstream.ok || !result.success || !user?.id || !user.username)
      return NextResponse.json(
        { message: result.message || "访问令牌无效或已失效" },
        { status: 401 },
      );

    const response = NextResponse.json({
      user: { id: user.id, name: user.display_name || user.username },
    });
    response.cookies.set(
      sessionCookie.name,
      encodeSession({
        userId: user.id,
        username: user.username,
        displayName: user.display_name || user.username,
        upstreamCookie: "",
        systemToken: token,
        expiresAt: Date.now() + 604800000,
      }),
      sessionCookie.options,
    );
    return response;
  } catch {
    return NextResponse.json(
      { message: "暂时无法连接账号服务" },
      { status: 502 },
    );
  }
}
