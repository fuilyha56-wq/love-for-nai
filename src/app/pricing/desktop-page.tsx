"use client";

import {
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { PopupSelect } from "@/app/ui/popup-select";
import { PublicHeader, PublicPageIntro } from "@/app/public-header";
import { PublicPriceCalculator } from "@/app/ui/public-price-calculator";
import { TOKENS_PER_POINT } from "@/lib/image-pricing";
import { useCreditPricing, useLivePublicPricingCatalog } from "@/lib/client-credit-pricing";
import { CreditPriceTables } from "@/app/ui/credit-pricing";
import type { PublicModel } from "@/lib/public-catalog";

function formatUsd(value: number | null | undefined, digits?: number): string {
  if (value == null || !Number.isFinite(value)) return "暂无实时价格";
  const places = digits ?? (value > 0 && value < 0.01 ? 4 : 2);
  return `$${value.toFixed(places)}`;
}

function livePriceLabel(model: PublicModel): string {
  const pricing = model.pricing;
  if (!pricing) return "暂无实时价格";
  if (pricing.liveType === "per_request")
    return `${formatUsd(pricing.liveUsdPerRequest)} / 张`;
  if (pricing.liveType === "tiered")
    return `${formatUsd(pricing.liveUsdPerRequest)} / 档内张；${formatUsd(pricing.liveUsdPerUsageToken, 4)} / 档外 usage token${pricing.liveBaseUsdPerImage ? ` + ${formatUsd(pricing.liveBaseUsdPerImage)} / 生图张` : ""}`;
  if (pricing.liveType === "per_token")
    return `${formatUsd(pricing.liveUsdPerUsageToken, 4)} / usage token`;
  return "暂无实时价格";
}

export default function PricingPage() {
  const creditPricing = useCreditPricing();
  const { data: catalog, error, loading, refresh } = useLivePublicPricingCatalog();

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="pricing" />
      <section className="mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-7 sm:pt-14">
        <PublicPageIntro
          eyebrow="Pricing / 价格"
          title="每次创作，消耗清清楚楚。"
          description="LFN 按人民币面值计费，1 AFF＝¥0.005。本站 AFF / 图包价格与每日阶梯由下表实时读取。NewAPI 余额按其当前配置估价；档内按张、档外按 usage token 结算，具体金额取决于模型和账号分组。"
        />
        <section className="credit-price-public" aria-label="本站 AFF 与图包实时定价">
          <h2 className="mt-7 text-xl font-semibold">本站 AFF / 图包定价</h2>
          {creditPricing.data && <CreditPriceTables pricing={creditPricing.data} />}
          {creditPricing.error && <p className="credit-price-warning">{creditPricing.error}</p>}
          <button type="button" className="credit-pricing-trigger" disabled={creditPricing.loading} onClick={() => void creditPricing.refresh()}><RefreshCw size={14} />{creditPricing.loading ? "读取中" : "刷新本站价格"}</button>
        </section>
        <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className={`rounded-full px-2.5 py-1 ${catalog?.stale ? "bg-[#fff3d6] text-[#8a6116]" : "bg-[#e6f3ed] text-[#28664f]"}`}>
            {catalog ? (catalog.source === "fallback" ? "价格不可用" : catalog.source === "snapshot" ? "显示上次价格快照" : "NewAPI 公开价格已读取") : "正在读取价格"}
          </span>
          {catalog && <span>{catalog.conversion}</span>}
          {catalog?.asOf && <span>数据时间：{new Date(catalog.asOf).toLocaleString("zh-CN")}</span>}
        </div>
        {error && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => void refresh()} className="inline-flex h-9 items-center gap-2 rounded border border-red-200 bg-white px-3 font-semibold"><RefreshCw size={14} />重试</button></div>}
        {loading && <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle size={17} className="animate-spin" />正在读取 NewAPI 价格…</div>}

        {catalog && <>
          <section className="mt-10 grid gap-4 lg:grid-cols-3">
            <article className="panel rounded-xl p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">NewAPI live price</p><h2 className="mt-2 font-[var(--font-display)] text-2xl">实时 NewAPI 价格</h2></div><WandSparkles className="text-[var(--rose)]" size={24} /></div>
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">模型卡中的价格来自 NewAPI 当前公开计价接口，并按模型可用的公开分组倍率换算成美元。分档模型会分别展示档内和档外价格。</p>
              <p className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">公开价格用于比较；登录工作台会按账号实际可用分组重新估价。真实扣费以请求发生时的账单为准。</p>
            </article>
            <article className="rounded-xl bg-[#292d2c] p-5 text-white shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#d9c9a5]">Billing rules</p><h2 className="mt-2 font-[var(--font-display)] text-2xl">计价规则</h2><div className="mt-4 space-y-2 text-sm leading-6 text-white/75"><p><b className="text-white">1 计费积分 = {TOKENS_PER_POINT} usage token</b></p><p>单张符合限制时按档内固定价格结算。</p><p>一次请求多张或超出限制时，按 usage token 和当前分组价格结算。</p></div><p className="mt-4 text-xs leading-5 text-white/50">500,000 quota = $1。工作台会按登录账号的实际分组另行估价。</p></article>
          </section>

          <section className="mt-10"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">Model pricing</p><h2 className="mt-2 font-[var(--font-display)] text-3xl">模型价格表</h2></div><Link href="/models" className="text-xs font-semibold text-[var(--rose)] hover:underline">查看模型目录 →</Link></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.models.map((model) => <article key={model.id} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_30px_rgba(54,47,39,.04)]"><div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${model.kind === "image" ? "bg-[#f8e8e9] text-[var(--rose)]" : "bg-[#e6f3ed] text-[#28664f]"}`}>{model.kind === "image" ? <ImageIcon size={18} /> : <Sparkles size={18} />}</div><div className="min-w-0"><h3 className="truncate font-semibold">{model.name}</h3><p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{model.id}</p></div></div><p className="mt-4 text-xs leading-5 text-[var(--muted)]">{model.summary}</p><div className="mt-4 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <span key={capability} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{capability}</span>)}</div><div className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-xs"><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">NewAPI 公开价</span><b>{livePriceLabel(model)}</b></div>{model.pricing && <p className="pt-1 text-[10px] leading-5 text-[var(--muted)]">{model.pricing.note}</p>}</div></article>)}</div></section>
        </>}

        <PublicPriceCalculator models={catalog?.models ?? []} pricing={creditPricing.data} Select={PopupSelect} />
      </section>
    </main>
  );
}
