"use client";

import { registrationUsernameMaxLength, type AuthPolicy, type RegistrationMethod } from "@/lib/auth-policy";

export function RegistrationFields({
  policy,
  provider,
  methods,
  method,
  onMethodChange,
  email,
  onEmailChange,
  emailCode,
  onEmailCodeChange,
  inviteCode,
  onInviteCodeChange,
  sendCode,
  sendingCode,
}: {
  policy: AuthPolicy;
  provider: string;
  methods: RegistrationMethod[];
  method: RegistrationMethod;
  onMethodChange: (method: RegistrationMethod) => void;
  email: string;
  onEmailChange: (value: string) => void;
  emailCode: string;
  onEmailCodeChange: (value: string) => void;
  inviteCode: string;
  onInviteCodeChange: (value: string) => void;
  sendCode: () => void;
  sendingCode: boolean;
}) {
  const usernameMax = registrationUsernameMaxLength(provider);
  const needsEmail =
    method === "email" ||
    policy.requireEmailVerification ||
    policy.emailDomainRestrictionEnabled;
  const needsInvite = method === "invite" || policy.requireInviteCode;
  return (
    <>
      {methods.length > 1 ? (
        <div className="flex gap-2" aria-label="注册方式">
          {methods.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={method === item}
              onClick={() => onMethodChange(item)}
              className={`h-10 flex-1 rounded-md border px-3 text-sm font-semibold ${method === item ? "border-[var(--rose)] bg-[var(--rose)]/10 text-[var(--rose)]" : "border-[var(--line)] text-[var(--muted)]"}`}
            >
              {item === "email" ? "邮箱注册" : "邀请码注册"}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm font-semibold text-[var(--rose)]">
          {method === "email" ? "邮箱注册" : "邀请码注册"}
        </p>
      )}
      <label className="block text-sm font-medium">
        用户名
        <input
          className="field mt-2 h-12 w-full px-4"
          name="username"
          autoComplete="username"
          minLength={3}
          maxLength={usernameMax}
          pattern={`[a-zA-Z0-9_.\\-]{3,${usernameMax}}`}
          title={`3–${usernameMax} 位字母、数字或 _-.`}
          required
        />
      </label>
      <label className="block text-sm font-medium">
        密码
        <input
          className="field mt-2 h-12 w-full px-4"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={64}
          required
        />
        <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
          8–64 个字符
        </span>
      </label>
      {policy.requireInviteCode && <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">本站仅限受邀用户注册。所有注册方式均需填写有效邀请码，其他资料请照常填写。</p>}
      {needsInvite && (
        <label className="block text-sm font-medium">
          邀请码
          <input
            className="field mt-2 h-12 w-full px-4"
            value={inviteCode}
            onChange={(event) =>
              onInviteCodeChange(event.target.value.slice(0, 32))
            }
            placeholder="请输入有效的邀请码"
            autoComplete="off"
            maxLength={32}
            required
          />
        </label>
      )}
      {needsEmail && (
        <label className="block text-sm font-medium">
          邮箱
          <span className="mt-2 flex gap-2">
            <input
              className="field h-12 min-w-0 flex-1 px-4"
              type="email"
              aria-label="邮箱"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              autoComplete="email"
              maxLength={120}
              required
            />
            {policy.requireEmailVerification && (
              <button
                type="button"
                onClick={sendCode}
                disabled={
                  sendingCode ||
                  !email ||
                  (needsInvite && !inviteCode.trim())
                }
                className="h-12 shrink-0 rounded-md border border-[var(--line)] px-3 text-xs font-semibold disabled:opacity-50"
              >
                {sendingCode ? "发送中…" : "获取验证码"}
              </button>
            )}
          </span>
          {policy.emailDomainRestrictionEnabled && (
            <span className="mt-2 block text-xs font-normal leading-5 text-[var(--muted)]">
              支持的邮箱：
              {policy.allowedEmailDomains
                .split(/\r?\n/)
                .filter(Boolean)
                .join("、")}
            </span>
          )}
        </label>
      )}
      {policy.requireEmailVerification && (
        <label className="block text-sm font-medium">
          邮箱验证码
          <input
            className="field mt-2 h-12 w-full px-4"
            value={emailCode}
            onChange={(event) => onEmailCodeChange(event.target.value)}
            autoComplete="one-time-code"
            maxLength={32}
            required
          />
        </label>
      )}
    </>
  );
}
