"use client";

import { Calculator } from "lucide-react";
import { useState, type ComponentType, type ComponentProps } from "react";
import type { PopupSelect } from "@/app/ui/popup-select";
import { formatAff, formatCny, formatNewApiQuote, quoteCredits, type CreditPricing } from "@/lib/credit-pricing";
import {
  billableNaiAnlasCost,
  envelopeUsageTokens,
  estimateNewApiCost,
  estimateTokens,
  NAI_MAX_ANLAS_PER_IMAGE,
  officialNaiAnlasCost,
  upscaleBillingModel,
  upscaleSizeError,
  usesLimitPricing,
  type ImagePricingGeneration,
} from "@/lib/image-pricing";
import { isNaiLimitModel, naiImageSizeError, naiMaxSamples } from "@/lib/nai-image-limits";
import { NAI_UPSCALE_MODEL_OPTIONS } from "@/lib/nai-model-catalog";
import { isNaiMediumModel } from "@/lib/nai-native-request";
import type { PublicModel, PublicModelPricing } from "@/lib/public-catalog";

const operationOptions = [
  { value: "generate", label: "文生图" },
  { value: "img2img", label: "图生图" },
  { value: "inpainting", label: "局部重绘" },
  { value: "outpainting", label: "扩图" },
  { value: "upscale", label: "V5 独立超分 2×" },
  { value: "encode-vibe", label: "Vibe 编码" },
  { value: "director-declutter", label: "导演工具 · 简化画面" },
  { value: "director-bg-remover", label: "导演工具 · 移除背景" },
  { value: "director-lineart", label: "导演工具 · 提取线稿" },
  { value: "director-sketch", label: "导演工具 · 草图化" },
  { value: "director-colorize", label: "导演工具 · 上色" },
  { value: "director-emotion", label: "导演工具 · 表情变换" },
  { value: "annotate", label: "原生 API · 图像标注" },
] as const;

type Operation = typeof operationOptions[number]["value"];

const initialFields = {
  width: "832",
  height: "1216",
  steps: "28",
  samples: "1",
  img2imgStrength: "0.7",
  inpaintStrength: "1",
  uncondScale: "1",
  vibe: "0",
  encoded: "0",
  precise: "0",
};

const fieldClass = "flex min-w-0 flex-col gap-2 text-xs font-semibold";

function supportsModel(model: string, operation: Operation) {
  if (operation === "upscale")
    return NAI_UPSCALE_MODEL_OPTIONS.some(({ value }) => upscaleBillingModel(value) === model);
  if (operation === "inpainting" || operation === "outpainting")
    return model.includes("inpaint") || /^nai-v(?:4\.5|5)-(?:full|curated)(?:-limit|-medium)?$/.test(model);
  if (operation === "encode-vibe" || operation.startsWith("director-"))
    return !isNaiLimitModel(model) && !isNaiMediumModel(model);
  return true;
}

function publicNewApiCost(pricing: PublicModelPricing | null | undefined, generation: ImagePricingGeneration, standalone: boolean) {
  if (!pricing || pricing.billingMode !== "live" || generation.operation === "annotate") return null;
  const { liveType, liveUsdPerRequest, liveUsdPerUsageToken, liveBaseUsdPerImage, hourlyImagePricing } = pricing;
  if (liveType === "per_token") {
    const usageTokens = usesLimitPricing(generation) ? envelopeUsageTokens(generation.model) : estimateTokens(generation);
    return liveUsdPerUsageToken == null ? null : usageTokens * liveUsdPerUsageToken;
  }
  // A per-image model price by itself does not describe its independent tool usage.
  if (liveType === "per_request" && standalone) return null;
  if (liveType !== "tiered" && liveType !== "per_request") return null;
  return estimateNewApiCost({
    model: generation.model,
    // Public catalog values already include the advertised group multiplier.
    groupRatio: 1,
    quotaType: liveType === "per_request" ? 1 : 0,
    modelPrice: liveUsdPerRequest ?? 0,
    modelPriceKnown: liveUsdPerRequest != null,
    modelRatio: 0,
    tiered: liveType === "tiered",
    inEnvelopeUsd: liveUsdPerRequest,
    outOfEnvelopeBalancePerUsageToken: liveUsdPerUsageToken,
    outOfEnvelopeBaseBalancePerImage: liveBaseUsdPerImage,
    hourlyImagePricing,
  }, generation);
}

