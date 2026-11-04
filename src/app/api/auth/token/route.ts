import { resolvedAuthProviderId } from "@/lib/platform";
import { getRuntimeSettings } from "@/lib/runtime-config";
import { NextResponse } from "next/server";
import { encodeSession, keepLoginTtlMs, resolvedSessionCookie } from "@/lib/session";
import { resolvedNewApiBaseUrl } from "@/lib/newapi";
import { newApiIdentity } from "@/lib/newapi-user";
import { readUpstreamJson, upstreamClientHeaders, upstreamFailureResponse } from "@/lib/upstream-request";
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
  if (!(await getRuntimeSettings()).tokenLoginEnabled) return NextResponse.json({ message: "站点已关闭令牌登录" }, { status: 403 });
  if ((await resolvedAuthProviderId()) === "local") return NextResponse.json({ message: "本地账号不支持令牌登录" }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const token = (optionalString(raw.token)?.trim() || "").replace(/^Bearer\s+/i, "");
  if (!token)
    return NextResponse.json({ message: "请输入访问令牌" }, { status: 400 });
  if (token.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(token))
    return NextResponse.json({ message: "访问令牌格式不正确" }, { status: 400 });
  const remember = raw.remember === true;

  try {
    // 系统访问令牌可直接鉴权并反查用户，因此不需要用户名。
    const upstream = await fetch(`${await resolvedNewApiBaseUrl()}/api/user/self`, {
      headers: { Authorization: token, ...await upstreamClientHeaders() },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const result = await readUpstreamJson<SelfResponse>(upstream, "登录账号");
    if (upstream.status >= 500) return NextResponse.json({ message: "账号服务暂时不可用，请稍后重试" }, { status: 502 });
    const user = newApiIdentity(result.data);
    if (!upstream.ok || result.success !== true || !user)
      return NextResponse.json(
        { message: result.message || "访问令牌无效或已失效" },
        { status: 401 },
      );

    const response = NextResponse.json({
      user: { id: user.id, name: user.display_name || user.username },
    });
    const cookie = await resolvedSessionCookie(remember);
    response.cookies.set(
      cookie.name,
      await encodeSession({
        userId: user.id,
        username: user.username,
        displayName: user.display_name || user.username,
        upstreamCookie: "",
        systemToken: token,
        expiresAt: Date.now() + keepLoginTtlMs(remember),
      }),
      cookie.options,
    );
    return response;
  } catch (error) {
    return upstreamFailureResponse(error);
  }
}
