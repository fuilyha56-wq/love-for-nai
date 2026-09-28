import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="workspace-page grid min-h-screen place-items-center bg-[var(--paper)] p-5 text-[var(--ink)]">
      <section className="panel w-full max-w-lg rounded-lg border border-[var(--line)] bg-[var(--panel)] p-7 shadow-sm sm:p-10">
        <span className="grid h-11 w-11 place-items-center rounded-md bg-[color-mix(in_srgb,var(--rose)_12%,transparent)] text-[var(--rose)]">
          <Compass size={22} aria-hidden="true" />
        </span>
        <p className="mt-7 text-xs font-bold tracking-[0.18em] text-[var(--rose)]">LOVE FOR NAI · 404</p>
        <h1 className="mt-2 text-2xl font-semibold">这个页面还不存在</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          你访问的地址目前没有对应页面。可以返回生图工作台继续创作。
        </p>
        <Link
          href="/image"
          className="mt-7 inline-flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white hover:bg-[var(--rose-dark)]"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          返回工作台
        </Link>
      </section>
    </main>
  );
}
