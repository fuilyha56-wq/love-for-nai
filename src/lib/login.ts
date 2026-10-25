import { NextResponse } from "next/server";
import {
  encodeSession,
  keepLoginTtlMs,
  resolvedSessionCookie,
} from "@/lib/session";
import { resolvedNewApiBaseUrl } from "@/lib/newapi";
import { resolveTrustedClientIp } from "@/lib/risk-ip";
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
  request?: Request,
): Promise<{ response: Response; result: NewApiLoginResponse }> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (request) {
    try {
      const clientIp = (await resolveTrustedClientIp(request)).ip;
      if (clientIp) headers.set("X-Forwarded-For", clientIp);
    } catch {
      // Keep authentication available if proxy metadata cannot be resolved.
    }
  }

  let response: Response;
  try {
    response = await fetch(`${await resolvedNewApiBaseUrl()}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const cause =
      error instanceof Error
        ? (error as Error & { cause?: unknown }).cause
        : undefined;
    const code =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "string"
        ? cause.code
        : undefined;
    console.error("[auth] NewAPI request failed", {
      path,
      errorName: error instanceof Error ? error.name : "UnknownError",
      code,
    });
    throw error;
  }

  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object")
      return { response, result: payload as NewApiLoginResponse };
  } catch {
    // NewAPI's rate limiter can return an empty 429 body. Preserve the HTTP
    // status so the route can return a retryable rate-limit response.
  }
  return {
    response,
    result: {
      success: false,
      message:
        response.status === 429
          ? "账号服务暂时限制了登录请求，请稍后重试"
          : undefined,
    },
  };
}

export function newApiRateLimitResponse(response: Response): NextResponse {
  const retryAfter = response.headers.get("Retry-After")?.trim();
  return NextResponse.json(
    { message: "账号服务暂时限制了登录请求，请稍后重试" },
    {
      status: 429,
      headers: {
        "Retry-After":
          retryAfter && /^\d{1,5}$/.test(retryAfter) ? retryAfter : "60",
      },
    },
  );
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
  remember = false,
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
  const cookie = await resolvedSessionCookie(remember);
  next.cookies.set(
    cookie.name,
    await encodeSession({
      userId: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      upstreamCookie,
      accessToken,
      expiresAt: Date.now() + keepLoginTtlMs(remember),
    }),
    cookie.options,
  );
  return next;
}

export async function establishLocalSession(
  user: LocalUser,
  remember = false,
): Promise<NextResponse> {
  const next = NextResponse.json({
    user: { id: user.id, name: user.displayName || user.username },
  });
  const cookie = await resolvedSessionCookie(remember);
  next.cookies.set(
    cookie.name,
    await encodeSession({
      userId: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      upstreamCookie: "",
      expiresAt: Date.now() + keepLoginTtlMs(remember),
    }),
    cookie.options,
  );
  return next;
}
