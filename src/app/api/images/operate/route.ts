import { dailyImagePolicy } from "@/lib/daily-image-billing";
import { RiskAdmissionError, moderationFromUpstream, queuedRiskHeaders, riskAdmissionResponse } from "@/lib/light-risk";
import { MAX_IMAGE_REQUEST_SAMPLES, splitImageBatches } from "@/lib/image-batches";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import JSZip from "jszip";
import {
  refundImageCredits,
  trySpendImageCredits,
  type ImageCreditCharge,
} from "@/lib/aff";
import { UPSCALE_MODELS, upscaleAnlasCost, upscaleBillingModel } from "@/lib/image-pricing";
import { pngDimensions } from "@/lib/png-dims";
import { getSession, type LfnSession } from "@/lib/session";
import {
  getImageToken,
  imageFromResult,
  resolvedImageUpstream,
  resolvedNaiImageUpstream,
  resolvedNewApiBaseUrl,
} from "@/lib/newapi";
import { resolvedAuthProviderId } from "@/lib/platform";
import { saveHistory } from "@/lib/history";
import { naiNativeGenerationBody } from "@/lib/nai-native-request";
import { pngDataUrl, readNaiMsgpackStream } from "@/lib/nai-stream";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import { gatewayLogStart } from "@/lib/gateway-log";
import { fetchWithModelConcurrency, ModelConcurrencyQueueAbortError } from "@/lib/model-concurrency";
import { sseEvent, sseResponse } from "@/lib/sse";
import { handlePersonalProviderGeneration } from "@/lib/provider/generate";
import { handleNewApiImageModelGeneration } from "@/lib/provider/newapi-generate";
import { handleNaturalImagePromptSuggestion } from "@/lib/provider/prompt-suggestion";
import { resolveImageModelCapabilities, isImageProviderProtocol } from "@/lib/image-model-capabilities";
import { userCanGenerateWithNewApiModel } from "@/lib/provider/newapi-models";
import { isNaiModelEnabled } from "@/lib/runtime-config";
import { evaluateImageRisk, riskBlockedResponse, riskRateLimitedResponse } from "@/lib/risk-control";
import { createImageSettlement, updateImageSettlement } from "@/lib/risk-settlement";
import { externalGeneration, imageRequestErrorBody } from "@/lib/compat-api";
import { startRequestAudit } from "@/lib/request-audit";
import { validateModelId } from "@/lib/provider/validation";
import {
  assertBodySize,
  assertImageModel,
  checkImageRateLimit,
  normalizeDimension,
  normalizeSamples,
  normalizeSteps,
  validateImageShape,
  validateReferenceCount,
  validateMediumRequest,
} from "@/lib/image-request";

const unifiedOperations = new Set([
  "generate",
  "img2img",
  "inpainting",
  "edits",
  "outpainting",
  "vibe-transfer",
  "character-reference",
  "precise-reference",
  "director-declutter",
  "director-bg-remover",
  "director-lineart",
  "director-sketch",
  "director-colorize",
  "director-emotion",
]);
// 缓冲路径每次上游请求的张数上限（网关 OpenAI 兼容路径同为 8）。
const MAX_SAMPLES_PER_REQUEST = MAX_IMAGE_REQUEST_SAMPLES;
// 流式路径单请求张数上限；更多张数由客户端分批并发。
const MAX_STREAM_SAMPLES = MAX_IMAGE_REQUEST_SAMPLES;
const DATA_URL = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

