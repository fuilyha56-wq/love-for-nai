import { resolvedAdminHeaders } from "@/lib/admin-auth";
import { resolvedNewApiBaseUrl, userHeaders, type Session } from "@/lib/newapi";
import { findReferralByCode } from "@/lib/referral";
import { smtpConfigured } from "@/lib/registration-email";
import type { RuntimeSettings } from "@/lib/runtime-config";

export class RegistrationInviteError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
  ) {
    super(message);
  }
}

// Keep NewAPI's public verification/registration checks in force. LFN-owned
// email verification and explicitly configured admin registration use LFN policy.
export async function upstreamRegistrationPolicy(settings: RuntimeSettings) {
  if (!settings.requireEmailVerification || smtpConfigured(settings))
    return { settings, emailVerification: undefined };
  const response = await fetch(`${await resolvedNewApiBaseUrl()}/api/status`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok || result.success !== true || !result.data)
    throw new Error("无法读取上游注册策略");
  return {
    settings: {
      ...settings,
      registrationEnabled:
        settings.registrationEnabled && result.data.register_enabled !== false,
      passwordRegistrationEnabled:
        settings.passwordRegistrationEnabled &&
        result.data.password_register_enabled !== false,
      requireInviteCode:
        settings.requireInviteCode ||
        result.data.invite_only_register_enabled === true,
    },
    emailVerification: result.data.email_verification === true,
  };
}

function validAffCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(value);
}

// Resolve from the trusted LFN referral owner; never accept a client-selected
// upstream inviter. The upstream code and service credential stay on the server.
export async function newApiRegistrationAffCode(inviteCode: string) {
  if (!inviteCode) return "";
  const referral = await findReferralByCode(inviteCode);
  if (
    !referral ||
    !Number.isSafeInteger(referral.inviterUserId) ||
    referral.inviterUserId <= 0
  )
    throw new RegistrationInviteError("邀请码无效，请检查后重试", 400);
  try {
    const headers = await resolvedAdminHeaders();
    const ownInvite =
      Number(headers["New-Api-User"]) === referral.inviterUserId;
    // NewAPI forbids admin GET /user/:id for an equal-role user. Its own
    // referral endpoint is authenticated as the service account in this case.
    const endpoint = ownInvite
      ? "/api/user/aff"
      : `/api/user/${referral.inviterUserId}`;
    const response = await fetch(
      `${await resolvedNewApiBaseUrl()}${endpoint}`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    const result = await response.json();
    if (!response.ok || result.success !== true)
      throw new Error("无法读取邀请人");
    const user = result.data;
    if (
      !ownInvite &&
      (user?.id !== referral.inviterUserId ||
        user.status !== 1 ||
        user.DeletedAt)
    )
      throw new RegistrationInviteError("邀请人账号不可用，请更换邀请码", 400);
    const code = ownInvite ? user : user.aff_code;
    if (!validAffCode(code))
      throw new RegistrationInviteError(
        "邀请链接尚未就绪，请邀请人登录 LFN 后重新获取链接",
      );
    return code;
  } catch (error) {
    if (error instanceof RegistrationInviteError) throw error;
    throw new RegistrationInviteError(
      "邀请验证服务暂时不可用，请稍后重试或联系管理员",
    );
  }
}

// NewAPI creates an affiliate code lazily. Prepare it using the inviter's own
// session before publishing even an existing LFN link; never impersonate users.
export async function prepareNewApiReferral(session: Session) {
  const response = await fetch(
    `${await resolvedNewApiBaseUrl()}/api/user/aff`,
    {
      headers: userHeaders(session),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json();
  if (!response.ok || result.success !== true || !validAffCode(result.data))
    throw new Error("无法准备上游邀请链接");
}
