import { NextResponse } from "next/server";
import { encodeSession, sessionCookie } from "@/lib/session";

type NewApiUser = { id: number; username: string; display_name?: string; require_2fa?: boolean };
type NewApiResponse = { success: boolean; message?: string; data?: NewApiUser };

export async function POST(request: Request) {
  const body = await request.json() as { username?: string; password?: string };
  if (!body.username || !body.password) return NextResponse.json({ message: "请输入用户名和密码" }, { status: 400 });
  try {
    const upstream = await fetch(`${process.env.NEWAPI_BASE_URL || "http://127.0.0.1:3000"}/api/user/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
    const result = await upstream.json() as NewApiResponse;
    if (!result.success || !result.data) return NextResponse.json({ message: result.message || "登录失败" }, { status: 401 });
    if (result.data.require_2fa) return NextResponse.json({ message: "此账号需要两步验证，首版暂请使用其他账号体验" }, { status: 501 });
    const upstreamCookie = upstream.headers.get("set-cookie")?.split(";")[0] || "";
    if (!upstreamCookie) return NextResponse.json({ message: "上游未返回登录会话" }, { status: 502 });
    const user = result.data;
    const response = NextResponse.json({ user: { id: user.id, name: user.display_name || user.username } });
    response.cookies.set(sessionCookie.name, encodeSession({ userId: user.id, username: user.username, displayName: user.display_name || user.username, upstreamCookie, expiresAt: Date.now() + 604800000 }), sessionCookie.options);
    return response;
  } catch { return NextResponse.json({ message: "暂时无法连接账号服务" }, { status: 502 }); }
}