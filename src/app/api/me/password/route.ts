import { NextResponse } from "next/server";
import { getSession, revokeUserSessions, resolvedPendingCookie, resolvedSessionCookie } from "@/lib/session";
import { changeLocalUserPassword } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import { getRuntimeSettings } from "@/lib/runtime-config";
import { createNewApiAuthAdapter } from "@/lib/adapters/auth/newapi";
import { invalidJsonResponse, optionalString, parseJsonBody } from "@/lib/request";

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录后修改密码" }, { status: 401 });

  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const currentPassword = optionalString(raw.currentPassword) || "";
  const newPassword = optionalString(raw.newPassword) || "";
  const confirmPassword = optionalString(raw.confirmPassword) || "";
  if (!currentPassword)
    return NextResponse.json({ message: "请输入当前密码" }, { status: 400 });
  if (newPassword.length < 8 || newPassword.length > 64)
    return NextResponse.json({ message: "新密码需为 8–64 个字符" }, { status: 400 });
  if (newPassword !== confirmPassword)
    return NextResponse.json({ message: "两次输入的新密码不一致" }, { status: 400 });

  try {
    const provider = await resolvedAuthProviderId();
    if (provider === "local") {
      await changeLocalUserPassword(session.userId, currentPassword, newPassword);
    } else {
      const settings = await getRuntimeSettings();
      if (!settings.newApiBaseUrl)
        return NextResponse.json({ message: "NewAPI 账号服务未配置，无法修改密码" }, { status: 502 });
      const adapter = createNewApiAuthAdapter({
        id: "runtime-newapi-auth",
        type: "auth",
        adapterType: "newapi",
        name: "NewAPI 账号",
        enabled: true,
        config: { baseUrl: settings.newApiBaseUrl, token: settings.newApiAdminToken },
        priority: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (!adapter.changePassword)
        return NextResponse.json({ message: "当前账号服务不支持用户自助修改密码，请联系管理员处理" }, { status: 501 });
      await adapter.changePassword(session.userId, currentPassword, newPassword, session.accessToken, session.upstreamCookie);
    }

    await revokeUserSessions(session.userId);
    console.info("[security] password changed; all LFN sessions revoked", {
      userId: session.userId,
      provider,
    });
    const response = NextResponse.json({ success: true, message: "密码已更新，所有设备已退出，请重新登录" });
    const [sessionCookie, pendingCookie] = await Promise.all([
      resolvedSessionCookie(),
      resolvedPendingCookie(),
    ]);
    response.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
    response.cookies.set(pendingCookie.name, "", { ...pendingCookie.options, maxAge: 0 });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "密码修改失败";
    if (/当前密码|账号不存在|已停用|不支持|未配置|未确认|缺少上游凭据|拒绝/.test(message)) {
      return NextResponse.json({ message }, { status: /不支持/.test(message) ? 501 : 400 });
    }
    console.error("[security] password change failed", { userId: session.userId, provider: await resolvedAuthProviderId().catch(() => "unknown") });
    return NextResponse.json({ message: "密码修改失败，请稍后重试" }, { status: 502 });
  }
}
