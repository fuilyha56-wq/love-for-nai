import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ authenticated: false });
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/user/self`, {
      headers: userHeaders(session),
      cache: "no-store",
    });
    const result = await upstream.json();
    if (!result.success)
      return NextResponse.json({ authenticated: false }, { status: 401 });
    const user = result.data?.user ?? result.data;
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name || user.username,
        email: user.email || "",
        name: user.display_name || user.username,
        group: user.group,
        balance:
          Number(user.quota || 0) /
          Number(process.env.QUOTA_PER_UNIT || 500000),
      },
    });
  } catch {
    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.userId,
        username: session.username,
        displayName: session.displayName,
        email: "",
        name: session.displayName,
        group: "未知",
        balance: null,
      },
    });
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后修改个人资料" },
      { status: 401 },
    );
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const displayName = optionalString(raw.displayName)?.trim() || "";
  const username = optionalString(raw.username)?.trim() || "";
  if (displayName.length < 1 || displayName.length > 40)
    return NextResponse.json(
      { message: "显示名称需为 1–40 个字符" },
      { status: 400 },
    );
  if (username && !/^[a-zA-Z0-9_\-.]{3,32}$/.test(username))
    return NextResponse.json(
      { message: "用户名需为 3–32 位字母、数字或 _-." },
      { status: 400 },
    );
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/user/self`, {
      method: "PUT",
      headers: userHeaders(session),
      body: JSON.stringify({
        id: session.userId,
        username: username || session.username,
        display_name: displayName,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json();
    if (!upstream.ok || !result.success)
      return NextResponse.json(
        { message: result.message || "个人资料更新失败" },
        { status: upstream.status || 502 },
      );
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { message: "暂时无法连接账号服务" },
      { status: 502 },
    );
  }
}
