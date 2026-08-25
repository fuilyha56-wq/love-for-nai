import { NextResponse } from "next/server";
import { encodePendingSession, pendingCookie } from "@/lib/session";
import { callNewApi, establishSession, requiresTwoFactor } from "@/lib/login";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const username = optionalString(raw.username)?.trim();
  const password = optionalString(raw.password);
  if (!username || !password)
    return NextResponse.json(
      { message: "请输入用户名和密码" },
      { status: 400 },
    );

  try {
    const { response, result } = await callNewApi("/api/user/login", {
      username,
      password,
    });
    if (!result.success || !result.data)
      return NextResponse.json(
        { message: result.message || "登录失败" },
        { status: 401 },
      );

    if (requiresTwoFactor(result)) {
      const flowToken = result.data.flow_token;
      if (!flowToken)
        return NextResponse.json(
          { message: "上游未返回两步验证令牌" },
          { status: 502 },
        );
      const next = NextResponse.json({ twoFactorRequired: true });
      next.cookies.set(
        pendingCookie.name,
        encodePendingSession({
          flowToken,
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
