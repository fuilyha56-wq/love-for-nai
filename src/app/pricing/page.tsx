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
import {
  PublicHeader,
  PublicPageIntro,
} from "@/app/public-header";
import {
  affCost,
  estimateNewApiCost,
  estimateTokens,
  isInFreeEnvelope,
  newApiBalanceToCny,
  type ImagePricingGeneration,
  type ModelPricingSnapshot,
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

function formatCny(value: number): string {
  if (!Number.isFinite(value)) return "暂不可估算";
  if (value > 0 && value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function publicToSnapshot(model: PublicModel): ModelPricingSnapshot | null {
  const pricing = model.pricing;
  if (!pricing) return null;
  return {
    model: model.id,
    modelRatio: pricing.perMillionTokensBalance
      ? pricing.perMillionTokensBalance / 2
      : 0,
    modelPrice: pricing.perRequestBalance || 0,
    quotaType: pricing.billingMode === "per_request" ? 1 : 0,
    groupRatio: pricing.groupRatio,
    tiered: pricing.billingMode === "tiered",
    inEnvelopeUsd: pricing.inEnvelopeBalance,
    outOfEnvelopeUsdPerMillion: pricing.outOfEnvelopeBalancePerMillion,
  };
}

function statusCopy(stale: boolean, source: PublicCatalog["source"]): string {
  if (!stale && source === "upstream") return "价格数据已更新";
  if (source === "snapshot") return "上游暂不可用，显示最近一次已验证数据";
  return "当前为内置展示目录与估算价格";
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
  const selectedPricing = selectedModel?.pricing || null;

  const activeModelId = selectedModel?.id || "";

  const generation: ImagePricingGeneration = {
    model: selectedModel?.id || "nai-v5-full",
    operation: form.operation,
    width: form.width,
    height: form.height,
    steps: form.steps,
    samples: form.samples,
    referenceImageCount: form.references,
    characterPromptCount: form.characters,
  };
  const snapshot = selectedModel ? publicToSnapshot(selectedModel) : null;
  const inEnvelope = isInFreeEnvelope(generation);
  const estimatedNewApi = selectedPricing ? estimateNewApiCost(snapshot, generation) : null;
  const estimatedAff = selectedModel ? affCost(generation) : null;
  const estimatedTokens = estimateTokens(form.width, form.height, form.samples);

  function updateNumber(key: keyof Pick<FormState, "width" | "height" | "steps" | "samples" | "references" | "characters">, value: string) {
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
          title="先看清规则，再开始创作。"
          description="把 NewAPI 的模型计价、LFN 的 AFF 额度和图包优先规则放在一起。这里的计算器只在浏览器本地运行，不会读取登录态或发送你的提示词。"
        />

        <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className={`rounded-full px-2.5 py-1 ${catalog?.stale ? "bg-[#fff3d6] text-[#8a6116]" : "bg-[#e6f3ed] text-[#28664f]"}`}>
            {catalog ? statusCopy(catalog.stale, catalog.source) : "正在读取价格"}
          </span>
          {catalog && <span>{catalog.conversion}</span>}
          {catalog?.asOf && <span>数据时间：{new Date(catalog.asOf).toLocaleString("zh-CN")}</span>}
        </div>

        {loadState === "error" && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded border border-red-200 bg-white px-3 font-semibold"><RefreshCw size={14} />重试</button>
          </div>
        )}
        {loadState === "loading" && (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle size={17} className="animate-spin" />正在整理模型价格…</div>
        )}

        {catalog && (
          <>
            <section className="mt-10 grid gap-4 lg:grid-cols-3">
              <article className="panel rounded-xl p-5 lg:col-span-2">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">LFN credit route</p><h2 className="mt-2 font-[var(--font-display)] text-2xl">图包与 AFF 怎么扣？</h2></div>
                  <WandSparkles className="text-[var(--rose)]" size={24} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {["图包额度优先", "个人 AFF 补足", "都不足才走 NewAPI"].map((label, index) => (
                    <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--rose)] text-xs font-bold text-white">{index + 1}</span>
                      <b className="mt-3 block text-sm">{label}</b>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{index === 0 ? "购买图包获得独立额度，每分钟最多使用 10 张。" : index === 1 ? "签到、邀请和管理员发放进入个人 AFF。" : "最终按请求发生时的 NewAPI 分组倍率结算。"}</p>
                    </div>
                  ))}
                </div>
              </article>
              <article className="rounded-xl bg-[#292d2c] p-5 text-white shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#d9c9a5]">Currency</p>
                <h2 className="mt-2 font-[var(--font-display)] text-2xl">人民币展示</h2>
                <p className="mt-4 text-sm leading-7 text-white/70">页面统一把 NewAPI 余额单位折算为人民币：<b className="text-white">200 余额单位 = ¥1</b>。AFF 是额度，不是人民币，不能兑换或提现。</p>
                <Link href="/sign-in" className="mt-5 inline-flex h-9 items-center rounded border border-white/30 px-3 text-xs font-semibold hover:bg-white/10">登录查看个人实时倍率</Link>
              </article>
            </section>

            <section className="mt-10">
              <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">Model pricing</p><h2 className="mt-2 font-[var(--font-display)] text-3xl">模型计费定价</h2></div><Link href="/models" className="text-xs font-semibold text-[var(--rose)] hover:underline">查看模型目录 →</Link></div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {catalog.models.map((model) => (
                  <article key={model.id} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_30px_rgba(54,47,39,.04)]">
                    <div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${model.kind === "image" ? "bg-[#f8e8e9] text-[var(--rose)]" : "bg-[#e6f3ed] text-[#28664f]"}`}>{model.kind === "image" ? <ImageIcon size={18} /> : <Sparkles size={18} />}</div><div className="min-w-0"><h3 className="truncate font-semibold">{model.name}</h3><p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{model.id}</p></div></div>
                    <p className="mt-4 text-xs leading-5 text-[var(--muted)]">{model.summary}</p>
                    <div className="mt-4 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <span key={capability} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{capability}</span>)}</div>
                    <div className="mt-5 border-t border-[var(--line)] pt-4 text-xs">{model.pricing ? <>{model.pricing.billingMode === "tiered" && <><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">档内固定价</span><b>{formatCny(model.pricing.inEnvelopeCny || 0)} / 张</b></div><div className="mt-2 flex justify-between gap-3"><span className="text-[var(--muted)]">档外动态价</span><b>{formatCny(model.pricing.outOfEnvelopeCnyPerMillion || 0)} / 百万 token</b></div></>}{model.pricing.billingMode === "per_request" && <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">按次计费</span><b>{formatCny(model.pricing.perRequestCny || 0)} / 次</b></div>}{model.pricing.billingMode === "per_token" && <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">按 token 计费</span><b>{formatCny(model.pricing.perMillionTokensCny || 0)} / 百万 token</b></div>}<p className="mt-3 text-[10px] leading-5 text-[var(--muted)]">{model.pricing.note}</p></> : <p className="text-[var(--muted)]">暂无实时价格，仅展示模型目录。</p>}</div>
                  </article>
                ))}
              </div>
            </section>

            <section id="calculator" className="mt-12 scroll-mt-20 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7">
              <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--rose)] text-white"><Calculator size={20} /></div><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--rose)]">Local calculator</p><h2 className="mt-1 font-[var(--font-display)] text-3xl">价格计算器</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">调整参数即可实时估算。实际扣费仍以请求发生时的服务端计价为准。</p></div></div>
              <div className="mt-7 grid gap-7 lg:grid-cols-[1.1fr_.9fr]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold sm:col-span-2">模型<select className="field mt-2" value={activeModelId} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}</select></label>
                  <label className="text-xs font-semibold">操作<select className="field mt-2" value={form.operation} onChange={(event) => setForm((current) => ({ ...current, operation: event.target.value as FormState["operation"] }))}><option value="generate">文生图</option><option value="img2img">图生图</option><option value="inpainting">局部重绘</option></select></label>
                  <label className="text-xs font-semibold">生成张数<input className="field mt-2" type="number" min={1} max={8} value={form.samples} onChange={(event) => updateNumber("samples", event.target.value)} /></label>
                  <label className="text-xs font-semibold">宽度<input className="field mt-2" type="number" min={64} max={4096} step={8} value={form.width} onChange={(event) => updateNumber("width", event.target.value)} /></label>
                  <label className="text-xs font-semibold">高度<input className="field mt-2" type="number" min={64} max={4096} step={8} value={form.height} onChange={(event) => updateNumber("height", event.target.value)} /></label>
                  <label className="text-xs font-semibold">Steps<input className="field mt-2" type="number" min={1} max={100} value={form.steps} onChange={(event) => updateNumber("steps", event.target.value)} /></label>
                  <label className="text-xs font-semibold">参考图数量<input className="field mt-2" type="number" min={0} max={8} value={form.references} onChange={(event) => updateNumber("references", event.target.value)} /></label>
                  <label className="text-xs font-semibold">多角色数量<input className="field mt-2" type="number" min={0} max={6} value={form.characters} onChange={(event) => updateNumber("characters", event.target.value)} /></label>
                </div>
                <div className="rounded-xl bg-[var(--surface-muted)] p-5">
                  <div className="flex items-center justify-between gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${inEnvelope ? "bg-[#e6f3ed] text-[#28664f]" : "bg-[#fff3d6] text-[#8a6116]"}`}>{inEnvelope ? "档内固定价" : "档外动态计价"}</span><span className="text-[10px] text-[var(--muted)]">{(form.width * form.height).toLocaleString("zh-CN")} px</span></div>
                  <dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-4 border-b border-[var(--line)] pb-3"><dt className="text-[var(--muted)]">NewAPI 余额估算</dt><dd className="text-right font-semibold">{estimatedNewApi == null ? "暂无价格" : `${estimatedNewApi.toFixed(4)} 单位`}<small className="mt-0.5 block text-xs font-normal text-[var(--rose)]">{estimatedNewApi == null ? "" : formatCny(newApiBalanceToCny(estimatedNewApi))}</small></dd></div><div className="flex justify-between gap-4 border-b border-[var(--line)] pb-3"><dt className="text-[var(--muted)]">LFN AFF 参考</dt><dd className="font-semibold">{estimatedAff == null ? "暂无" : `${estimatedAff} AFF`}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">估算 token</dt><dd className="font-semibold">{estimatedTokens.toLocaleString("zh-CN")}</dd></div></dl>
                  <div className="mt-5 space-y-2 text-xs leading-5 text-[var(--muted)]"><p className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-[var(--mint)]" />档内条件：n=1、steps≤28、≤1024×1024、文生图、无参考图和多角色。</p><p>输入参数仅用于估算，不会改变账户余额；图包与个人 AFF 是否足够由服务端在提交时决定。</p></div>
                </div>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
