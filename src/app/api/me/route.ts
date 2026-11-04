import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { resolvedNewApiBaseUrl, userHeaders } from "@/lib/newapi";
import { fetchNewApiSelf } from "@/lib/shared-user-self";
import { readUpstreamJson, RateLimitError } from "@/lib/upstream-request";
import { findLocalUserById, updateLocalUser } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ authenticated: false });
  if (session.upstreamRetryAt && session.upstreamRetryAt > Date.now()) {
    return NextResponse.json({
      authenticated: true,
      upstreamUnavailable: true,
      retryAfter: Math.max(1, Math.ceil((session.upstreamRetryAt - Date.now()) / 1000)),
      message: "账号服务暂时繁忙，登录身份已保留，请稍后重试。",
      user: { id: session.userId, username: session.username, displayName: session.displayName, name: session.displayName, email: "", group: "未知", balance: null },
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (await resolvedAuthProviderId() === "local") {
    const user = await findLocalUserById(session.userId);
    if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email || "",
        name: user.displayName,
        group: user.group,
        balance: null,
      },
    });
  }
  try {
    const upstream = await fetchNewApiSelf(await resolvedNewApiBaseUrl(), userHeaders(session));
    if (upstream.status === 401 || upstream.status === 403)
      return NextResponse.json({ authenticated: false, sessionExpired: true }, { status: 401 });
    const result = await readUpstreamJson<{ success?: boolean; data?: { user?: Record<string, unknown> } & Record<string, unknown> }>(upstream, "读取账号资料");
    if (!upstream.ok || result.success !== true || !result.data) throw new Error("账号资料暂不可读");
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
  } catch (error) {
    return NextResponse.json({
      authenticated: true,
      upstreamUnavailable: true,
      message: "账号服务暂时繁忙，登录身份已保留，请稍后重试。",
      ...(error instanceof RateLimitError ? { retryAfter: error.retryAfter } : {}),
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
    if (await resolvedAuthProviderId() === "local") {
      const user = await updateLocalUser(session.userId, {
        displayName,
        username: username || undefined,
      });
      return NextResponse.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName } });
    }
    const upstream = await fetch(`${await resolvedNewApiBaseUrl()}/api/user/self`, {
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
