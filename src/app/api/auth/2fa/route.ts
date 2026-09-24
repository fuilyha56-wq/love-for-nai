import { NextResponse } from "next/server";
import { getPendingSession, resolvedPendingCookie } from "@/lib/session";
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
    if (!result.success || !result.data) {
      // 上游单用户活跃登录会话数上限（默认 50）撞满时返回 409。
      if (response.status === 409)
        return NextResponse.json(
          {
            message:
              "该账号的登录会话数已达上限，请稍后再试或联系管理员清理旧会话",
          },
          { status: 409 },
        );
      return NextResponse.json(
        { message: result.message || "验证码不正确" },
        { status: 401 },
      );
    }

    const next = await establishSession(result, response);
    const cookie = await resolvedPendingCookie();
    next.cookies.set(cookie.name, "", {
      ...cookie.options,
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
