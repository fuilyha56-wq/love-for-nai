"use client";

import {
  Calculator,
  Check,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PopupSelect, type SelectOption } from "@/app/ui/popup-select";
import { PublicHeader, PublicPageIntro } from "@/app/public-header";
import {
  envelopeUsageTokens,
  estimatePoints,
  estimateTokens,
  usesLimitPricing,
  TOKENS_PER_POINT,
  type ImagePricingGeneration,
} from "@/lib/image-pricing";
import type { PublicCatalog, PublicModel } from "@/lib/public-catalog";

type FormState = {
  model: string;
  operation: "generate" | "img2img" | "inpainting";
  width: number;
  height: number;
  steps: number;
  samples: number;
  references: number;
  characters: number;
};

const initialForm: FormState = {
  model: "",
  operation: "generate",
  width: 832,
  height: 1216,
  steps: 28,
  samples: 1,
  references: 0,
  characters: 0,
};

const operationOptions: SelectOption[] = [
  { value: "generate", label: "文生图" },
  { value: "img2img", label: "图生图" },
  { value: "inpainting", label: "局部重绘" },
];

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
    return `${formatUsd(pricing.liveUsdPerRequest)} / 档内张；${formatUsd(pricing.liveUsdPerUsageToken, 4)} / 档外 usage token`;
  if (pricing.liveType === "per_token")
    return `${formatUsd(pricing.liveUsdPerUsageToken, 4)} / usage token`;
  return "暂无实时价格";
}

