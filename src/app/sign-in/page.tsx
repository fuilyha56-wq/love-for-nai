"use client";

import { ArrowRight, Brush, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function SignInPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
    if (response.ok) router.push("/image");
    else setError(result.message || "登录失败");
    setLoading(false);
  }
  return (
    <main className="min-h-screen grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-[#262928] px-16 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 20%, #d5b263 0, transparent 28%), radial-gradient(circle at 75% 70%, #a83a4c 0, transparent 34%)",
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
          <h2 className="font-[var(--font-display)] text-4xl">登录创作空间</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">
            使用现有 NewAPI 账号登录
          </p>
          <form className="mt-9 space-y-5" onSubmit={submit}>
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
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}
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
