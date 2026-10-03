"use client";

import { AlertTriangle, ArrowLeft, BookOpen, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MarkdownView } from "@/app/markdown";
import { PublicHeader, PublicPageIntro } from "@/app/public-header";

type PublicDocument = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  status: "published";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export default function DocsPage() {
  const [items, setItems] = useState<PublicDocument[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/docs", { cache: "no-store" });
      const result = (await response.json()) as { items?: PublicDocument[]; message?: string };
      if (!response.ok) throw new Error(result.message || "文档读取失败");
      const nextItems = Array.isArray(result.items) ? result.items : [];
      const requestedSlug = new URLSearchParams(window.location.search).get("slug");
      setItems(nextItems);
      setSelectedSlug((current) => current && nextItems.some((item) => item.slug === current)
        ? current
        : requestedSlug && nextItems.some((item) => item.slug === requestedSlug)
          ? requestedSlug
          : nextItems[0]?.slug || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文档读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const selected = items.find((item) => item.slug === selectedSlug) || items[0];
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="docs" />
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-7 sm:pt-14">
        <PublicPageIntro
          eyebrow="API / 在线文档"
          title="LFN API 文档"
          description="文档由站点线上 CMS 维护，发布后即时生效。选择左侧条目查看接入说明、模型参考和快速开始。"
        />
        {error && (
          <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="flex items-center gap-2"><AlertTriangle size={16} />{error}</span>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 font-semibold hover:underline"><RefreshCw size={14} />重试</button>
          </div>
        )}
        {loading ? (
          <div className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-8 text-center text-sm text-[var(--muted)]">正在加载文档…</div>
        ) : !items.length ? (
          <div className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-8 text-center text-sm text-[var(--muted)]">暂无已发布文档</div>
        ) : (
          <div className="mt-8 grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="h-fit rounded-xl border border-[var(--line)] bg-[var(--panel)] p-2 lg:sticky lg:top-5">
              <p className="px-3 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--rose)]">文档目录</p>
              <nav aria-label="文档目录" className="space-y-1">
                {items.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => setSelectedSlug(item.slug)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition ${selected?.slug === item.slug ? "bg-[var(--rose)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"}`}
                  >
                    <span className="block text-[10px] font-semibold opacity-80">{item.category}</span>
                    <span className="mt-0.5 block text-sm font-semibold">{item.title}</span>
                  </button>
                ))}
              </nav>
            </aside>
            {selected && (
              <article className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-5">
                  <div>
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]"><BookOpen size={14} />{selected.category}</p>
                    <h1 className="mt-2 font-[var(--font-display)] text-2xl font-bold sm:text-3xl">{selected.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{selected.summary}</p>
                  </div>
                  <Link href="/docs" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--rose)]"><ArrowLeft size={14} />文档首页</Link>
                </div>
                <div className="mt-6"><MarkdownView content={selected.content} /></div>
                <p className="mt-8 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">最后更新：{new Date(selected.updatedAt).toLocaleString("zh-CN")}</p>
              </article>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
