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
  estimatePointCny,
  estimatePoints,
  estimateTokens,
  isInFreeEnvelope,
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

function formatCny(value: number | undefined, digits?: number): string {
  if (value == null || !Number.isFinite(value)) return "暂无实时价格";
  const places = digits ?? (value > 0 && value < 0.01 ? 4 : 2);
  return `¥${value.toFixed(places)}`;
}

function livePriceLabel(model: PublicModel): string {
  const pricing = model.pricing;
  if (!pricing) return "暂无实时价格";
  if (pricing.liveType === "per_request")
    return `${formatCny(pricing.liveCnyPerRequest)} / 张`;
  if (pricing.liveType === "tiered")
    return `${formatCny(pricing.liveCnyPerRequest)} / 张起`;
  if (pricing.liveType === "per_token")
    return `${formatCny(pricing.liveCnyPerUsageToken, 4)} / usage token`;
  return "暂无实时价格";
}

function privatePriceLabel(model: PublicModel): string {
  const reference = model.pricing?.privatePointReference;
  if (!reference) return "聊天模型不适用图像积分";
  return `${reference.version}：¥${reference.pointPriceCny.toFixed(2)} / 积分`;
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
  const inEnvelope = isInFreeEnvelope(generation);
  const estimatedTokens = estimateTokens(form.width, form.height, form.samples);
  const estimatedPoints = estimatePoints(generation);
  const privateCny = estimatePointCny(generation);
  const liveCny = selectedModel?.pricing?.liveType === "per_request"
    ? Number(((selectedModel.pricing.liveCnyPerRequest ?? 0) * form.samples).toFixed(4))
    : selectedModel?.pricing?.liveType === "tiered"
      ? inEnvelope
        ? Number(((selectedModel.pricing.liveCnyPerRequest ?? 0) * form.samples).toFixed(4))
        : Number(((selectedModel.pricing.liveCnyPerUsageToken ?? 0) * estimatedTokens).toFixed(4))
      : selectedModel?.pricing?.liveType === "per_token"
        ? Number(((selectedModel.pricing.liveCnyPerUsageToken ?? 0) * estimatedTokens).toFixed(4))
        : null;

  function updateNumber(
    key: keyof Pick<FormState, "width" | "height" | "steps" | "samples" | "references" | "characters">,
    value: string,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setForm((current) => ({ ...current, [key]: Math.max(0, Math.round(parsed)) }));
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="pricing" />
      <section className="mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-7 sm:pt-14">
        <PublicPageIntro
          eyebrow="Pricing / 价格"
          title="实时价格和私立参考，分开看才不会混淆。"
          description="价格表优先展示 NewAPI 当前读取到的真实计价方式；你提供的积分规则作为独立的私立参考，不覆盖 NewAPI，也不改变服务端实际结算。"
        />
        <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className={`rounded-full px-2.5 py-1 ${catalog?.stale ? "bg-[#fff3d6] text-[#8a6116]" : "bg-[#e6f3ed] text-[#28664f]"}`}>
            {catalog ? (catalog.stale ? "实时数据不可用，当前为快照/估算" : "NewAPI 实时价格已读取") : "正在读取价格"}
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
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">模型卡中的实时价格直接来自 NewAPI 当前公开计价接口，并按当前公开 Draw 分组倍率换算成人民币。按次模型按每张显示；分档/按 token 模型会注明实际结算方式。</p>
              <p className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">NewAPI 原始余额、美元和模型价格单位不会与私立积分混算。真实扣费以请求发生时的 NewAPI / LFN 服务端结算为准。</p>
            </article>
            <article className="rounded-xl bg-[#292d2c] p-5 text-white shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#d9c9a5]">Private reference</p><h2 className="mt-2 font-[var(--font-display)] text-2xl">私立积分规则</h2><div className="mt-4 space-y-2 text-sm leading-6 text-white/75"><p><b className="text-white">1 积分 = {TOKENS_PER_POINT} token</b></p><p>V4.5：<b className="text-white">¥0.04 / 积分</b></p><p>V5：<b className="text-white">¥0.06 / 积分</b></p></div><p className="mt-4 text-xs leading-5 text-white/50">这组价格仅作私立参考，不代表当前 NewAPI 实时扣费，也不改变图包/AFF 余额。</p></article>
          </section>

          <section className="mt-10"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">Model pricing</p><h2 className="mt-2 font-[var(--font-display)] text-3xl">模型价格表</h2></div><Link href="/models" className="text-xs font-semibold text-[var(--rose)] hover:underline">查看模型目录 →</Link></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.models.map((model) => <article key={model.id} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_30px_rgba(54,47,39,.04)]"><div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${model.kind === "image" ? "bg-[#f8e8e9] text-[var(--rose)]" : "bg-[#e6f3ed] text-[#28664f]"}`}>{model.kind === "image" ? <ImageIcon size={18} /> : <Sparkles size={18} />}</div><div className="min-w-0"><h3 className="truncate font-semibold">{model.name}</h3><p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{model.id}</p></div></div><p className="mt-4 text-xs leading-5 text-[var(--muted)]">{model.summary}</p><div className="mt-4 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <span key={capability} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{capability}</span>)}</div><div className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-xs"><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">NewAPI 实时</span><b>{livePriceLabel(model)}</b></div><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">私立积分参考</span><b>{privatePriceLabel(model)}</b></div>{model.pricing && <p className="pt-1 text-[10px] leading-5 text-[var(--muted)]">{model.pricing.note}</p>}</div></article>)}</div></section>

          <section id="calculator" className="mt-12 scroll-mt-20 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--rose)] text-white"><Calculator size={20} /></div><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">Local calculator</p><h2 className="mt-1 font-[var(--font-display)] text-3xl">价格计算器</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">实时价格按 NewAPI 计价类型计算；私立积分按你提供的规则单独估算。</p></div></div><div className="mt-7 grid gap-7 lg:grid-cols-[1.1fr_.9fr]"><div className="grid gap-4 sm:grid-cols-2"><label className="flex flex-col gap-2 text-xs font-semibold sm:col-span-2">模型<PopupSelect ariaLabel="模型" value={activeModelId} options={imageModels.map((model) => ({ value: model.id, label: `${model.name} · ${model.id}` }))} onChange={(value) => setForm((current) => ({ ...current, model: value }))} searchable searchPlaceholder="搜索模型" /></label><label className="flex flex-col gap-2 text-xs font-semibold">操作<PopupSelect ariaLabel="操作" value={form.operation} options={operationOptions} onChange={(value) => setForm((current) => ({ ...current, operation: value as FormState["operation"] }))} /></label><label className="flex flex-col gap-2 text-xs font-semibold">生成张数<input className="field" type="number" min={1} max={6} value={form.samples} onChange={(event) => updateNumber("samples", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">宽度<input className="field" type="number" min={64} max={1600} step={8} value={form.width} onChange={(event) => updateNumber("width", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">高度<input className="field" type="number" min={64} max={1600} step={8} value={form.height} onChange={(event) => updateNumber("height", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">Steps<input className="field" type="number" min={1} max={50} value={form.steps} onChange={(event) => updateNumber("steps", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">参考图数量<input className="field" type="number" min={0} max={12} value={form.references} onChange={(event) => updateNumber("references", event.target.value)} /></label><label className="flex flex-col gap-2 text-xs font-semibold">多角色数量<input className="field" type="number" min={0} max={6} value={form.characters} onChange={(event) => updateNumber("characters", event.target.value)} /></label></div><div className="rounded-xl bg-[var(--surface-muted)] p-5"><div className="flex items-center justify-between gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${inEnvelope ? "bg-[#e6f3ed] text-[#28664f]" : "bg-[#fff3d6] text-[#8a6116]"}`}>{inEnvelope ? "满足档内限制" : "超出档内限制"}</span><span className="text-[10px] text-[var(--muted)]">{(form.width * form.height).toLocaleString("zh-CN")} px</span></div><dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">NewAPI 实时</span><b>{liveCny == null ? "暂无实时金额" : `${formatCny(liveCny)} / 本次`}</b></div><small className="block text-right text-xs font-normal text-[var(--muted)]">{selectedModel?.pricing?.liveType === "per_request" ? "按张实时计价" : selectedModel?.pricing?.liveType === "tiered" ? inEnvelope ? "档内按张，档外按 usage token" : "档外按 usage token" : selectedModel?.pricing?.liveType === "per_token" ? "按 usage token" : "等待实时计价数据"}</small><div className="flex justify-between gap-4 border-b border-[var(--line)] pb-3"><dt className="text-[var(--muted)]">私立积分估算</dt><dd className="text-right font-semibold">{estimatedPoints} 积分<small className="mt-0.5 block text-xs font-normal text-[var(--rose)]">{privateCny == null ? "聊天模型不适用" : formatCny(privateCny)}</small></dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">估算 token</dt><dd className="font-semibold">{estimatedTokens.toLocaleString("zh-CN")}</dd></div></dl><div className="mt-5 space-y-2 text-xs leading-5 text-[var(--muted)]"><p className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-[var(--mint)]" />私立规则：估算 token ÷ {TOKENS_PER_POINT} 向上取整为积分。</p><p>积分价格和 NewAPI 实时价格仅用于查看，不会在这里修改账户余额。</p></div></div></div></section>
        </>}
      </section>
    </main>
  );
}
