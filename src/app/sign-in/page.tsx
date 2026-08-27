"use client";

import { ArrowRight, Brush, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type Mode = "password" | "token" | "register";
type GalleryBackground = { imageUrl: string; title: string };
type AuthResult = {
  message?: string;
  referralReward?: number;
  success?: boolean;
};

async function readAuthResult(response: Response): Promise<AuthResult> {
  const body = await response.text();
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AuthResult) : {};
  } catch {
    return {};
  }
}

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
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
  const [galleryBackground, setGalleryBackground] =
    useState<GalleryBackground | null>(null);
  const [backgroundVisible, setBackgroundVisible] = useState(true);

  useEffect(() => {
    let items: GalleryBackground[] = [];
    const choose = () => {
      if (!items.length) return;
      setBackgroundVisible(false);
      window.setTimeout(() => {
        const next = items[Math.floor(Math.random() * items.length)];
        setGalleryBackground(next);
        setBackgroundVisible(true);
      }, 450);
    };
    fetch("/api/gallery", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        items = Array.isArray(result.items)
          ? result.items.filter((item: GalleryBackground) => item.imageUrl)
          : [];
        choose();
      })
      .catch(() => undefined);
    const timer = window.setInterval(choose, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const code =
      new URLSearchParams(window.location.search).get("invite") || "";
    if (!code) return;
    const timer = window.setTimeout(() => {
      setInviteCode(code.slice(0, 32));
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    const result = await response.json();
    if (result.twoFactorRequired) setTwoFactor(true);
    else if (response.ok) router.push("/image");
    else setError(result.message || "登录失败");
    setLoading(false);
  }

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const result = await response.json();
    if (response.ok) router.push("/image");
    else setError(result.message || "令牌登录失败");
    setLoading(false);
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
        body: JSON.stringify({ email }),
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
          email,
          verificationCode: emailCode,
          inviteCode,
        }),
      });
      const result = await readAuthResult(response);
      if (response.ok) {
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
    const response = await fetch("/api/auth/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const result = await response.json();
    if (response.ok) router.push("/image");
    else setError(result.message || "验证失败");
    setLoading(false);
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
    <main className="min-h-screen grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-[#262928] px-16 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className={`absolute inset-0 bg-cover bg-center opacity-20 transition-opacity duration-500 ${backgroundVisible ? "opacity-20" : "opacity-0"}`}
          style={{
            backgroundImage: galleryBackground
              ? `linear-gradient(rgba(38,41,40,.72), rgba(38,41,40,.72)), url(${galleryBackground.imageUrl})`
              : "radial-gradient(circle at 30% 20%, #d5b263 0, transparent 28%), radial-gradient(circle at 75% 70%, #a83a4c 0, transparent 34%)",
          }}
        />
        <div className="relative flex items-center gap-3 text-sm font-semibold">
          <Brush size={20} /> LOVE FOR NAI
        </div>
        <div className="relative max-w-xl enter">
          <p className="mb-5 text-sm text-[#d9c9a5]">中文 NovelAI 创作空间</p>
          <h1 className="font-[var(--font-display)] text-6xl leading-[1.08]">
            让每一次想象，
            <br />
            都有清晰的落点。
          </h1>
          <p className="mt-7 max-w-md leading-8 text-white/65">
            专注提示词、角色构图与细节控制。你的 NewAPI
            账号、余额和模型权限在这里继续使用。
          </p>
        </div>
        <p className="relative text-xs text-white/35">
          Love for NAI · AGPL-3.0
        </p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-md enter">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Brush color="var(--rose)" />
            <b>LOVE FOR NAI</b>
          </div>
          <p className="mb-2 text-sm font-semibold text-[var(--rose)]">
            欢迎回来
          </p>
          <h2 className="font-[var(--font-display)] text-4xl">
            {twoFactor ? "两步验证" : "登录创作空间"}
          </h2>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {twoFactor
              ? "请输入验证器应用中的 6 位验证码，或使用备用恢复码"
              : mode === "token"
                ? "使用 NewAPI 个人设置中的访问令牌登录"
                : mode === "register"
                  ? "注册新的 NewAPI 账号，注册后即可直接登录"
                  : "使用现有 NewAPI 账号登录"}
          </p>
          {!twoFactor && (
            <div className="mt-6 flex gap-1 rounded-md border border-[var(--line)] bg-[#f5f3ed] p-1 text-xs font-semibold">
              {(
                [
                  ["password", "账号密码"],
                  ["token", "访问令牌"],
                  ["register", "注册"],
                ] as Array<[Mode, string]>
              ).map(([value, label]) => (
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
          {twoFactor ? (
            <form className="mt-9 space-y-5" onSubmit={verify}>
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
            <form className="mt-6 space-y-5" onSubmit={submitToken}>
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
            <form className="mt-6 space-y-5" onSubmit={submitRegister}>
              <label className="block text-sm font-medium">
                用户名
                <input
                  className="field mt-2 h-12 px-4"
                  name="username"
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                密码
                <input
                  className="field mt-2 h-12 px-4"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={64}
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                邮箱
                <span className="mt-2 flex gap-2">
                  <input
                    className="field h-12 flex-1 px-4"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={sendingCode || !email}
                    className="h-12 shrink-0 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold disabled:opacity-50"
                  >
                    {sendingCode ? "发送中…" : "获取验证码"}
                  </button>
                </span>
              </label>
              <label className="block text-sm font-medium">
                邮箱验证码
                <input
                  className="field mt-2 h-12 px-4"
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                邀请码
                <input
                  className="field mt-2 h-12 w-full px-4"
                  value={inviteCode}
                  onChange={(event) =>
                    setInviteCode(event.target.value.slice(0, 32))
                  }
                  placeholder="可选，通过邀请链接会自动填入"
                  autoComplete="off"
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
            LFN 不保存你的密码。登录请求由服务端安全转发至 NewAPI。
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
