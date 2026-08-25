import { NextResponse } from "next/server";
import { encodePendingSession, pendingCookie } from "@/lib/session";
import {
  callNewApi,
  establishSession,
  requiresTwoFactor,
  upstreamCookieOf,
} from "@/lib/login";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    username?: string;
    password?: string;
  };
  if (!body.username || !body.password)
    return NextResponse.json(
      { message: "请输入用户名和密码" },
      { status: 400 },
    );

  try {
    const { response, result } = await callNewApi("/api/user/login", body);
    if (!result.success || !result.data)
      return NextResponse.json(
        { message: result.message || "登录失败" },
        { status: 401 },
      );

    if (requiresTwoFactor(result)) {
      const pending = upstreamCookieOf(response);
      if (!pending)
        return NextResponse.json(
          { message: "上游未返回两步验证会话" },
          { status: 502 },
        );
      const next = NextResponse.json({ twoFactorRequired: true });
      next.cookies.set(
        pendingCookie.name,
        encodePendingSession({
          upstreamCookie: pending,
          expiresAt: Date.now() + 300_000,
        }),
        pendingCookie.options,
      );
      return next;
    }

    return establishSession(result, response);
  } catch {
    return NextResponse.json(
      { message: "暂时无法连接账号服务" },
      { status: 502 },
    );
  }
}
