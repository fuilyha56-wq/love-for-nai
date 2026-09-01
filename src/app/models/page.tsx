"use client";

import {
  ArrowRight,
  ImageIcon,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicHeader, PublicPageIntro } from "@/app/public-header";
import type { PublicCatalog, PublicModel } from "@/lib/public-catalog";

export default function ModelsPage() {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "chat">("all");
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadState("loading");
    setError("");
    try {
      const response = await fetch("/api/public/catalog", { cache: "no-store" });
      const result = (await response.json()) as PublicCatalog & { message?: string };
      if (!response.ok || !Array.isArray(result.models))
        throw new Error(result.message || "模型目录读取失败");
      setCatalog(result);
      setLoadState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "模型目录读取失败，请稍后重试");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const models = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (catalog?.models || []).filter((model) => {
      if (filter !== "all" && model.kind !== filter) return false;
      if (!normalized) return true;
      return `${model.id} ${model.name} ${model.summary}`.toLowerCase().includes(normalized);
    });
  }, [catalog, filter, query]);

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="models" />
      <section className="mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-7 sm:pt-14">
        <PublicPageIntro
          eyebrow="Models / 模型"
          title="把模型差异，变成可选择的创作工具。"
          description="这里展示 LFN 当前支持的 NovelAI 图像模型与聊天模型。公开目录不代表每个账号都拥有相同权限，登录后工作台仍会按你的 NewAPI 分组过滤。"
        />
        <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className={`rounded-full px-2.5 py-1 ${catalog?.stale ? "bg-[#fff3d6] text-[#8a6116]" : "bg-[#e6f3ed] text-[#28664f]"}`}>
            {catalog ? (catalog.stale ? "目录数据为估算/已验证快照" : "目录数据已更新") : "正在读取目录"}
          </span>
          {catalog?.asOf && <span>数据时间：{new Date(catalog.asOf).toLocaleString("zh-CN")}</span>}
        </div>

        {loadState === "loading" && <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle size={17} className="animate-spin" />正在加载模型目录…</div>}
        {loadState === "error" && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded border border-red-200 bg-white px-3 font-semibold"><RefreshCw size={14} />重试</button></div>}

        {catalog && (
          <>
            <div className="mt-9 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 sm:grid-cols-[1fr_auto] sm:p-4">
              <label className="relative block"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-[var(--muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="field pl-9" placeholder="搜索模型名称或用途" /></label>
              <div className="flex gap-1 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-1 text-xs font-semibold">
                {([["all", "全部"], ["image", "图像模型"], ["chat", "聊天模型"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded px-3 py-2 ${filter === value ? "bg-[var(--panel)] text-[var(--rose)] shadow-sm" : "text-[var(--muted)]"}`}>{label}</button>)}
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {models.map((model) => <ModelCard key={model.id} model={model} />)}
            </div>
            {!models.length && <div className="py-20 text-center text-sm text-[var(--muted)]">没有匹配的模型。</div>}

            <section className="mt-12 grid gap-4 md:grid-cols-2">
              <article className="rounded-xl bg-[#292d2c] p-6 text-white"><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#d9c9a5]">Ready to create?</p><h2 className="mt-2 font-[var(--font-display)] text-2xl">从一个想法开始</h2><p className="mt-3 text-sm leading-6 text-white/65">体验模式可以先熟悉参数布局；登录后才能使用你的 NewAPI 余额、模型权限和 LFN 额度。</p><div className="mt-5 flex flex-wrap gap-2"><Link href="/image?demo=1" className="inline-flex h-9 items-center gap-2 rounded bg-white px-3 text-xs font-semibold text-[#292d2c]">进入体验模式 <ArrowRight size={14} /></Link><Link href="/sign-in" className="inline-flex h-9 items-center rounded border border-white/25 px-3 text-xs font-semibold">登录账号</Link></div></article>
              <article className="panel rounded-xl p-6"><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">Pricing context</p><h2 className="mt-2 font-[var(--font-display)] text-2xl">想知道怎么计费？</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">价格会随模型、尺寸、steps、张数、参考图和多角色参数变化。价格页提供本地计算器，并按人民币展示。</p><Link href="/pricing#calculator" className="mt-5 inline-flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--rose)]">打开价格计算器 <ArrowRight size={14} /></Link></article>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function ModelCard({ model }: { model: PublicModel }) {
  const image = model.kind === "image";
  const pricing = model.pricing;
  return <article className="group flex flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_30px_rgba(54,47,39,.04)] transition-transform hover:-translate-y-0.5">
    <div className="flex items-start gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${image ? "bg-[#f8e8e9] text-[var(--rose)]" : "bg-[#e6f3ed] text-[#28664f]"}`}>{image ? <ImageIcon size={20} /> : <MessageCircle size={20} />}</div><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{model.name}</h2><span className="shrink-0 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--muted)]">{image ? "图像" : "聊天"}</span></div><p className="mt-1 truncate text-[11px] text-[var(--muted)]">{model.id}</p></div></div>
    <p className="mt-4 min-h-10 text-sm leading-5 text-[var(--muted)]">{model.summary}</p>
    <div className="mt-4 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <span key={capability} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{capability}</span>)}</div>
    <div className="mt-5 border-t border-[var(--line)] pt-4 text-xs">{pricing ? pricing.billingMode === "tiered" ? <><b className="text-[var(--ink)]">档内固定价格</b><p className="mt-1 text-[var(--muted)]">满足限制范围时按固定价格，超出后转为动态计价。</p></> : pricing.billingMode === "per_request" ? <><b className="text-[var(--ink)]">按次计价</b><p className="mt-1 text-[var(--muted)]">每次请求根据公开分组倍率展示。</p></> : <><b className="text-[var(--ink)]">按 token 计价</b><p className="mt-1 text-[var(--muted)]">根据估算 token 数量计算。</p></> : <p className="text-[var(--muted)]">当前暂无实时价格。</p>}</div>
    {image && <Link href="/pricing#calculator" className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white group-hover:bg-[var(--rose)]">计算这个模型 <ArrowRight size={14} /></Link>}
  </article>;
}
