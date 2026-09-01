import type { ReactNode } from "react";
import { Brush, LogIn, Sparkles } from "lucide-react";
import Link from "next/link";

type PublicHeaderProps = {
  current?: "pricing" | "models" | "gallery" | "announcements";
  actionLabel?: string;
  actionHref?: string;
  extraActions?: ReactNode;
};

const links = [
  ["pricing", "价格", "/pricing"],
  ["models", "模型", "/models"],
  ["gallery", "图片广场", "/gallery"],
  ["announcements", "公告", "/announcements"],
] as const;

export function PublicHeader({
  current,
  actionLabel = "登录 / 进入工作台",
  actionHref = "/sign-in",
  extraActions,
}: PublicHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--panel)]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-7">
        <Link href="/sign-in" className="flex min-w-0 shrink-0 items-center gap-2 text-sm font-bold">
          <Brush size={19} className="shrink-0 text-[var(--rose)]" />
          <span className="hidden sm:inline">LOVE FOR NAI</span>
          <span className="sm:hidden">LFN</span>
        </Link>
        <nav aria-label="公开页面导航" className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs sm:ml-4 sm:gap-2">
          {links.map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              aria-current={current === key ? "page" : undefined}
              className={`shrink-0 rounded px-2.5 py-2 font-semibold transition-colors ${current === key ? "bg-[var(--rose)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--rose)]"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        {extraActions}
        <Link
          href={actionHref}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded border border-[var(--rose)] px-2.5 text-xs font-semibold text-[var(--rose)] hover:bg-[var(--rose)] hover:text-white sm:px-3"
        >
          <LogIn size={14} />
          <span className="hidden sm:inline">{actionLabel}</span>
          <span className="sm:hidden">登录</span>
        </Link>
      </div>
    </header>
  );
}

export function PublicPageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--rose)]">{eyebrow}</p>
      <h1 className="mt-3 font-[var(--font-display)] text-4xl leading-tight sm:text-5xl">{title}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted)]">{description}</p>
    </div>
  );
}

export function PublicBrandMark() {
  return <Sparkles size={18} className="text-[var(--rose)]" aria-hidden="true" />;
}