export default function PricingPage() {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(initialForm);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError("");
    try {
      const response = await fetch("/api/public/catalog", { cache: "no-store" });
      const result = (await response.json()) as PublicCatalog & { message?: string };
      if (!response.ok || !Array.isArray(result.models))
        throw new Error(result.message || "价格目录读取失败");
      setCatalog(result);
      setLoadState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "价格目录读取失败，请稍后重试");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const imageModels = useMemo(
    () => catalog?.models.filter((model) => model.kind === "image") || [],
    [catalog],
  );
  const selectedModel = imageModels.find((model) => model.id === form.model) || imageModels[0] || null;
  const activeModelId = selectedModel?.id || "";
  const generation: ImagePricingGeneration = {
    model: activeModelId || "nai-v5-full",
    operation: form.operation,
    width: form.width,
    height: form.height,
    steps: form.steps,
    samples: form.samples,
    referenceImageCount: form.references,
    characterPromptCount: form.characters,
  };
  const inEnvelope = usesLimitPricing(generation);
  const invalidLimit = activeModelId.endsWith("-limit") && !inEnvelope;
  const estimatedTokens = inEnvelope
    ? envelopeUsageTokens(generation.model)
    : estimateTokens(generation);
  const estimatedPoints = estimatePoints(generation);
  const publicPricing = selectedModel?.pricing;
  const liveUsd = publicPricing?.liveType === "per_request" && publicPricing.liveUsdPerRequest != null
    ? Number((publicPricing.liveUsdPerRequest * form.samples).toFixed(4))
    : publicPricing?.liveType === "tiered"
      ? inEnvelope && publicPricing.liveUsdPerRequest != null
        ? Number((publicPricing.liveUsdPerRequest * form.samples).toFixed(4))
        : !inEnvelope && publicPricing.liveUsdPerUsageToken != null
          ? Number((publicPricing.liveUsdPerUsageToken * estimatedTokens).toFixed(4))
          : null
      : publicPricing?.liveType === "per_token" && publicPricing.liveUsdPerUsageToken != null
        ? Number((publicPricing.liveUsdPerUsageToken * estimatedTokens).toFixed(4))
        : null;

  function updateNumber(
    key: keyof Pick<FormState, "width" | "height" | "steps" | "samples" | "references" | "characters">,
    value: string,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setForm((current) => ({ ...current, [key]: Math.min(key === "samples" ? 6 : key === "steps" ? 50 : key === "references" ? 12 : key === "characters" ? 6 : 1600, Math.max(key === "references" || key === "characters" ? 0 : key === "width" || key === "height" ? 64 : 1, Math.round(parsed))) }));
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="pricing" />
      <section className="mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-7 sm:pt-14">
        <PublicPageIntro
          eyebrow="Pricing / 价格"
          title="每次创作，消耗清清楚楚。"
          description="统一使用美元展示余额与消耗。按当前 NewAPI 配置估价；档内按张、档外按 usage token 结算，具体金额取决于模型和账号分组。"
        />
        <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className={`rounded-full px-2.5 py-1 ${catalog?.stale ? "bg-[#fff3d6] text-[#8a6116]" : "bg-[#e6f3ed] text-[#28664f]"}`}>
            {catalog ? (catalog.source === "fallback" ? "价格不可用" : catalog.source === "snapshot" ? "显示上次价格快照" : "NewAPI 公开价格已读取") : "正在读取价格"}
          </span>
          {catalog && <span>{catalog.conversion}</span>}
          {catalog?.asOf && <span>数据时间：{new Date(catalog.asOf).toLocaleString("zh-CN")}</span>}
        </div>
        {loadState === "error" && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded border border-red-200 bg-white px-3 font-semibold"><RefreshCw size={14} />重试</button></div>}
        {loadState === "loading" && <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle size={17} className="animate-spin" />正在读取 NewAPI 价格…</div>}

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

          <section id="calculator" className="mt-12 scroll-mt-20 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--rose)] text-white"><Calculator size={20} /></div><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">Local calculator</p><h2 className="mt-1 font-[var(--font-display)] text-3xl">价格计算器</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">本计算器按一次性单请求估价；工作台逐张模式会分别计算每张价格。</p></div></div><div className="mt-7 grid gap-7 lg:grid-cols-[1.1fr_.9fr]"><div className="grid gap-4 sm:grid-cols-2"><label className="flex flex-col gap-2 text-xs font-semibold sm:col-span-2">模型<PopupSelect ariaLabel="模型" value={activeModelId} options={imageModels.map((model) => ({ value: model.id, label: `${model.name} · ${model.id}` }))} onChange={(value) => setForm((current) => ({ ...current, model: value }))} searchable searchPlaceholder="搜索模型" /></label><label className="flex flex-col gap-2 text-xs font-semibold">操作<PopupSelect ariaLabel="操作" value={form.operation} options={operationOptions} onChange={(value) => setForm((current) => ({ ...current, operation: value as FormState["operation"] }))} /></label><label className="flex flex-col gap-2 text-xs font-semibold">生成张数<input className="field" type="number" min={1} max={6} value={form.samples} onChange={(event) => updateNumber("samples", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">宽度<input className="field" type="number" min={64} max={1600} step={8} value={form.width} onChange={(event) => updateNumber("width", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">高度<input className="field" type="number" min={64} max={1600} step={8} value={form.height} onChange={(event) => updateNumber("height", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">Steps<input className="field" type="number" min={1} max={50} value={form.steps} onChange={(event) => updateNumber("steps", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">参考图数量<input className="field" type="number" min={0} max={12} value={form.references} onChange={(event) => updateNumber("references", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">多角色数量<input className="field" type="number" min={0} max={6} value={form.characters} onChange={(event) => updateNumber("characters", event.target.value)} /></label></div><div className="rounded-xl bg-[var(--surface-muted)] p-5"><div className="flex items-center justify-between gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${inEnvelope ? "bg-[#e6f3ed] text-[#28664f]" : "bg-[#fff3d6] text-[#8a6116]"}`}>{inEnvelope ? "满足档内限制" : "超出档内限制"}</span><span className="text-[10px] text-[var(--muted)]">{(form.width * form.height).toLocaleString("zh-CN")} px</span></div><dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">NewAPI 公开分组预估</span><b>{liveUsd == null ? "暂无实时金额" : `${formatUsd(liveUsd)} / 本次`}</b></div><small className="block text-right text-xs font-normal text-[var(--muted)]">{selectedModel?.pricing?.liveType === "per_request" ? "按张实时计价" : selectedModel?.pricing?.liveType === "tiered" ? inEnvelope ? "档内按张，档外按 usage token" : "档外按 usage token" : selectedModel?.pricing?.liveType === "per_token" ? "按 usage token" : "等待实时计价数据"}</small><div className="flex justify-between gap-4 border-b border-[var(--line)] pb-3"><dt className="text-[var(--muted)]">计费积分换算</dt><dd className="text-right font-semibold">{inEnvelope ? "固定档内" : `${estimatedPoints} 计费积分`}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">usage token</dt><dd className="font-semibold">{estimatedTokens.toLocaleString("zh-CN")}</dd></div></dl><div className="mt-5 space-y-2 text-xs leading-5 text-[var(--muted)]"><p className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-[var(--mint)]" />档外先按生成参数计算计费积分（V5 含销售倍率），再乘 {TOKENS_PER_POINT} 得到 usage token；档内使用固定 usage token。</p><p>{invalidLimit ? "限制模型仅支持单张、最多 28 步、最多 1024² 像素且无未编码参考图。请调整参数或选择完整版。" : liveUsd == null ? "暂无实时价格，无法估算 quota。" : `预计消耗 ${Math.round(liveUsd * 500_000).toLocaleString("zh-CN")} quota。此处使用公开 ${publicPricing?.liveGroupName ?? "所选"} 分组价格；登录工作台以账号实际分组为准。`}</p></div></div></div></section>
        </>}
      </section>
    </main>
  );
}
