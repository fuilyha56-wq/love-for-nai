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
import { PublicHeader, PublicPageIntro } from "@/mobile/public-header";
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
            {catalog ? (catalog.source === "fallback" ? "价格不可用" : catalog.source === "snapshot" ? "显示上次价格快照" : "目录数据已更新") : "正在读取目录"}
          </span>
          {catalog?.asOf && catalog.source !== "fallback" && <span>数据时间：{new Date(catalog.asOf).toLocaleString("zh-CN")}</span>}
        </div>

        {loadState === "loading" && <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle size={17} className="animate-spin" />正在加载模型目录…</div>}
        {loadState === "error" && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded border border-red-200 bg-white px-3 font-semibold"><RefreshCw size={14} />重试</button></div>}

        {catalog && (
          <>
            <div className="mt-9 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 sm:grid-cols-[1fr_auto] sm:p-4">
              <label className="model-catalog-search relative block"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-[var(--muted)]" aria-hidden="true" /><input aria-label="搜索模型名称或用途" value={query} onChange={(event) => setQuery(event.target.value)} className="field pl-9" placeholder="搜索模型名称或用途" /></label>
              <div className="flex gap-1 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-1 text-xs font-semibold">
                {([["all", "全部"], ["image", "图像模型"], ["chat", "聊天模型"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded px-3 py-2 ${filter === value ? "bg-[var(--panel)] text-[var(--rose)] shadow-sm" : "text-[var(--muted)]"}`}>{label}</button>)}
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {models.map((model) => <ModelCard key={model.id} model={model} source={catalog.source} />)}
            </div>
            {!models.length && <div className="py-20 text-center text-sm text-[var(--muted)]">没有匹配的模型。</div>}


          </>
        )}
      </section>
    </main>
  );
}

function formatLiveUsd(value: number | undefined, digits?: number): string {
  if (value == null || !Number.isFinite(value)) return "价格不可用";
  const places = digits ?? (value > 0 && value < 0.01 ? 4 : 2);
  return `$${value.toFixed(places)}`;
}

function ModelCard({ model, source }: { model: PublicModel; source: PublicCatalog["source"] }) {
  const image = model.kind === "image";
  const pricing = model.pricing;
  const priceLabel = source === "snapshot" ? "上次价格快照" : "NewAPI 公开价";
  return <article className="group flex flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_30px_rgba(54,47,39,.04)] transition-transform hover:-translate-y-0.5">
    <div className="flex items-start gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${image ? "bg-[#f8e8e9] text-[var(--rose)]" : "bg-[#e6f3ed] text-[#28664f]"}`}>{image ? <ImageIcon size={20} /> : <MessageCircle size={20} />}</div><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{model.name}</h2><span className="shrink-0 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--muted)]">{image ? "图像" : "聊天"}</span></div><p className="mt-1 truncate text-[11px] text-[var(--muted)]">{model.id}</p></div></div>
    <p className="mt-4 min-h-10 text-sm leading-5 text-[var(--muted)]">{model.summary}</p>
    <div className="mt-4 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <span key={capability} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{capability}</span>)}</div>
    <div className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-xs">
      {pricing?.liveType === "tiered" && <>
        <p className="font-semibold">{priceLabel} · 分档计费</p>
        <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">档内单张</span><b>{formatLiveUsd(pricing.liveUsdPerRequest)} / 张</b></div>
        <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">档外用量</span><b>{formatLiveUsd(pricing.liveUsdPerUsageToken, 4)} / usage token</b></div>
      </>}
      {pricing?.liveType === "per_request" && <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">{priceLabel}</span><b>{formatLiveUsd(pricing.liveUsdPerRequest)} / 次</b></div>}
      {pricing?.liveType === "per_token" && <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">{priceLabel}</span><b>{formatLiveUsd(pricing.liveUsdPerUsageToken, 4)} / usage token</b></div>}
      {(!pricing || pricing.liveType === "unknown") && <p className="font-semibold text-[var(--muted)]">当前价格不可用</p>}
      {pricing?.note && <p className="text-[10px] leading-5 text-[var(--muted)]">{pricing.note}</p>}
    </div>
    {image && <Link href="/pricing#calculator" className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white group-hover:bg-[var(--rose)]">计算这个模型 <ArrowRight size={14} /></Link>}
  </article>;
}