// NAI V5 扩散超分（/ai/upscale）：输出固定 2x，按输入面积扣 1-4 AFF。
// 计费口径与上游实扣 Anlas 1:1，详见 docs/SUPER_RESOLUTION.md。
async function handleUpscale(
  request: Request,
  session: LfnSession,
  body: Record<string, unknown> & { operation?: string; model?: string },
): Promise<Response> {
  const audit = await startRequestAudit({ request, source: "lfn", endpoint: "/api/images/operate", userId: session.userId, username: session.username,
    model: typeof body.upscale_model === "string" ? body.upscale_model : "nai-diffusion-5-curated", operation: "upscale", parameters: body });
  const finish = async (response: Response, patch: Record<string, unknown> = {}): Promise<Response> => {
    await audit.finish({ status: response.status, ...patch });
    return new Response(response.body, { status: response.status, headers: audit.responseHeaders(response.headers) });
  };
  const nativeImage = await resolvedNaiImageUpstream();

  const rawImage = typeof body.image === "string" ? body.image : "";
  if (!rawImage)
    return finish(NextResponse.json({ message: "请先上传要超分的图片" }, { status: 400 }));
  const image = rawImage.replace(DATA_URL, "");
  const dims = pngDimensions(image);
  if (!dims)
    return finish(NextResponse.json(
      { message: "超分仅接受 PNG 图片（JPEG/WEBP 请先转为 PNG）" },
      { status: 400 },
    ));

  const upscaleModel =
    typeof body.upscale_model === "string" && body.upscale_model
      ? body.upscale_model
      : "nai-diffusion-5-curated";
  if (!UPSCALE_MODELS.has(upscaleModel))
    return finish(NextResponse.json(
      { message: `超分模型仅支持 nai-diffusion-5-full / nai-diffusion-5-curated` },
      { status: 400 },
    ));

  try {
    upscaleAnlasCost(dims.width, dims.height);
  } catch (error) {
    return finish(NextResponse.json(
      { message: error instanceof Error ? error.message : "超分参数无效" },
      { status: 400 },
    ));
  }

  const risk = await evaluateImageRisk({ userId: session.userId, username: session.username, model: upscaleModel, requestId: audit.requestId }).catch(() => null);
  if (!risk) return finish(NextResponse.json({ message: "风控服务暂时不可用，请稍后重试" }, { status: 503 }), { error: "风控服务暂时不可用" });
  if (risk.decision === "deny") return finish(riskBlockedResponse(risk), { risk });
  if (risk.decision === "rate-limit") return finish(await riskRateLimitedResponse(risk), { risk });

  const generation = {
    model: upscaleModel,
    width: dims.width,
    height: dims.height,
    steps: 1,
    samples: 1,
    operation: "upscale",
  };
  let credits: ImageCreditCharge | null;
  try { credits = nativeImage ? await trySpendImageCredits(session.userId, generation, audit.requestId) : null; }
  catch (error) { const admission = riskAdmissionResponse(error); if (admission) return finish(admission); throw error; }
  if (!credits && (await dailyImagePolicy()).strictApiBilling !== false) return finish(Response.json({ message: nativeImage ? "本站 AFF 或图包余额不足" : "未配置本地计费执行通道" }, { status: nativeImage ? 402 : 503 }));
  if (!credits && (await resolvedAuthProviderId()) === "local")
    return finish(NextResponse.json({ message: nativeImage ? "图包和个人 AFF 不足，当前账号未启用站内余额支付" : "未配置超分图像上游" }, { status: nativeImage ? 402 : 503 }), { generatedSamples: 0 });
  const payment = credits ? "aff" : "newapi";
  const paymentSource = credits
    ? credits.packageCost > 0 && credits.personalCost > 0
      ? "mixed"
      : credits.packageCost > 0
        ? "package"
        : "personal"
    : "newapi";
  let refunded = false;
  const refund = async () => {
    if (credits && !refunded) {
      refunded = true;
      await refundImageCredits(session.userId, credits, 0, { requestId: audit.requestId });
    }
  };

  try {
    const billingModel = upscaleBillingModel(upscaleModel);
    const baseUrl = credits && nativeImage ? nativeImage.baseUrl : await resolvedNewApiBaseUrl();
    const token = credits && nativeImage ? nativeImage.token : await getImageToken(session, billingModel);
    const endpoint = credits ? "/ai/upscale" : "/v1/images/generations";
    const payload = credits
      ? { image, model: upscaleModel, declared_blur_sigma: 0 }
      : { image, model: billingModel, novelai_operation: "upscale", response_format: "b64_json", n: 1 };
    const finishGatewayLog = gatewayLogStart({
      source: "lfn",
      user: session.username,
      endpoint,
      op: "upscale",
      model: upscaleModel,
      samples: 1,
    });
    const upstream = await fetchWithModelConcurrency(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: queuedRiskHeaders(audit.requestId, {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    }).catch((error: unknown) => {
      finishGatewayLog(0);
      throw error;
    });
    finishGatewayLog(upstream.status);
    const anlasHeader = upstream.headers.get("x-anlas-cost");
    const anlas = anlasHeader?.trim() ? Number(anlasHeader) : NaN;
    const billing = Number.isFinite(anlas) && anlas >= 0 ? { gatewayAnlasCost: anlas } : undefined;
    if (!upstream.ok) {
      await refund();
      const raw = (await upstream.text()).slice(0, 300);
      return finish(NextResponse.json(
        { message: raw || `上游超分失败（${upstream.status}）` },
        { status: upstream.status || 502 },
      ), { risk, paymentSource, generatedSamples: 0, ...(billing ? { billing } : {}) });
    }
    let images: string[];
    if (credits) {
      const png = await extractUpscaledPng(await upstream.arrayBuffer());
      images = png ? [pngDataUrl(png)] : [];
    } else {
      const result = await upstream.json();
    audit.record.moderation = await moderationFromUpstream(result);
      if (result.error || result.detail) throw new Error(result.error?.message || result.detail || "上游超分失败");
      images = imageFromResult(result).slice(0, 1);
    }
    if (!images.length || !pngDimensions(images[0])) {
      await refund();
      return finish(NextResponse.json({ message: "上游超分响应中没有有效 PNG 图片" }, { status: 502 }), { risk, paymentSource, generatedSamples: 0, ...(billing ? { billing } : {}) });
    }
    let history: Awaited<ReturnType<typeof saveHistory>> = [];
    let warning = "";
    try { history = await saveHistory(session.userId, body, images, null); }
    catch { warning = "图片已放大，但暂时无法保存历史记录"; }
    return finish(NextResponse.json({
      images,
      image: images[0],
      width: dims.width * 2,
      height: dims.height * 2,
      historyIds: history.map((item) => item.id),
      payment,
      paymentSource,
      ...(warning ? { warning } : {}),
      aff: credits ? {
        cost: credits.cost,
        balance: credits.balance,
        packageCost: credits.packageCost,
        personalCost: credits.personalCost,
        packageBalance: credits.packageBalance,
        totalBalance: credits.totalBalance,
      } : null,
    }, { headers: { "X-LFN-Payment-Source": paymentSource } }), { status: 200, risk, paymentSource, generatedSamples: 1, historyIds: history.map((item) => item.id), ...(billing ? { billing } : {}) });
  } catch (error) {
    await refund();
    return finish(NextResponse.json(
      { message: error instanceof Error ? error.message : "上游超分失败" },
      { status: 502 },
    ), { risk, paymentSource, generatedSamples: 0, error: error instanceof Error ? error.message : "上游超分失败" });
  }
}

// NAI /ai/upscale 返回 ZIP（image_0.png），解出第一张 PNG 原始字节。
async function extractUpscaledPng(payload: ArrayBuffer): Promise<Uint8Array | null> {
  const archive = await JSZip.loadAsync(payload);
  const entry = Object.values(archive.files).find(
    (file) => !file.dir && file.name.endsWith(".png"),
  );
  if (!entry) return null;
  return new Uint8Array(await entry.async("arraybuffer"));
}

function stripDataUrls<T>(value: T): T {
  if (typeof value === "string")
    return (DATA_URL.test(value) ? value.replace(DATA_URL, "") : value) as T;
  if (Array.isArray(value)) return value.map(stripDataUrls) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        stripDataUrls(item),
      ]),
    ) as T;
  return value;
}