function calculatorError(generation: ImagePricingGeneration, standalone: boolean) {
  if (!generation.model) return "当前没有支持该操作的模型。";
  if (generation.operation === "upscale") return upscaleSizeError(generation.width, generation.height);
  if (standalone) return null;
  const sizeError = naiImageSizeError(generation.model, generation.width, generation.height);
  if (sizeError) return sizeError;
  if (!Number.isInteger(generation.steps) || generation.steps < 1 || generation.steps > 50)
    return "步数必须是 1–50 的整数。";
  const maxSamples = naiMaxSamples(generation.width, generation.height, generation.model);
  if (!Number.isInteger(generation.samples) || generation.samples < 1 || generation.samples > maxSamples)
    return `当前尺寸和模型每次可生成 1–${maxSamples} 张。`;
  if (generation.strength !== undefined && !(generation.strength >= 0 && generation.strength <= 1))
    return "重绘强度必须在 0 到 1 之间。";
  const uncondScale = generation.uncondScale ?? 1;
  if (!Number.isFinite(uncondScale) || uncondScale < 0)
    return "负向引导倍率必须是非负数。";
  const vibe = generation.vibeReferenceImageCount ?? 0;
  const encoded = generation.encodedVibeCount ?? 0;
  const precise = generation.preciseReferenceImageCount ?? 0;
  if (![vibe, encoded, precise].every((count) => Number.isInteger(count) && count >= 0) || vibe + precise > 12 || encoded > vibe)
    return "Vibe 和精准参考合计最多 12 张，已编码 Vibe 张数不能超过 Vibe 总张数。";
  if (isNaiLimitModel(generation.model) && !usesLimitPricing(generation))
    return "Limit 仅支持单张、最多 28 步、最多 1024² 像素、至多 4 张已编码 Vibe，且不支持精准参考或优先服务。";
  if (officialNaiAnlasCost({
    model: generation.model, width: generation.width, height: generation.height,
    steps: generation.steps, operation: generation.operation, strength: generation.strength, samples: 1,
  }) > NAI_MAX_ANLAS_PER_IMAGE)
    return "单张生成费超过 140 Anlas，请降低分辨率、步数或重绘强度。";
  if (!Number.isFinite(officialNaiAnlasCost(generation))) return "这些参数无法计算费用。";
  return null;
}

