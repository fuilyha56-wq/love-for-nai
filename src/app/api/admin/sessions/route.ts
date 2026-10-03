import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidJsonResponse, optionalNumber, parseJsonBody } from "@/lib/request";
import {
  getRuntimeSettings,
  updateRuntimeSettings,
} from "@/lib/runtime-config";
import {
  ACTIVE_SESSION_WARNING_THRESHOLD,
  countNewApiActiveSessions,
  listNewApiUserSessions,
  listNewApiUsersOverSessionThreshold,
  revokeNewApiUserSessions,
  revokeNewApiUsersOverSessionThreshold,
} from "@/lib/newapi-sessions";
import { newApiDbConfigured } from "@/lib/newapi-db";

// 管理员清理登录状态：
// 1. 递增 LFN 会话纪元 → 所有已签发的 lfn_session cookie 立即失效（LFN 侧全清）。
// 2. upstream !== false 且配置了 NEWAPI_DB_URL 时，直查上游 NewAPI 的
//    user_sessions 表，把该用户（或全部用户）的活跃登录会话置为 revoked，
//    上游侧同步清空——否则用户重新登录仍会撞上游单用户会话数上限（409）。
//    未配置数据库（不接管上游会话）时跳过上游清理；配置了但清理失败
//    则不递增纪元并直接报错，不允许只清一半：
//    那正是「管理员清理后仍然无法登录」的旧问题。
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });

  let raw: Record<string, unknown> = {};
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const userId = optionalNumber(raw.userId);
  const overThreshold = raw.overThreshold === true;
  const requestedThreshold = optionalNumber(raw.threshold);
  const threshold = requestedThreshold ?? ACTIVE_SESSION_WARNING_THRESHOLD;
  const upstream = raw.upstream !== false;
  if (userId != null && (!Number.isInteger(userId) || userId <= 0))
    return NextResponse.json({ message: "用户 ID 无效" }, { status: 400 });
  if (!Number.isInteger(threshold) || threshold < 0)
    return NextResponse.json({ message: "会话阈值无效" }, { status: 400 });
  if (overThreshold && userId != null)
    return NextResponse.json(
      { message: "超阈值批量清理不能同时指定用户 ID" },
      { status: 400 },
    );

  if (overThreshold) {
    if (!upstream || !newApiDbConfigured()) {
      return NextResponse.json({
        success: true,
        scope: "over-threshold",
        threshold,
        users: [],
        userCount: 0,
        totalRevoked: 0,
        upstreamSkipped: true,
      });
    }
    try {
      const result = await revokeNewApiUsersOverSessionThreshold(threshold);
      return NextResponse.json({
        success: true,
        scope: "over-threshold",
        threshold,
        users: result.users,
        userCount: result.users.length,
        totalRevoked: result.totalRevoked,
        upstreamSkipped: false,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      return NextResponse.json(
        { message: `上游会话批量清理失败：${detail || "请检查 NewAPI 数据库连接"}` },
        { status: 502 },
      );
    }
  }

  let upstreamRevoked = 0;
  let upstreamSkipped = false;
  if (upstream) {
    if (!newApiDbConfigured()) {
      // 本地/自管账号等未接管上游会话的部署：只清 LFN 侧。
      upstreamSkipped = true;
    } else {
      try {
        upstreamRevoked = await revokeNewApiUserSessions(userId ?? null);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        return NextResponse.json(
          {
            message: `上游会话清理失败，未递增会话纪元：${detail || "请检查 NewAPI 数据库连接"}`,
          },
          { status: 502 },
        );
      }
    }
  }

  if (userId != null) {
    return NextResponse.json({
      success: true,
      scope: "user",
      userId,
      upstreamRevoked,
      upstreamSkipped,
      // 单用户清理不递增全局纪元；上游会话已吊销即可恢复登录。
    });
  }

  const settings = await getRuntimeSettings();
  const nextEpoch = Math.max(1, Math.floor(settings.sessionEpoch || 1)) + 1;
  await updateRuntimeSettings({ sessionEpoch: nextEpoch });
  return NextResponse.json({
    success: true,
    scope: "all",
    sessionEpoch: nextEpoch,
    upstreamRevoked,
    upstreamSkipped,
  });
}

// 列出上游各用户的活跃登录会话数（定位撞上限的账号）。
export async function GET(request?: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  const settings = await getRuntimeSettings();
  const url = new URL(request?.url || "http://lfn.local/api/admin/sessions");
  const rawThreshold = url.searchParams.get("threshold");
  const requestedThreshold = rawThreshold == null ? NaN : Number(rawThreshold);
  const threshold = Number.isFinite(requestedThreshold) && Number.isInteger(requestedThreshold) && requestedThreshold >= 0
    ? requestedThreshold
    : ACTIVE_SESSION_WARNING_THRESHOLD;
  const overThreshold = url.searchParams.get("overThreshold") === "true";
  let items: Awaited<ReturnType<typeof listNewApiUserSessions>> = [];
  let totalActiveSessions = 0;
  let upstreamError: string | null = null;
  try {
    const [listed, total] = await Promise.all([
      overThreshold
        ? listNewApiUsersOverSessionThreshold(threshold)
        : listNewApiUserSessions(),
      countNewApiActiveSessions(),
    ]);
    items = listed;
    totalActiveSessions = total;
  } catch (error) {
    upstreamError = error instanceof Error ? error.message : "读取失败";
  }
  return NextResponse.json({
    sessionEpoch: settings.sessionEpoch,
    threshold,
    overThreshold,
    items,
    totalActiveSessions,
    upstreamError,
  });
}
