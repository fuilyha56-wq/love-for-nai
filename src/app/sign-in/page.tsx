"use client";

import { ArrowRight, Brush, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAppearance } from "@/app/appearance";
import { PublicHeader } from "@/app/public-header";

type Mode = "password" | "token" | "register";
type GalleryBackground = { imageUrl: string; title: string };
type AuthResult = {
  message?: string;
  referralReward?: number;
  success?: boolean;
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

// 标题乱序入场：150ms 内闪过随机字符后立即归位。
const SCRAMBLE_CHARS = "让每次想象都有清晰落点ABCDEF0123456789";
function useScrambleText(target: string): string {
  const [display, setDisplay] = useState(target);
  useEffect(() => {
    const frames = 5; // 5 帧 × 30ms = 150ms
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      if (frame >= frames) {
        setDisplay(target);
        window.clearInterval(timer);
        return;
      }
      setDisplay(
        target
          .split("")
          .map((char) =>
            char === " " || char === "，"
              ? char
              : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)],
          )
          .join(""),
      );
    }, 30);
    return () => window.clearInterval(timer);
  }, [target]);
  return display;
}

export default function SignInPage() {
  const router = useRouter();
  const { preferences: appearancePreferences, backgroundUrl } = useAppearance();
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
  const headline = useScrambleText("让每一次想象，都有清晰的落点。");
  const sectionRef = useRef<HTMLElement>(null);
  const localBackgroundActive = appearancePreferences.backgroundEnabled && Boolean(backgroundUrl);

  useEffect(() => {
    let items: GalleryBackground[] = [];
    const choose = () => {
      // 本地背景启用时不再轮换图库背景，避免每分钟闪烁。
      if (localBackgroundActive) return;
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
        // R18 作品不出现在登录页背景里，避免未登录用户在不知情时看到。
        items = Array.isArray(result.items)
          ? result.items.filter(
              (item: GalleryBackground & { rating?: string }) =>
                item.imageUrl && item.rating !== "r18",
            )
          : [];
        choose();
      })
      .catch(() => undefined);
    const timer = window.setInterval(choose, 60_000);
    return () => window.clearInterval(timer);
  }, [localBackgroundActive]);

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
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      const result = await readAuthResult(response);
      if (result.twoFactorRequired) setTwoFactor(true);
      else if (response.ok) router.push("/image");
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
        body: JSON.stringify({ token }),
      });
      const result = await readAuthResult(response);
      if (response.ok) router.push("/image");
      else setError(result.message || "令牌登录失败");
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
    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await readAuthResult(response);
      if (response.ok) router.push("/image");
      else setError(result.message || "验证失败");
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
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current={undefined} />
      <section className="grid lg:grid-cols-[1.05fr_.95fr]">
      <section ref={sectionRef} className="relative hidden overflow-hidden bg-[#262928] px-16 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className={`absolute inset-0 bg-cover transition-opacity duration-1000 ease-out ${backgroundVisible && (localBackgroundActive || galleryBackground) ? "opacity-55" : "opacity-0"}`}
          style={{
            backgroundImage: localBackgroundActive
              ? `linear-gradient(rgba(38,41,40,.35), rgba(38,41,40,.35)), url("${backgroundUrl}")`
              : galleryBackground
                ? `linear-gradient(rgba(38,41,40,.45), rgba(38,41,40,.45)), url(${galleryBackground.imageUrl})`
                : "radial-gradient(circle at 30% 20%, #d5b263 0, transparent 28%), radial-gradient(circle at 75% 70%, #a83a4c 0, transparent 34%)",
            backgroundPosition: "var(--lfn-bg-pos, center)",
          }}
        />
        {/* 文字只靠左下局部渐变衬托，背景图其余区域保持清晰 */}
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-2/3 transition-opacity duration-1000 ease-out ${localBackgroundActive || galleryBackground ? "opacity-100" : "opacity-0"}`} style={{ background: "linear-gradient(to top, rgba(38,41,40,.92) 0%, rgba(38,41,40,.55) 45%, transparent 100%)" }} />
        <div className="relative flex items-center gap-3 text-sm font-semibold">
          <Brush size={20} /> LOVE FOR NAI
        </div>
        <div className="hero-text relative max-w-xl">
          <p className="mb-5 text-sm text-[#d9c9a5]">中文 NovelAI 创作空间</p>
          <h1 className="font-[var(--font-display)] text-6xl leading-[1.08]">
            {headline.split("，").map((line, index, all) => (
              <span key={index} className="block">
                {line}
                {index < all.length - 1 ? "，" : ""}
              </span>
            ))}
          </h1>
          <p className="mt-7 max-w-md leading-8 text-white/65">
            专注提示词、角色构图与细节控制。你的 NewAPI
            账号、余额和模型权限在这里继续使用。
          </p>
          {!localBackgroundActive && galleryBackground?.title && (
            <p className="mt-5 text-xs text-white/45">
              背景作品：{galleryBackground.title}
            </p>
          )}
        </div>
        <p className="relative text-xs text-white/35">
          Love for NAI · AGPL-3.0
        </p>
      </section>
      <section className="flex min-h-screen items-center justify-center bg-[var(--paper)] px-6 py-12">
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
      </section>
      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-7 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--rose)]">Why LFN / 为什么是 LFN</p>
          <h2 className="mt-3 font-[var(--font-display)] text-4xl leading-tight sm:text-5xl">把复杂的 NovelAI，整理成中文创作工作流。</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--muted)]">LFN 不替你改变 NewAPI 账号，而是把提示词、模型、角色构图、历史和分享集中到一个更适合中文创作者的空间。</p>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["中文提示词与标签助手", "从概念检索到多轮对话，整理出可直接使用的正负向提示词和标签。", "/image?demo=1"],
            ["多角色构图", "每个角色拥有独立提示词和画面位置，复杂构图也能逐个调整。", "/models"],
            ["NovelAI 原生参数", "支持尺寸、steps、采样器、参考图、Director Tools 和原生 ZIP 入口。", "/pricing"],
            ["历史与无损下载", "本地与远程分层保存图片，批量打包 ZIP，不经过重编码。", "/image?demo=1"],
            ["图片广场与分享", "公开浏览作品、查看详情、复制分享链接，R18 内容默认保护。", "/gallery"],
            ["透明的计费路径", "图包额度优先，个人 AFF 补足，两者都不足才使用 NewAPI 余额。", "/pricing#calculator"],
          ].map(([title, description, href]) => (
            <Link key={title} href={href} className="group rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--rose)] hover:shadow-[0_12px_35px_rgba(54,47,39,.08)]">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f8e8e9] text-[var(--rose)]"><Brush size={17} /></span>
              <h3 className="mt-4 font-semibold group-hover:text-[var(--rose)]">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--rose)]">了解更多 <ArrowRight size={13} /></span>
            </Link>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-5 rounded-xl bg-[#292d2c] p-6 text-white sm:flex-row sm:items-center sm:p-8">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d9c9a5]">Start creating</p><h2 className="mt-2 font-[var(--font-display)] text-2xl">先浏览，再决定是否登录。</h2><p className="mt-2 text-sm text-white/65">价格、模型、图片广场都无需登录；体验模式可以先熟悉工作台。</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><Link href="/pricing" className="inline-flex h-10 items-center rounded bg-white px-4 text-xs font-semibold text-[#292d2c]">查看价格</Link><Link href="/image?demo=1" className="inline-flex h-10 items-center rounded border border-white/25 px-4 text-xs font-semibold">进入体验</Link></div>
        </div>
      </section>
    </main>
  );
}
