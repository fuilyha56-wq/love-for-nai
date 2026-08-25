import { NextResponse } from "next/server";
import { getPendingSession, pendingCookie } from "@/lib/session";
import { callNewApi, establishSession } from "@/lib/login";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

export async function POST(request: Request) {
  const pending = await getPendingSession();
  if (!pending)
    return NextResponse.json(
      { message: "两步验证会话已过期，请重新登录" },
      { status: 401 },
    );

  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  // 备用码只在上游存哈希，格式未知，这里只做长度与字符集兜底。
  const code = optionalString(raw.code)?.trim().replace(/\s+/g, "") || "";
  if (!/^[A-Za-z0-9-]{6,32}$/.test(code))
    return NextResponse.json(
      { message: "请输入 6 位验证码或备用恢复码" },
      { status: 400 },
    );

  try {
    const { response, result } = await callNewApi("/api/user/login/2fa", {
      flow_token: pending.flowToken,
      code,
    });
    if (!result.success || !result.data)
      return NextResponse.json(
        { message: result.message || "验证码不正确" },
        { status: 401 },
      );

    const next = establishSession(result, response);
    next.cookies.set(pendingCookie.name, "", {
      ...pendingCookie.options,
      maxAge: 0,
    });
    return next;
  } catch {
    return NextResponse.json(
      { message: "暂时无法连接账号服务" },
      { status: 502 },
    );
  }
}
