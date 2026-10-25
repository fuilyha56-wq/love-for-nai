"use client";

import { ArrowRight, Brush, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { PublicHeader } from "@/mobile/public-header";

import { useAuthOptions, type AuthMode as Mode } from "./use-auth-options";
import { RegistrationFields } from "./registration-fields";
import type { RegistrationMethod } from "@/lib/auth-policy";
type AuthResult = {
  message?: string;
  referralReward?: number;
  success?: boolean;
  signedIn?: boolean;
  twoFactorRequired?: boolean;
};

async function readAuthResult(response: Response): Promise<AuthResult> {
  const body = await response.text();
  if (!body) throw new Error("服务器返回了空响应");
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") return parsed as AuthResult;
  } catch {
    // 让调用方统一显示可理解的请求错误。
  }
  throw new Error("服务器返回了无效响应");
}

function authRequestError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return `${fallback}，请检查网络后重试`;
  if (error instanceof Error) return error.message;
  return `${fallback}，请稍后重试`;
}

export default function SignInPage() {
  const router = useRouter();
  const authOptions = useAuthOptions();
  const [selectedMode, setMode] = useState<Mode>("password");
  const [selectedRegistrationMethod, setRegistrationMethod] = useState<RegistrationMethod>("email");
  const mode = authOptions.modes.some(([value]) => value === selectedMode) ? selectedMode : authOptions.modes[0]?.[0];
  const registrationMethod = authOptions.methods.includes(selectedRegistrationMethod) ? selectedRegistrationMethod : authOptions.methods[0] || "email";
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLandingPath, setInviteLandingPath] = useState("");
  // 保持登录：30 天会话；不勾选仍为 7 天。更长的会话减少反复登录
  // 产生的上游会话，降低撞上游会话数上限（409）的概率。
  const [rememberLogin, setRememberLogin] = useState(true);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("invite") || "").slice(0, 32);
    if (!code) return;
    // Keep only the invite and small, non-sensitive attribution values. Never
    // send arbitrary query strings (which may contain tokens) to the server.
    const safe = new URLSearchParams({ invite: code });
    for (const key of ["source", "utm_source", "utm_medium", "utm_campaign"]) {
      const value = params.get(key)?.trim() || "";
      if (/^[a-zA-Z0-9._~-]{1,64}$/.test(value)) safe.set(key, value);
    }
    const landingPath = `/sign-in?${safe.toString()}`.slice(0, 512);
    const timer = window.setTimeout(() => {
      setInviteLandingPath(landingPath);
      setInviteCode(code);
      setRegistrationMethod("invite");
      setMode("register");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setInfo("");
    setTwoFactor(false);
  }

  function completeSignIn() {
    const requested = new URLSearchParams(window.location.search).get("next") || "";
    let destination = "/image";
    if (requested.startsWith("/")) {
      try {
        const url = new URL(requested, window.location.origin);
        if (url.origin === window.location.origin && url.pathname !== "/sign-in") destination = `${url.pathname}${url.search}${url.hash}`;
      } catch { /* Use the canvas when the return path is malformed. */ }
    }
    router.replace(destination);
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          remember: rememberLogin,
        }),
      });
      const result = await readAuthResult(response);
      if (result.twoFactorRequired) setTwoFactor(true);
      else if (response.ok) {
        completeSignIn();
      }
      else setError(result.message || "登录失败");
    } catch (submitError) {
      setError(authRequestError(submitError, "登录失败"));
    } finally {
      setLoading(false);
    }
  }

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, remember: rememberLogin }),
      });
      const result = await readAuthResult(response);
      if (response.ok) {
        completeSignIn();
      } else setError(result.message || "令牌登录失败");
    } catch (submitError) {
      setError(authRequestError(submitError, "令牌登录失败"));
    } finally {
      setLoading(false);
    }
  }

  async function sendCode() {
    if (sendingCode) return;
    setSendingCode(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, method: registrationMethod, inviteCode: registrationMethod === "invite" || authOptions.policy?.requireInviteCode ? inviteCode : undefined }),
      });
      const result = await readAuthResult(response);
      if (response.ok) setInfo("验证码已发送，请查收邮箱。");
      else setError(result.message || "验证码发送失败，请稍后重试");
    } catch {
      setError("验证码发送失败，请检查网络后重试");
    } finally {
      setSendingCode(false);
    }
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          method: registrationMethod,
          remember: rememberLogin,
          email: registrationMethod === "email" || authOptions.policy?.requireEmailVerification || authOptions.policy?.emailDomainRestrictionEnabled ? email : undefined,
          verificationCode: authOptions.policy?.requireEmailVerification ? emailCode : undefined,
          inviteCode: registrationMethod === "invite" || authOptions.policy?.requireInviteCode || inviteLandingPath ? inviteCode : undefined,
          inviteLandingPath: inviteLandingPath || undefined,
        }),
      });
      const result = await readAuthResult(response);
      if (response.ok) {
        if (result.signedIn) {
          completeSignIn();
          return;
        }
        switchMode("password");
        setInfo(
          result.referralReward
            ? `注册成功，已获得 ${result.referralReward} AFF 邀请奖励，请使用新账号登录。`
            : "注册成功，请使用新账号登录。",
        );
      } else setError(result.message || "注册失败，请稍后重试");
    } catch {
      setError("注册失败，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await readAuthResult(response);
      if (response.ok) {
        completeSignIn();
      } else setError(result.message || "验证失败");
    } catch (verifyError) {
      setError(authRequestError(verifyError, "验证失败"));
    } finally {
      setLoading(false);
    }
  }

  const notices = (
    <>
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {info}
        </p>
      )}
    </>
  );
  return (
    <main className="launcher-auth-page bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader actionLabel="体验画布" />
      <section className="launcher-auth-content">
        <div className="launcher-auth-form">
          <div className="mb-6 flex items-center justify-center gap-3">
            <Brush color="var(--rose)" />
            <b>LOVE FOR NAI</b>
          </div>
          <h1 className="text-center text-2xl font-semibold">
            {twoFactor ? "两步验证" : mode === "register" ? "创建账号" : "登录创作空间"}
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {twoFactor
              ? "请输入验证器应用中的 6 位验证码，或使用备用恢复码"
              : mode === "token"
                ? "使用 NewAPI 个人设置中的访问令牌登录"
                : mode === "register"
                  ? "选择站点开放的注册方式，完成身份验证后创建账号"
                  : "使用站点账号登录"}
          </p>
          {!twoFactor && authOptions.modes.length > 0 && (
            <div className="mt-6 flex gap-1 rounded-md border border-[var(--line)] bg-[#f5f3ed] p-1 text-xs font-semibold">
              {authOptions.modes.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchMode(value)}
                  className={`h-8 flex-1 rounded ${mode === value ? "bg-white text-[var(--rose)] shadow-sm" : "text-[var(--muted)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {authOptions.loading ? <p className="mt-6 text-sm text-[var(--muted)]" role="status">正在读取登录配置…</p> : authOptions.error ? <div className="mt-6 text-sm" role="alert">{authOptions.error}<button type="button" className="ml-3 underline" onClick={() => void authOptions.reload()}>重试</button></div> : !mode ? <p className="mt-6 text-sm text-[var(--muted)]">站点暂未开放登录或注册，请联系管理员。</p> : twoFactor && authOptions.policy?.passwordLoginEnabled ? (
            <form key="two-factor" className="mt-9 space-y-5" onSubmit={verify}>
              <label className="block text-sm font-medium">
                验证码
                <input
                  className="field mt-2 h-12 px-4 tracking-[0.3em]"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode="text"
                  maxLength={20}
                  autoFocus
                  required
                />
              </label>
              {notices}
              <button
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--rose)] font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-60"
              >
                {loading ? (
                  <LoaderCircle className="animate-spin" size={19} />
                ) : (
                  <>
                    验证并登录 <ArrowRight size={18} />
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTwoFactor(false);
                  setCode("");
                  setError("");
                }}
                className="w-full text-sm text-[var(--muted)] hover:text-[var(--rose)]"
              >
                返回重新登录
              </button>
            </form>
          ) : mode === "token" ? (
            <form key="token" className="mt-6 space-y-5" onSubmit={submitToken}>
              <label className="block text-sm font-medium">
                访问令牌
                <input
                  className="field mt-2 h-12 px-4"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="在 NewAPI 个人设置 → 访问令牌中生成"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  required
                />
              </label>
              {notices}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={rememberLogin}
                  onChange={(event) => setRememberLogin(event.target.checked)}
                  className="h-4 w-4 accent-[var(--rose)]"
                />
                保持登录 30 天
              </label>
              <button
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--rose)] font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-60"
              >
                {loading ? (
                  <LoaderCircle className="animate-spin" size={19} />
                ) : (
                  <>
                    使用令牌登录 <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          ) : mode === "register" ? (
            <form key="register" className="mt-6 space-y-5" onSubmit={submitRegister}>
              {authOptions.policy && <RegistrationFields policy={authOptions.policy} provider={authOptions.provider} methods={authOptions.methods} method={registrationMethod} onMethodChange={(value) => { setRegistrationMethod(value); setEmailCode(""); setError(""); setInfo(""); }} email={email} onEmailChange={setEmail} emailCode={emailCode} onEmailCodeChange={setEmailCode} inviteCode={inviteCode} onInviteCodeChange={setInviteCode} sendCode={sendCode} sendingCode={sendingCode} />}
              {notices}
              <button
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--rose)] font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-60"
              >
                {loading ? (
                  <LoaderCircle className="animate-spin" size={19} />
                ) : (
                  <>
                    注册账号 <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form className="mt-6 space-y-5" onSubmit={submit}>
              <label className="block text-sm font-medium">
                用户名
                <input
                  className="field mt-2 h-12 px-4"
                  name="username"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                密码
                <span className="relative mt-2 block">
                  <input
                    className="field h-12 px-4 pr-12"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    aria-label="切换密码可见性"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-[var(--muted)]"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </span>
              </label>
              {notices}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={rememberLogin}
                  onChange={(event) => setRememberLogin(event.target.checked)}
                  className="h-4 w-4 accent-[var(--rose)]"
                />
                保持登录 30 天
              </label>
              <button
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--rose)] font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-60"
              >
                {loading ? (
                  <LoaderCircle className="animate-spin" size={19} />
                ) : (
                  <>
                    登录 <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          )}
          <div className="my-7 flex items-center gap-4 text-xs text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--line)]" />或
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
          <Link
            href="/image?demo=1"
            className="flex h-12 items-center justify-center rounded-md border border-[var(--line)] bg-white font-medium hover:bg-[#f5f3ed]"
          >
            先进入体验模式
          </Link>
          <p className="mt-8 text-center text-xs leading-6 text-[var(--muted)]">
            登录与注册方式由站点管理员配置，密码仅用于身份验证。
            <br />
            <a
              className="underline"
              href="https://github.com/fuilyha56-wq/love-for-nai"
              target="_blank"
              rel="noreferrer"
            >
              源代码与 AGPL-3.0 许可证
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
