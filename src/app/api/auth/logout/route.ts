import { NextResponse } from "next/server";
import {
  getSession,
  resolvedPendingCookie,
  resolvedSessionCookie,
} from "@/lib/session";
import { resolvedNewApiBaseUrl } from "@/lib/newapi";
import type { LfnSession } from "@/lib/session";

// 撤销上游 NewAPI 登录会话（POST /api/user/auth/logout）。
// 上游按 Bearer access_token 优先、refresh cookie 兜底的顺序撤销；
// 两者都带上可以在 access token 过期后仍完成撤销。
// 撤销失败不阻塞登出——LFN cookie 无论如何都会清除，
// 泄漏的上游会话最迟在其 TTL 后自然过期。
async function revokeUpstreamSession(session: LfnSession | null): Promise<void> {
  if (!session) return;
  // 系统访问令牌登录没有上游登录会话，无需撤销。
  if (session.systemToken) return;
  if (!session.upstreamCookie && !session.accessToken) return;
  try {
    await fetch(`${await resolvedNewApiBaseUrl()}/api/user/auth/logout`, {
      method: "POST",
      headers: {
        "New-Api-User": String(session.userId),
        ...(session.upstreamCookie ? { Cookie: session.upstreamCookie } : {}),
        ...(session.accessToken
          ? { Authorization: `Bearer ${session.accessToken}` }
          : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // 网络错误或上游不可用时忽略，登出流程继续。
  }
}

export async function POST() {
  const session = await getSession();
  await revokeUpstreamSession(session);
  const response = NextResponse.json({ success: true });
  const [sessionCookie, pendingCookie] = await Promise.all([
    resolvedSessionCookie(),
    resolvedPendingCookie(),
  ]);
  for (const cookie of [sessionCookie, pendingCookie])
    response.cookies.set(cookie.name, "", { ...cookie.options, maxAge: 0 });
  return response;
}
