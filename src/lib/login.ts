import { NextResponse } from "next/server";
import { encodeSession, resolvedSessionCookie } from "@/lib/session";
import { resolvedNewApiBaseUrl } from "@/lib/newapi";
import type { LocalUser } from "@/lib/local-users";

export type NewApiUser = {
  id?: number;
  username?: string;
  display_name?: string;
  require_2fa?: boolean;
  two_fa_required?: boolean;
};

// 新版 NewAPI 把用户放在 data.user 并返回 access_token，旧版直接用 data。
export type NewApiLoginResponse = {
  success: boolean;
  message?: string;
  data?: NewApiUser & {
    user?: NewApiUser;
    access_token?: string;
    require_2fa?: boolean;
    two_fa_required?: boolean;
    flow_token?: string;
  };
};

export async function callNewApi(
  path: string,
  body: unknown,
): Promise<{ response: Response; result: NewApiLoginResponse }> {
  const response = await fetch(`${await resolvedNewApiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  return { response, result: (await response.json()) as NewApiLoginResponse };
}

export function upstreamCookieOf(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

export function requiresTwoFactor(result: NewApiLoginResponse): boolean {
  const data = result.data;
  if (!data) return false;
  const user = data.user ?? data;
  return Boolean(
    data.require_2fa ||
      data.two_fa_required ||
      user.require_2fa ||
      user.two_fa_required,
  );
}

export async function establishSession(
  result: NewApiLoginResponse,
  response: Response,
): Promise<NextResponse> {
  const data = result.data;
  const user = data?.user ?? data;
  if (!user || typeof user.id !== "number" || !user.username)
    return NextResponse.json(
      { message: "上游未返回可用的账号信息" },
      { status: 502 },
    );

  const accessToken = data?.access_token;
  const upstreamCookie = upstreamCookieOf(response);
  if (!upstreamCookie && !accessToken)
    return NextResponse.json(
      { message: "上游未返回登录会话" },
      { status: 502 },
    );

  const next = NextResponse.json({
    user: { id: user.id, name: user.display_name || user.username },
  });
  const cookie = await resolvedSessionCookie();
  next.cookies.set(
    cookie.name,
    encodeSession({
      userId: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      upstreamCookie,
      accessToken,
      expiresAt: Date.now() + 604800000,
    }),
    cookie.options,
  );
  return next;
}

export async function establishLocalSession(user: LocalUser): Promise<NextResponse> {
  const next = NextResponse.json({
    user: { id: user.id, name: user.displayName || user.username },
  });
  const cookie = await resolvedSessionCookie();
  next.cookies.set(
    cookie.name,
    encodeSession({
      userId: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      upstreamCookie: "",
      expiresAt: Date.now() + 604800000,
    }),
    cookie.options,
  );
  return next;
}