function imageCount(value: unknown): number {
  if (typeof value === "string") return value.trim() ? 1 : 0;
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => typeof item === "string" && item.trim()).length;
}

function referenceImageCount(
  body: Record<string, unknown>,
  operation: string,
): number {
  if (operation === "precise-reference")
    return Array.isArray(body.references) ? body.references.length : 0;
  if (operation === "character-reference")
    return Array.isArray(body.characters) ? body.characters.length : 0;
  return imageCount(body.reference_images) || imageCount(body.reference_image);
}

function parseSamplesLimit(raw: string): number | null {
  const match = raw.match(/maximum number of images[^]*?is (\d+)/i);
  return match ? Number(match[1]) : null;
}

function explainUpstreamFailure(
  raw: string,
  status: number,
  body: Record<string, unknown>,
): string {
  if (status !== 500) return raw;
  const suspects: string[] = [];
  if (body.sampler === "ddim_v3") suspects.push("采样器 ddim_v3");
  if (typeof body.cfg_rescale === "number" && body.cfg_rescale !== 0)
    suspects.push("CFG 重缩放");
  if (!suspects.length)
    return `NovelAI 上游拒绝了本次请求（500）。请调整采样器、噪声调度或高级参数后重试。`;
  return `NovelAI 上游不支持当前${suspects.join("、")}，已返回 500。请更换后重试。`;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用 NAI 工具" },
      { status: 401 },
    );

  let body: Record<string, unknown> & { operation?: string; model?: string };
  try {
    assertBodySize(request);
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }

  const operation =
    typeof body.operation === "string" ? body.operation : "generate";
  try {
    validateMediumRequest(String(body.model), body, operation);
  } catch (error) {
    return NextResponse.json(imageRequestErrorBody(error, "Medium 参数无效"), { status: 400 });
  }
  const deferPatchHistory = body.editor_composite === true;
  delete body.editor_composite;
  const providerId = typeof body.providerId === "string" ? body.providerId : "";
  if (operation === "suggest-tags" && resolveImageModelCapabilities(typeof body.model === "string" ? body.model : "", isImageProviderProtocol(body.imageProtocol) ? body.imageProtocol : "auto").promptStyle === "natural") return handleNaturalImagePromptSuggestion(request, session, body);
  if (providerId && providerId !== "newapi")
    return handlePersonalProviderGeneration(request, session, { ...body, editor_composite: deferPatchHistory }, providerId);
  try { assertImageModel(body.model); }
  catch { return handleNewApiImageModelGeneration(request, session, { ...body, editor_composite: deferPatchHistory }); }
  let model: string;
  let nativeNaiModel = true;
  try {
    model = assertImageModel(body.model);
    if (!(await isNaiModelEnabled(model))) return NextResponse.json({ message: "该 NAI 模型已被管理员停用" }, { status: 403 });
  } catch {
    nativeNaiModel = false;
    try {
      model = validateModelId(body.model);
      if (operation !== "generate" || !(await userCanGenerateWithNewApiModel(session, model)))
        return NextResponse.json({ message: "当前模型不允许用于图像生成" }, { status: 400 });
    } catch (modelError) {
      return NextResponse.json({ message: modelError instanceof Error ? modelError.message : "无法验证模型权限" }, { status: 502 });
    }
  }
  if (operation === "annotate")
    return NextResponse.json(
      {
        message: "控制图生成端点已识别，但 Gateway 尚无可审计 usage 映射；为避免零费用漏计，暂不允许提交。",
      },
      { status: 409 },
    );
  if (operation === "upscale") return handleUpscale(request, session, body);
  if (operation !== "suggest-tags" && !unifiedOperations.has(operation))
    return NextResponse.json({ message: "不支持的 NAI 操作" }, { status: 400 });
  const implicitInpaintModel = /^nai-v(?:4\.5|5)-(?:full|curated)(?:-limit|-medium)?$/.test(model);
  if (
    (operation === "inpainting" || operation === "edits" || operation === "outpainting") &&
    !model.includes("inpaint") &&
    !implicitInpaintModel
  )
    return NextResponse.json(
      { message: `局部重绘需要重绘模型，${model} 不支持该操作` },
      { status: 400 },
    );
  if (operation === "inpainting" || operation === "edits" || operation === "outpainting") {
    const sourceImage = typeof body.image === "string" ? body.image : "";
    const sourceMask = typeof body.mask === "string" ? body.mask : "";
    if (!DATA_URL.test(sourceImage) || !DATA_URL.test(sourceMask))
      return NextResponse.json(
        { message: "局部重绘需要有效的源图片和 PNG 蒙版" },
        { status: 400 },
      );
    const imageDimensions = pngDimensions(sourceImage);
    const maskDimensions = pngDimensions(sourceMask);
    if (imageDimensions && maskDimensions && (
      imageDimensions.width !== maskDimensions.width ||
      imageDimensions.height !== maskDimensions.height
    ))
      return NextResponse.json(
        { message: "源图片和蒙版尺寸必须一致" },
        { status: 400 },
      );
  }

  const rate = checkImageRateLimit(request, `session:${session.userId}`);
  if (!rate.allowed)
    return NextResponse.json(
      { message: "图像请求过于频繁，请稍后重试" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );

  const audit = await startRequestAudit({ request, source: "lfn", endpoint: "/api/images/operate", userId: session.userId, username: session.username, model, operation, parameters: body });
  body._lfnRequestId = audit.requestId;
  await audit.finish();
  let recordedAnlas: number | undefined;
  const recordUpstream = async (response: Response): Promise<void> => {
    const header = response.headers.get("x-anlas-cost");
    const amount = header?.trim() ? Number(header) : NaN;
    if (response.ok && Number.isFinite(amount) && amount >= 0) recordedAnlas = (recordedAnlas ?? 0) + amount;
    if (recordedAnlas != null) audit.record.billing = { ...audit.record.billing, gatewayAnlasCost: recordedAnlas };
  };
  const risk = await evaluateImageRisk({
    userId: session.userId,
    username: session.username,
    model,
    prompt: typeof body.prompt === "string" ? body.prompt : undefined,
    requestId: typeof body._lfnRequestId === "string" ? body._lfnRequestId : undefined,
  }).catch(() => null);
  if (!risk) {
    await audit.finish({ status: 503, error: "风控服务暂时不可用" });
    return NextResponse.json({ message: "风控服务暂时不可用，请稍后重试" }, { status: 503 });
  }
  if (risk.decision === "deny") {
    await audit.finish({ status: 403, risk });
    return riskBlockedResponse(risk);
  }
  if (risk.decision === "rate-limit") {
    await audit.finish({ status: 429, risk });
    return await riskRateLimitedResponse(risk);
  }

  let creditCharge: ImageCreditCharge | null = null;
  let affRefunded = false;
  let generatedSamples = 0;
  let payment: "aff" | "newapi" = "newapi";
  let paymentSource: "package" | "personal" | "mixed" | "newapi" = "newapi";
  const finishGenerationAudit = async (status: number, historyIds: string[] = []) => {
    let chargedAff: number | undefined;
    if (creditCharge) {
      chargedAff = generatedSamples > 0
        ? [...creditCharge.packageChargesBySample.slice(0, generatedSamples), ...creditCharge.personalChargesBySample.slice(0, generatedSamples)].reduce((sum, value) => sum + value, 0)
        : affRefunded ? 0 : creditCharge.cost;
    }
    await audit.finish({
      status, paymentSource, generatedSamples, historyIds,
      billing: { ...audit.record.billing, ...(chargedAff != null ? { lfnChargedAff: Math.round(chargedAff * 10000) / 10000 } : {}) },
    });
  };
  let baseUrlOverride = "";
  let settlementId: string | undefined;
  let upstreamAttempted = false;

  try {
    let token: string;
    let totalSamples = 1;
    let width = 0;
    let height = 0;
    let steps = 28;

    if (operation !== "suggest-tags") {
      try {
        width = normalizeDimension(body.width, "width");
        height = normalizeDimension(body.height, "height");
        validateImageShape(width, height);
        totalSamples = normalizeSamples(body);
        steps = normalizeSteps(body.steps, String(model).endsWith("-medium") ? 14 : 28);
        validateReferenceCount(referenceImageCount(body, operation));
        validateMediumRequest(model, body, operation);
      } catch (error) {
        const detail = imageRequestErrorBody(error, "图像参数无效");
        return NextResponse.json(
          detail,
          { status: 400 },
        );
      }

      const generation = externalGeneration({ ...body, model, width, height, steps, n: totalSamples, n_samples: totalSamples }, operation);
      if (!generation) return NextResponse.json({ message: "图像计费参数无效" }, { status: 400 });
      const platformUpstream = nativeNaiModel ? await resolvedImageUpstream() : null;
      const credits = platformUpstream
        ? await trySpendImageCredits(session.userId, generation, audit.requestId)
        : null;
      if (nativeNaiModel && !credits && (await dailyImagePolicy()).strictApiBilling !== false) throw new RiskAdmissionError(platformUpstream ? "本站 AFF 或图包余额不足" : "未配置本地计费执行通道", platformUpstream ? "lfn_insufficient_credits" : "lfn_billing_unavailable", platformUpstream ? 402 : 503);
      if (credits && platformUpstream) {
        token = platformUpstream.token;
        baseUrlOverride = platformUpstream.baseUrl;
        payment = "aff";
        creditCharge = credits;
        paymentSource =
          credits.packageCost > 0 && credits.personalCost > 0
            ? "mixed"
            : credits.packageCost > 0
              ? "package"
              : "personal";
            settlementId = `settlement:${audit.requestId}`;
            await createImageSettlement({ settlementId, requestId: audit.requestId, userId: session.userId, charge: credits });
            audit.record.paymentSource = paymentSource;
      } else if ((await resolvedAuthProviderId()) === "local") {
        if (!nativeNaiModel)
          return NextResponse.json({ message: "本地账号不能使用 NewAPI 模型" }, { status: 400 });
        if (!platformUpstream)
          return NextResponse.json({ message: "未配置图像上游，无法生成" }, { status: 503 });
        token = platformUpstream.token;
        baseUrlOverride = platformUpstream.baseUrl;
      } else {
        token = await getImageToken(session, model);
      }
    } else if ((await resolvedAuthProviderId()) === "local") {
      const fallback = await resolvedImageUpstream();
      if (!fallback)
        return NextResponse.json({ message: "未配置图像上游，无法生成" }, { status: 503 });
      token = fallback.token;
      baseUrlOverride = fallback.baseUrl;
    } else {
      token = await getImageToken(session, model);
    }

    const nativeImage = nativeNaiModel ? await resolvedNaiImageUpstream() : null;
    const canStreamNative =
      Boolean(nativeImage) &&
      unifiedOperations.has(operation) &&
      !operation.startsWith("director-");
    if (canStreamNative && nativeImage && Boolean(creditCharge || baseUrlOverride)) {
      if (totalSamples > MAX_STREAM_SAMPLES) {
        if (creditCharge) {
          affRefunded = true;
          await refundImageCredits(session.userId, creditCharge, 0);
        }
        return NextResponse.json(
          {
            message: `流式单请求最多 ${MAX_STREAM_SAMPLES} 张，更多张数请改用分批次并发`,
          },
          { status: 400 },
        );
      }
      const encoder = new TextEncoder();
      const samples = totalSamples;
      const nativeBody = naiNativeGenerationBody(
        { ...body, n: samples, n_samples: samples },
        { stream: true, samples },
      );
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 300_000);
      const finishGatewayLog = gatewayLogStart({
        source: "lfn",
        user: session.username,
        endpoint: "/ai/generate-image-stream",
        op: operation,
        model,
        samples,
      });
      const nativeResponse = await fetchWithModelConcurrency(
        `${nativeImage.baseUrl}/ai/generate-image-stream`,
        {
          method: "POST",
          headers: queuedRiskHeaders(audit.requestId, {
            Authorization: `Bearer ${nativeImage.token}`,
            "Content-Type": "application/json",
            Accept: "application/x-msgpack",
          }),
          body: JSON.stringify(nativeBody),
          cache: "no-store",
          signal: abort.signal,
        },
      ).catch((error: unknown) => {
        finishGatewayLog(0);
        throw error;
      });
      finishGatewayLog(nativeResponse.status);
      await recordUpstream(nativeResponse);
      // 流式初始化失败不再直接报错：保留扣费，回退到下方缓冲端点生成。
      const streamReady = nativeResponse.ok && Boolean(nativeResponse.body);
      if (!streamReady) {
        clearTimeout(timeout);
        await nativeResponse.body?.cancel();
        console.warn(
          `[lfn] 流式初始化失败（${nativeResponse.status}），回退缓冲端点生成`,
        );
      }

      if (streamReady) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) =>
            controller.enqueue(encoder.encode(sseEvent(event, data)));
          const finals = new Map<number, string>();
          const latestImages = new Map<number, string>();
          let errorMessage = "";
          try {
            send("meta", {
              payment,
              paymentSource,
              samples,
              steps,
              width,
              height,
            });
            for await (const event of readNaiMsgpackStream(nativeResponse.body)) {
              if (event.eventType === "error") {
                // 先不发 error 事件：留出缓冲兜底机会，兜底失败才统一上报
                // （客户端见到 error 即判失败，后续 final/done 会被丢弃）。
                errorMessage = event.message || "流式生成失败";
                break;
              }
              if (!event.image?.length) continue;
              const image = pngDataUrl(event.image);
              latestImages.set(event.sampleIndex, image);
              if (event.eventType === "final") {
                finals.set(event.sampleIndex, image);
                generatedSamples = finals.size;
                send("final", {
                  sampleIndex: event.sampleIndex,
                  image,
                  currentStep: steps,
                  totalSteps: steps,
                });
                if (finals.size >= samples) break;
              } else {
                send("preview", {
                  sampleIndex: event.sampleIndex,
                  image,
                  currentStep: Math.min((event.stepIndex ?? 0) + 1, steps),
                  totalSteps: steps,
                });
              }
            }
            // NAI 已返回请求数量对应的最终图片时，不再等待上游迟迟不关闭连接。
            await nativeResponse.body?.cancel().catch(() => undefined);
            if (!errorMessage && finals.size === 0 && latestImages.size > 0) {
              console.warn("[lfn] 流式响应缺少 final 事件，提升最后一帧图片");
              latestImages.forEach((image, sampleIndex) => finals.set(sampleIndex, image));
            } else if (!errorMessage && finals.size > 0) {
              latestImages.forEach((image, sampleIndex) => {
                if (!finals.has(sampleIndex)) finals.set(sampleIndex, image);
              });
            }
            if (!errorMessage && finals.size) {
              const images = Array.from(
                { length: Math.max(samples, ...finals.keys()) + 1 },
                (_, index) => finals.get(index),
              ).filter((item): item is string => Boolean(item));
              generatedSamples = images.length;
              if (creditCharge && generatedSamples < samples) {
                affRefunded = true;
                await refundImageCredits(session.userId, creditCharge, generatedSamples, { settlementId });
              } else if (creditCharge && settlementId) {
                await updateImageSettlement(settlementId, { generatedSamples, status: "succeeded" });
              }
              send("done", {
                images,
                image: images[0],
                historyIds: [],
                  requestId: typeof body._lfnRequestId === "string" ? body._lfnRequestId : null,
                payment,
                paymentSource,
                    aff: creditCharge
                  ? {
                      cost: creditCharge.cost,
                      balance: creditCharge.balance,
                      packageCost: creditCharge.packageCost,
                      personalCost: creditCharge.personalCost,
                      packageBalance: creditCharge.packageBalance,
                      totalBalance: creditCharge.totalBalance,
                    }
                  : null,
              });
              if (!deferPatchHistory) {
                void saveHistory(session.userId, body, images, null, {
                  requestId: typeof body._lfnRequestId === "string" ? body._lfnRequestId : undefined,
                }).catch((error) =>
                  console.error("[lfn] 生成完成后保存历史失败", error),
                );
              }
            } else if (!errorMessage) {
              errorMessage = "上游未返回最终图片";
            }
            if (errorMessage && finals.size === 0) {
              // 流式上游失败（如 NAI 流式管线内部错误）：同笔扣费回退到
              // 缓冲端点再试一次，成功照常下发 final/done，失败才退款报错。
              const fallbackBase = baseUrlOverride;
              if (fallbackBase && token) {
                upstreamAttempted = true;
                const payload = stripDataUrls({ ...body });
                delete payload.operation;
                delete payload.n;
                delete payload.n_samples;
                payload.n = samples;
                payload.n_samples = samples;
                payload.width = width;
                payload.height = height;
                payload.steps = steps;
                payload.response_format = "b64_json";
                if (operation !== "generate")
                  payload.novelai_operation = operation === "outpainting" ? "inpainting" : operation;
                const finishFallbackLog = gatewayLogStart({
                  source: "lfn",
                  user: session.username,
                  endpoint: "/v1/images/generations",
                  op: operation,
                  model,
                  samples,
                });
                try {
                  const resp = await fetchWithModelConcurrency(
                    `${fallbackBase}/v1/images/generations`,
                    {
                      method: "POST",
                      headers: queuedRiskHeaders(audit.requestId, {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                      }),
                      body: JSON.stringify(payload),
                      cache: "no-store",
                      signal: AbortSignal.timeout(180_000),
                    },
                  ).catch((error: unknown) => {
                    finishFallbackLog(0);
                    throw error;
                  });
                  finishFallbackLog(resp.status);
                  await recordUpstream(resp);
                  if (!resp.ok) {
                    await resp.body?.cancel().catch(() => undefined);
                    throw new Error(`fallback ${resp.status}`);
                  }
                  const result = (await resp.json()) as {
                    data?: Array<{ b64_json?: string; url?: string }>;
                    usage?: unknown;
                  };
                  const images = imageFromResult(result);
                  if (!images.length) throw new Error("fallback no images");
                  generatedSamples = images.length;
                  if (creditCharge && generatedSamples < samples) {
                    affRefunded = true;
                    await refundImageCredits(session.userId, creditCharge, generatedSamples, { settlementId });
                  } else if (creditCharge && settlementId)
                    await updateImageSettlement(settlementId, { generatedSamples, status: "succeeded" });
                  images.forEach((image, index) =>
                    send("final", {
                      sampleIndex: index,
                      image,
                      currentStep: steps,
                      totalSteps: steps,
                    }),
                  );
                  send("done", {
                    images,
                    image: images[0],
                    historyIds: [],
                    requestId: typeof body._lfnRequestId === "string" ? body._lfnRequestId : null,
                    payment,
                    paymentSource,
                    aff: creditCharge
                      ? {
                          cost: creditCharge.cost,
                          balance: creditCharge.balance,
                          packageCost: creditCharge.packageCost,
                          personalCost: creditCharge.personalCost,
                          packageBalance: creditCharge.packageBalance,
                          totalBalance: creditCharge.totalBalance,
                        }
                      : null,
                  });
                  if (!deferPatchHistory) {
                    void saveHistory(session.userId, body, images, result.usage ?? null, {
                      requestId: typeof body._lfnRequestId === "string" ? body._lfnRequestId : undefined,
                    }).catch((error) =>
                      console.error("[lfn] 缓冲回退后保存历史失败", error),
                    );
                  }
                  errorMessage = "";
                } catch {
                  // 兜底也失败：保留 errorMessage，finally 统一退款。
                }
              }
            }
          } catch (error) {
            errorMessage =
              error instanceof Error ? error.message : "流式生成中断";
            send("error", { message: errorMessage });
          } finally {
            clearTimeout(timeout);
            if (errorMessage && creditCharge && !affRefunded) {
              affRefunded = true;
              await refundImageCredits(session.userId, creditCharge, generatedSamples);
            }
            await finishGenerationAudit(errorMessage ? generatedSamples ? 207 : 502 : 200);
            controller.close();
          }
        },
      });
      return sseResponse(stream, {
        "X-LFN-Payment-Source": paymentSource,
      });
      }
    }

    const baseUrl = baseUrlOverride || (await resolvedNewApiBaseUrl());
    const endpoint =
      operation === "suggest-tags"
        ? "/v1/images/suggest-tags"
        : "/v1/images/generations";
    const payload = nativeNaiModel
      ? stripDataUrls({ ...body })
      : {
          model,
          prompt: typeof body.prompt === "string" ? body.prompt : "",
          n: totalSamples,
          size: `${width}x${height}`,
          response_format: "b64_json",
        } as Record<string, unknown>;
    delete payload.operation;
    delete payload.providerId;
    delete payload.n;
    delete payload.n_samples;
    if (payload.seed === 0) delete payload.seed;
    if (operation !== "suggest-tags") {
      payload.n = totalSamples;
      if (nativeNaiModel) {
        payload.n_samples = totalSamples;
        payload.width = width;
        payload.height = height;
        payload.steps = steps;
        if (operation !== "generate")
          payload.novelai_operation = operation === "outpainting" ? "inpainting" : operation;
        else delete payload.novelai_operation;
      }
    }

    let perRequest = Math.min(MAX_SAMPLES_PER_REQUEST, totalSamples);
    const remaining = splitImageBatches(totalSamples, perRequest);
    const images: string[] = [];
    let usage: unknown = null;
    let vibe: unknown = null;
    let lastStatus = 0;
    let lastRaw = "";
    let lastResult: Record<string, unknown> = {};

    while (remaining.length) {
      const batch = remaining.shift() as number;
      upstreamAttempted = true;
      const finishGatewayLog = gatewayLogStart({
        source: "lfn",
        user: session.username,
        endpoint,
        op: operation,
        model,
        samples: batch,
      });
      const upstream = await fetchWithModelConcurrency(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: queuedRiskHeaders(audit.requestId, {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        }),
        // 分批续传时种子按已完成张数偏移，模拟 NAI 单请求多张的种子序列，
        // 避免同种子各批生成重复图。
        body: JSON.stringify(nativeNaiModel ? {
          ...payload,
          n: batch,
          n_samples: batch,
          seed:
            typeof payload.seed === "number"
              ? (payload.seed + images.length) % 2 ** 32
              : payload.seed,
        } : { ...payload, n: batch }),
        cache: "no-store",
        signal: AbortSignal.timeout(180_000),
      }).catch((error: unknown) => {
        finishGatewayLog(0);
        throw error;
      });
      finishGatewayLog(upstream.status);
      await recordUpstream(upstream);
      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        await upstream.body?.cancel().catch(() => undefined);
        lastStatus = 502;
        lastRaw = "上游返回了未支持的二进制响应";
        break;
      }
      const text = await upstream.text();
      let result: {
        error?: { message?: string };
        detail?: string;
        message?: string;
        usage?: unknown;
        data?: Array<{ b64_json?: string; url?: string; vibe?: unknown }>;
      } = {};
      if (text.trim()) {
        try {
          result = JSON.parse(text);
        } catch {
          lastStatus = upstream.ok ? 502 : upstream.status;
          lastRaw = explainUpstreamFailure(text.slice(0, 200), upstream.status, body);
          break;
        }
      }
      if (!upstream.ok || result.error || result.detail) {
        const raw =
          result.error?.message ||
          result.detail ||
          result.message ||
          (text.trim() ? text.slice(0, 200) : `上游返回空响应（${upstream.status}）`);
        const limit = parseSamplesLimit(raw);
        if (limit && limit >= 1 && limit < batch) {
          remaining.unshift(...splitImageBatches(batch, limit));
          perRequest = Math.min(perRequest, limit);
          continue;
        }
        lastStatus = upstream.status || 502;
        lastRaw = explainUpstreamFailure(raw, upstream.status, body);
        break;
      }
      const batchImages = imageFromResult(result);
      if (!batchImages.length) {
        lastStatus = 502;
        lastRaw = "上游未返回图片";
        break;
      }
      images.push(...batchImages);
      generatedSamples += batchImages.length;
      lastResult = result;
      if (result.usage) usage = result.usage;
      if (result.data?.[0]?.vibe) vibe = result.data[0].vibe;
    }

    if (lastRaw) {
      if (creditCharge) {
        affRefunded = true;
        await refundImageCredits(session.userId, creditCharge, generatedSamples, { settlementId });
      }
      await finishGenerationAudit(generatedSamples ? 207 : lastStatus || 502);
      return NextResponse.json(
        {
          message: generatedSamples
            ? `已生成 ${generatedSamples}/${totalSamples} 张后中断：${lastRaw}`
            : lastRaw,
          ...(generatedSamples ? { images, image: images[0], partial: true } : {}),
        },
        { status: generatedSamples ? 207 : lastStatus || 502 },
      );
    }
    if (operation === "suggest-tags") {
      await finishGenerationAudit(200);
      return NextResponse.json({ tags: lastResult.tags || lastResult, raw: lastResult });
    }

    if (creditCharge && settlementId) {
      if (generatedSamples < creditCharge.samples) {
        affRefunded = true;
        await refundImageCredits(session.userId, creditCharge, generatedSamples, { settlementId });
      } else {
        await updateImageSettlement(settlementId, { generatedSamples, status: "succeeded" });
      }
    }

    const history = deferPatchHistory
      ? []
      : await saveHistory(session.userId, body, images, usage);
    await finishGenerationAudit(200, history.map(item=>item.id));
    return NextResponse.json({
      images,
      image: images[0],
      usage,
      vibe,
      historyIds: history.map((item) => item.id),
      payment,
      paymentSource,
      aff: creditCharge
        ? {
            cost: creditCharge.cost,
            balance: creditCharge.balance,
            packageCost: creditCharge.packageCost,
            personalCost: creditCharge.personalCost,
            packageBalance: creditCharge.packageBalance,
            totalBalance: creditCharge.totalBalance,
          }
        : null,
    }, { headers: audit.responseHeaders() });
  } catch (error) {
    const admission = riskAdmissionResponse(error);
    if (admission) { await audit.finish({ status: admission.status }); return new Response(admission.body, { status: admission.status, headers: audit.responseHeaders(admission.headers) }); }
    const queueAborted = error instanceof ModelConcurrencyQueueAbortError;
    if (!affRefunded && creditCharge && (!upstreamAttempted || queueAborted)) {
      affRefunded = true;
      await refundImageCredits(session.userId, creditCharge, generatedSamples);
    }
    await finishGenerationAudit(queueAborted ? 503 : 502);
    return NextResponse.json(
      { message: queueAborted ? "图像请求排队超时，尚未发送到上游。请稍后重试。" : error instanceof Error ? error.message : "NAI 操作失败" },
      { status: queueAborted ? 503 : 502 },
    );
  }
}