export function PublicPriceCalculator({
  models,
  pricing,
  Select,
  mobile = false,
}: {
  models: PublicModel[];
  pricing: CreditPricing | null;
  Select: ComponentType<ComponentProps<typeof PopupSelect>>;
  mobile?: boolean;
}) {
  const [model, setModel] = useState("");
  const [operation, setOperation] = useState<Operation>("generate");
  const [fields, setFields] = useState(initialFields);
  const [priority, setPriority] = useState(false);

  const upscale = operation === "upscale";
  const annotate = operation === "annotate";
  const standalone = upscale || annotate || operation === "encode-vibe" || operation.startsWith("director-");
  const availableModels = models.filter((item) => item.kind === "image" && supportsModel(item.id, operation));
  const selectedModel = annotate ? null : availableModels.find((item) => item.id === model) ?? availableModels[0];
  const modelId = annotate ? "hed" : selectedModel?.id ?? "";
  const medium = isNaiMediumModel(modelId);
  const strengthField = operation === "img2img" ? "img2imgStrength" : operation === "inpainting" || operation === "outpainting" ? "inpaintStrength" : null;
  const generation: ImagePricingGeneration = {
    model: modelId,
    operation,
    width: standalone && !upscale ? 1024 : Number(fields.width),
    height: standalone && !upscale ? 1024 : Number(fields.height),
    samples: standalone ? 1 : Number(fields.samples),
    steps: standalone ? 1 : medium ? 14 : Number(fields.steps),
    strength: strengthField && fields[strengthField] !== "" ? Number(fields[strengthField]) : undefined,
    uncondScale: standalone || medium ? 1 : Number(fields.uncondScale || NaN),
    vibeReferenceImageCount: standalone || medium ? 0 : Number(fields.vibe),
    encodedVibeCount: standalone || medium ? 0 : Number(fields.encoded),
    preciseReferenceImageCount: standalone || medium ? 0 : Number(fields.precise),
    hasInputImage: strengthField !== null,
    serviceTier: !standalone && !medium && priority ? "priority" : undefined,
  };
  const error = calculatorError(generation, standalone);
  const inEnvelope = !error && usesLimitPricing(generation);
  const nativeUpscaleModel = upscale
    ? NAI_UPSCALE_MODEL_OPTIONS.find(({ value }) => upscaleBillingModel(value) === modelId)?.value
    : undefined;
  const localQuote = !error && pricing ? quoteCredits(
    nativeUpscaleModel ? { ...generation, model: nativeUpscaleModel } : generation, pricing,
  ) : null;
  const compatibleUpscaleQuote = !error && pricing && nativeUpscaleModel
    ? quoteCredits(generation, pricing)
    : null;
  const nativeDirectorQuote = !error && pricing && operation.startsWith("director-") && modelId !== "nai-v4.5-full"
    ? quoteCredits({ ...generation, model: "nai-v4.5-full" }, pricing)
    : null;
  const publicPricing = selectedModel?.pricing;
  const newApiCost = error ? null : publicNewApiCost(publicPricing, generation, standalone);
  const estimatedTokens = newApiCost == null || publicPricing?.liveType === "per_request"
    ? null : inEnvelope ? envelopeUsageTokens(modelId) : estimateTokens(generation);

  function numberField(name: keyof typeof initialFields, label: string, min: number, max?: number, step = 1) {
    return (
      <label className={fieldClass}>
        {label}
        <input className="field" type="number" min={min} max={max} step={step} value={fields[name]}
          onChange={(event) => {
            const value = event.target.value;
            setFields((current) => ({ ...current, [name]: value }));
          }} />
      </label>
    );
  }

  return (
    <section id="calculator" className={mobile ? "pricing-calculator" : "mt-12 scroll-mt-20 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_14px_40px_rgba(54,47,39,.06)] sm:p-7"}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--rose)] text-white"><Calculator size={20} /></div>
        <div>
          <h2 className="mt-1 font-[var(--font-display)] text-3xl">价格计算器</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">按一次请求估价。逐张提交时，工作台会分别计算每张费用。</p>
        </div>
      </div>
      <div className={mobile ? "pricing-calculator-content" : "mt-7 grid gap-7 lg:grid-cols-[1.1fr_.9fr]"}>
        <div className={mobile ? "pricing-calculator-fields" : "grid grid-cols-2 content-start gap-3"}>
          <label className={`${fieldClass} col-span-2`}>
            操作
            <Select ariaLabel="操作" value={operation} options={[...operationOptions]} onChange={(value) => setOperation(value as Operation)} />
          </label>
          {!annotate && <label className={`${fieldClass} col-span-2`}>
            模型
            <Select ariaLabel="模型" value={modelId} options={availableModels.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))}
              onChange={setModel} searchable searchPlaceholder="搜索模型" disabled={!availableModels.length} />
          </label>}
          {!standalone && numberField("samples", "生成张数", 1, naiMaxSamples(generation.width, generation.height, modelId))}
          {(!standalone || upscale) && <>
            {numberField("width", upscale ? "源图宽度" : "宽度", upscale ? 1 : 64, undefined, upscale ? 1 : 64)}
            {numberField("height", upscale ? "源图高度" : "高度", upscale ? 1 : 64, undefined, upscale ? 1 : 64)}
          </>}
          {!standalone && (medium
            ? <label className={fieldClass}>步数<input className="field" type="number" value={14} readOnly /></label>
            : numberField("steps", "步数", 1, 50))}
          {strengthField && numberField(strengthField, "重绘强度", 0, 1, 0.01)}
          {!standalone && !medium && <>
            {numberField("uncondScale", "负向引导倍率", 0, undefined, 0.01)}
            {numberField("vibe", "Vibe 参考张数", 0, 12)}
            {numberField("encoded", "已编码 Vibe 张数", 0, 12)}
            {numberField("precise", "精准参考张数", 0, 12)}
            <label className="col-span-2 flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" checked={priority} onChange={(event) => setPriority(event.target.checked)} />
              优先服务（priority）
            </label>
          </>}
        </div>
        <div className="rounded-xl bg-[var(--surface-muted)] p-5" aria-live="polite">
          {error ? <p className="text-sm text-[var(--rose)]">{error}</p> : <>
            <p className="text-xs font-semibold text-[var(--muted)]">
              {upscale ? `输出 ${generation.width * 2} × ${generation.height * 2}` : standalone ? "独立工具" : inEnvelope ? "满足小图档条件" : "按常规档报价"}
            </p>
            <dl className="mt-5 space-y-4 text-sm">
              {!annotate && <div className="flex justify-between gap-3"><dt>官方 Anlas{standalone ? "" : "（未抵扣）"}</dt><dd>{officialNaiAnlasCost(generation)}</dd></div>}
              {!standalone && <div className="flex justify-between gap-3"><dt>LFN 计费 Anlas</dt><dd>{billableNaiAnlasCost(generation)}</dd></div>}
              <div className="flex justify-between gap-3">
                <dt>{standalone ? "LFN 独立工具费用" : "LFN 每日首档费用"}</dt>
                <dd>{localQuote ? `${formatAff(localQuote.costAff)} AFF / ¥${formatCny(localQuote.costCny)}` : "暂无本站报价"}</dd>
              </div>
              {compatibleUpscaleQuote && compatibleUpscaleQuote.costAff !== localQuote?.costAff &&
                <div className="flex justify-between gap-3">
                  <dt>LFN OpenAI 兼容超分费用</dt>
                  <dd>{formatAff(compatibleUpscaleQuote.costAff)} AFF / ¥{formatCny(compatibleUpscaleQuote.costCny)}</dd>
                </div>}
              {nativeDirectorQuote && nativeDirectorQuote.costAff !== localQuote?.costAff &&
                <div className="flex justify-between gap-3">
                  <dt>LFN 原生 Director 费用</dt>
                  <dd>{formatAff(nativeDirectorQuote.costAff)} AFF / ¥{formatCny(nativeDirectorQuote.costCny)}</dd>
                </div>}
              <div className="flex justify-between gap-3">
                <dt>NewAPI 公开分组预估</dt>
                <dd>{newApiCost == null ? "该操作暂无可用报价" : `${formatNewApiQuote(newApiCost)} / 本次`}</dd>
              </div>
              {estimatedTokens != null && <div className="flex justify-between gap-3"><dt>usage token</dt><dd>{estimatedTokens.toLocaleString("zh-CN")}</dd></div>}
            </dl>
            {newApiCost != null && <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              NewAPI 使用公开 {publicPricing?.liveGroupName ?? "模型"} 分组。登录后的实际价格按账号分组计算。
            </p>}
            {operation.startsWith("director-") && <p className="mt-4 text-xs leading-5 text-[var(--muted)]">原生 Director API 固定使用 V4.5 Full 计费，工作台和兼容接口按所选模型报价。</p>}
            {upscale && <p className="mt-4 text-xs leading-5 text-[var(--muted)]">LFN 主报价适用于原生超分和工作台。NewAPI 预估适用于支持余额回退的入口。</p>}
            {operation === "encode-vibe" && <p className="mt-4 text-xs leading-5 text-[var(--muted)]">每次编码一张图。NewAPI 预估适用于可使用 NewAPI 回退的外部请求，工作台参考图预处理使用 LFN AFF。</p>}
            {!standalone && (generation.vibeReferenceImageCount ?? 0) > 0 && <p className="mt-4 text-xs leading-5 text-[var(--muted)]">直接 API 请求中的未编码 Vibe 计入本次生成费用。工作台单独预处理时另结算编码费，请按提交时的已编码张数估算生成费用。</p>}
          </>}
        </div>
      </div>
    </section>
  );
}
