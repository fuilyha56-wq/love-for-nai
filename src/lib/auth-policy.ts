// This module is shared with the sign-in UI; keep it free of server imports.
export type RegistrationMethod = "email" | "invite";

export function registrationUsernameMaxLength(provider: string) {
  return provider === "local" ? 32 : 20;
}

export type AuthPolicy = {
  passwordLoginEnabled: boolean;
  tokenLoginEnabled: boolean;
  registrationEnabled: boolean;
  passwordRegistrationEnabled: boolean;
  emailRegistrationEnabled: boolean;
  inviteRegistrationEnabled: boolean;
  requireInviteCode: boolean;
  requireEmailVerification: boolean;
  emailDomainRestrictionEnabled: boolean;
  blockEmailAliases: boolean;
  allowedEmailDomains: string;
};

export const DEFAULT_AUTH_POLICY: AuthPolicy = {
  passwordLoginEnabled: true,
  tokenLoginEnabled: true,
  registrationEnabled: true,
  passwordRegistrationEnabled: true,
  emailRegistrationEnabled: true,
  inviteRegistrationEnabled: false,
  requireInviteCode: false,
  requireEmailVerification: true,
  emailDomainRestrictionEnabled: false,
  blockEmailAliases: false,
  allowedEmailDomains:
    "gmail.com\n163.com\n126.com\nqq.com\noutlook.com\nhotmail.com\nicloud.com\nyahoo.com\nfoxmail.com",
};

export function registrationMethods(policy: AuthPolicy): RegistrationMethod[] {
  if (!policy.registrationEnabled || !policy.passwordRegistrationEnabled)
    return [];
  return [
    ...(policy.emailRegistrationEnabled ? ["email" as const] : []),
    ...(policy.inviteRegistrationEnabled ? ["invite" as const] : []),
  ];
}

export function normalizeEmailDomains(value: string): string {
  const domains = value
    .split(/\r?\n/)
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length > 200) throw new Error("最多配置 200 个邮箱域名");
  for (const domain of domains) {
    if (
      domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    )
      throw new Error(`邮箱域名格式不正确：${domain.slice(0, 80)}`);
  }
  return [...new Set(domains)].join("\n");
}

export function registrationMethodError(
  policy: AuthPolicy,
  method: unknown,
): string | null {
  if (!policy.registrationEnabled) return "站点已关闭新用户注册";
  if (!policy.passwordRegistrationEnabled) return "站点已关闭密码注册";
  if (method !== "email" && method !== "invite") return "请选择有效的注册方式";
  if (!registrationMethods(policy).includes(method))
    return method === "email" ? "站点已关闭邮箱注册" : "站点已关闭邀请码注册";
  return null;
}

export function registrationEmailError(
  policy: AuthPolicy,
  email: string,
): string | null {
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return "请输入有效的邮箱地址";
  const [local, domain] = email.toLowerCase().split("@");
  if (
    policy.blockEmailAliases &&
    (local.includes("+") ||
      (domain === "gmail.com" && local.includes(".")) ||
      domain === "googlemail.com")
  )
    return "不允许使用邮箱别名，请使用原始邮箱地址";
  if (
    policy.emailDomainRestrictionEnabled &&
    !policy.allowedEmailDomains
      .split(/\r?\n/)
      .map((item) => item.trim().toLowerCase())
      .includes(domain)
  )
    return "该邮箱域名不在站点允许的范围内";
  return null;
}
