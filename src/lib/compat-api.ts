import { moderationFromUpstream, queuedRiskHeaders, riskAdmissionResponse } from "@/lib/light-risk";
/**
 * 适配器系统兼容层
 * 将现有 compat-api 逻辑迁移到适配器系统，保持 API 向后兼容
 */

import JSZip from "jszip";
import { encode } from "@msgpack/msgpack";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { watermarkImageResponse } from "@/lib/image-response-watermark";
import { compatibleNaiZipResponse } from "@/lib/nai-zip-response";
import {
  affStatus,
  refundImageCredits,
  trySpendImageCredits,
  type AffGeneration,
  type ImageCreditCharge,
} from "@/lib/aff";
import {
  ensureManagedFallbackToken,
  resolveExternalApiIdentity,
} from "@/lib/newapi-db";
import {
  gatewayLogStart,
  maskKeyForLog,
  type GatewayLogMeta,
} from "@/lib/gateway-log";
import { startRequestAudit } from "@/lib/request-audit";
import { watermarkImages } from "@/lib/image-watermark";
import {
  resolvedImageUpstream,
  resolvedNaiAccountUpstream,
  resolvedNaiImageUpstream,
  resolvedNewApiBaseUrl,
} from "@/lib/newapi";
import {
  assertBodySize,
  assertImageModel,
  checkImageRateLimit,
  ImageRequestValidationError,
  normalizeDimension,
  normalizeSamples,
  normalizeSteps,
  validateImageShape,
  validateNaiGenerationCost,
  validateReferenceCount,
  validateMediumRequest,
} from "@/lib/image-request";
import { isNaiModelEnabled } from "@/lib/runtime-config";
import { registry } from "@/lib/adapters/registry";
import type { ImageGenerationRequest } from "@/lib/adapters/types";
import {
  fetchWithModelConcurrency,
} from "@/lib/model-concurrency";
import { withExternalCors } from "@/lib/external-cors";
import { evaluateImageRisk, riskBlockedResponse, riskRateLimitedResponse } from "@/lib/risk-control";
import { createImageSettlement, updateImageSettlement } from "@/lib/risk-settlement";
import { recordIpEvidence } from "@/lib/risk-ip";
import { isNaiMediumModel, naiUsageModel } from "@/lib/nai-native-request";
import { imagePricingStrength, isInFreeEnvelope, upscaleAnlasCost } from "@/lib/image-pricing";
import { isNaiLimitModel } from "@/lib/nai-image-limits";
import { observeNativeImageCompletion } from "@/lib/nai-stream-completion";
import { roundAffAmount } from "@/lib/daily-image-pricing";
import { dailyImagePolicy } from "@/lib/daily-image-billing";
import { IMAGE_UPSTREAM_TIMEOUT_MS } from "@/lib/image-timeouts";
import { pngDimensions } from "@/lib/png-dims";

const droppedResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Preserve verified ingress context without duplicating case-insensitive headers. */
export function nativeRequestHeaders(request: Request, authorization: string, accept?: string): Headers {
  const headers = new Headers(request.headers);
  headers.set("Authorization", authorization);
  if (accept) headers.set("Accept", accept);
  headers.delete("content-length");
  return headers;
}
const droppedRequestHeaders = new Set([
  ...droppedResponseHeaders,
  "content-length",
  "cookie",
  "host",
  "new-api-user",
  "x-lfn-user-id",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

type JsonRecord = Record<string, unknown>;

/**
 * 外部图像端点的身份识别：任何有效的 NewAPI key 均可使用，
 * 分组不限（站点注册用户多在 Draw/default 等分组，NewAPI 上不存在
 * 全体用户共有的单一分组）。计费自我约束：优先扣 key 所属用户的
 * 图包/个人 AFF 余额；不足时按配置转交 NewAPI 真实生成并独立结算。
 */
export async function requireIkunExternalIdentity(authorization: string) {
  return resolveExternalApiIdentity(authorization);
}

/** 外部 API（source=api）请求的上游日志：用户名缺失时退化为掩码 key。 */
function externalLogMeta(
  user: string,
  imageRequest: ExternalImageRequest,
  endpoint: string,
): GatewayLogMeta {
  const gen = imageRequest.generation;
  return {
    source: "api",
    user,
    endpoint,
    op: gen.operation,
    model: gen.model,
    samples: gen.samples,
  };
}

const novelAiModelAliases: Record<string, string> = {
  "nai-diffusion-4-5-full": "nai-v4.5-full",
  "nai-diffusion-4-5-curated": "nai-v4.5-curated",
  "nai-diffusion-4-5-full-inpainting": "nai-v4.5-inpaint",
  "nai-diffusion-5": "nai-v5-full",
  "nai-diffusion-5-curated": "nai-v5-curated",
  "nai-diffusion-5-full": "nai-v5-full",
  "nai-diffusion-5-inpainting": "nai-v5-inpaint",
  "nai-diffusion-5-full-inpainting": "nai-v5-inpaint",
  "nai-diffusion-5-full-medium": "nai-v5-full-medium",
  "nai-diffusion-5-full-medium-inpainting": "nai-v5-inpaint-medium",
  "nai-diffusion-4-full": "nai-v4-full",
  "nai-diffusion-4-curated-preview": "nai-v4-curated",
  "nai-diffusion-3": "nai-v3",
  "nai-diffusion-3-inpainting": "nai-v3-inpaint",
  "nai-diffusion-furry-3": "nai-v3-furry",
  "nai-diffusion-furry-3-inpainting": "nai-v3-furry-inpaint",
};

export type ExternalImageRequest = {
  body: BodyInit | null;
  contentType: string | null;
  generation: AffGeneration;
  prompt?: string;
};

export function bearerAuthorization(request: Request): string | Response {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return withExternalCors(Response.json(
      {
        error: {
          message: "Missing or invalid Authorization: Bearer <NewAPI key>",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    ));
  }
  return authorization;
}

export async function proxyNewApi(
  request: Request,
  pathname: string,
  body?: BodyInit | null,
  contentType?: string | null,
): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;

  try {
    let imageUserId: number | null = null;
    if (pathname.startsWith("/v1/images/")) {
      const identity = await requireIkunExternalIdentity(authorization);
      if (identity instanceof Response) return withExternalCors(identity);
      imageUserId = identity.userId;
    }
    assertBodySize(request);
    const headers = new Headers();
    const isFormDataBody = body instanceof FormData;
    request.headers.forEach((value, key) => {
      if (
        !droppedRequestHeaders.has(key.toLowerCase()) &&
        !(isFormDataBody && key.toLowerCase() === "content-type")
      )
        headers.set(key, value);
    });
    headers.set("Authorization", authorization);
    const requestContentType = contentType ?? request.headers.get("content-type");
    if (requestContentType && !isFormDataBody)
      headers.set("Content-Type", requestContentType);
    const upstream = await fetchWithModelConcurrency(`${await resolvedNewApiBaseUrl()}${pathname}`, {
      method: request.method,
      headers,
      body:
        body === undefined && request.method !== "GET"
          ? await request.arrayBuffer()
          : body,
      cache: "no-store",
      signal: AbortSignal.timeout(IMAGE_UPSTREAM_TIMEOUT_MS),
    });
    if (imageUserId != null && upstream.ok) {
      let model = "external-image";
      try { model = String(body instanceof FormData ? body.get("model") || model : typeof body === "string" ? JSON.parse(body).model || model : model); } catch { /* Optional attribution only. */ }
      const marked = await watermarkImageResponse(upstream, imageUserId, model, { requestId: randomUUID() });
      return withExternalCors(forwardResponse(marked.response));
    }
    return withExternalCors(forwardResponse(upstream));
  } catch (error) {
    return withExternalCors(Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Upstream request failed",
          type: "api_error",
          code: "upstream_unavailable",
        },
      },
      { status: 502 },
    ));
  }
}

function localBillingError(message: string, status: number): Response {
  return withExternalCors(Response.json({ error: { message, type: "billing_error", code: status === 402 ? "lfn_insufficient_credits" : "lfn_billing_unavailable" } }, { status }));
}

function paymentResponse(response: Response, source: "package" | "personal" | "mixed" | "newapi"): Response {
  const headers = new Headers(response.headers);
  headers.set("X-LFN-Payment-Source", source);
  return withExternalCors(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

async function auditedResponse(
  response: Response,
  audit: Awaited<ReturnType<typeof startRequestAudit>>,
  patch: Parameters<Awaited<ReturnType<typeof startRequestAudit>>["finish"]>[0] = {},
): Promise<Response> {
  const anlas = response.headers.get("x-anlas-cost");
  const cost = anlas?.trim() ? Number(anlas) : NaN;
  if (Number.isFinite(cost) && cost >= 0) audit.record.billing = { ...audit.record.billing, gatewayAnlasCost: cost };
  const countHeader = response.headers.get("x-lfn-generated-samples");
  const generatedSamples = countHeader?.trim() ? Number(countHeader) : undefined;
  await audit.finish({ ...patch, status: response.status, ...(generatedSamples != null && Number.isInteger(generatedSamples) ? { generatedSamples } : {}) });
  const forwarded = forwardResponse(response);
  return withExternalCors(new Response(forwarded.body, {
    status: forwarded.status,
    statusText: forwarded.statusText,
    headers: audit.responseHeaders(forwarded.headers),
  }));
}

async function watermarkJsonResponse(
  response: Response,
  userId: number,
  model: string,
  audit: Awaited<ReturnType<typeof startRequestAudit>>,
): Promise<Response> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return auditedResponse(response, audit);
  try {
    const payload = (await response.clone().json()) as JsonRecord;
    const data = Array.isArray(payload.data) ? payload.data : [];
    let watermarkStatus: "embedded" | "disabled" | "skipped" | "failed" = "skipped";
    const marked = await Promise.all(data.map(async (item, index) => {
      if (!isRecord(item) || typeof item.b64_json !== "string") return item;
      const input = `data:image/png;base64,${item.b64_json.replace(/^data:image\/[^;]+;base64,/, "")}`;
      const result = await watermarkImages([input], userId, model, {
        requestId: audit.requestId,
        requestFingerprint: audit.requestFingerprint,
        parameters: audit.record.parameters,
        imageId: `${audit.requestId}-${index + 1}`,
      });
      watermarkStatus = watermarkStatus === "failed" || result.status === "failed" ? "failed" : watermarkStatus === "embedded" || result.status === "embedded" ? "embedded" : result.status;
      return { ...item, b64_json: result.images[0].replace(/^data:image\/[^;]+;base64,/, "") };
    }));
    const body = JSON.stringify(data.length ? { ...payload, data: marked } : payload);
    const headers = audit.responseHeaders(response.headers);
    // The JSON body may change size after watermark metadata is embedded. Do
    // not forward entity/framing headers that describe the upstream body.
    for (const name of droppedResponseHeaders) headers.delete(name);
    for (const name of ["content-range", "content-md5", "digest", "etag"]) headers.delete(name);
    headers.set("content-type", "application/json");
    headers.set("X-LFN-Watermark", watermarkStatus);
    const generatedSamples = imageCountFromJson(payload);
    headers.set("X-LFN-Generated-Samples", String(generatedSamples));
    const rawAnlas = response.headers.get("x-anlas-cost");
    const reportedAnlas = rawAnlas?.trim() ? Number(rawAnlas) : NaN;
    if (Number.isFinite(reportedAnlas) && reportedAnlas >= 0) audit.record.billing = { ...audit.record.billing, gatewayAnlasCost: reportedAnlas };
    await audit.finish({ status: response.status, watermarkStatus, generatedSamples });
    return withExternalCors(new Response(body, { status: response.status, statusText: response.statusText, headers }));
  } catch {
    return auditedResponse(response, audit, { watermarkStatus: "failed" });
  }
}

function imageCountFromJson(value: unknown): number {
  if (!isRecord(value) || !Array.isArray(value.data)) return 0;
  return value.data.filter(
    (item) =>
      isRecord(item) &&
      (typeof item.b64_json === "string" || typeof item.url === "string"),
  ).length;
}

export function isNaiExternalModel(model: string): boolean {
  return /^nai-(?!chat$)/i.test(model);
}

function paymentSourceForCharge(
  charge: ImageCreditCharge,
): "package" | "personal" | "mixed" {
  return charge.packageCost > 0 && charge.personalCost > 0
    ? "mixed"
    : charge.packageCost > 0
      ? "package"
      : "personal";
}

async function settleExternalCharge(
  response: Response,
  userId: number,
  charge: ImageCreditCharge,
  settlementId: string,
  requestId: string,
  audit?: Awaited<ReturnType<typeof startRequestAudit>>,
): Promise<Response> {
  const anlasHeader = response.headers.get("x-anlas-cost");
  const tokensHeader = response.headers.get("x-prompt-tokens");
  const anlasCost = anlasHeader?.trim() ? Number(anlasHeader) : NaN;
  const promptTokens = tokensHeader?.trim() ? Number(tokensHeader) : NaN;
  let gatewayUsage: JsonRecord | undefined;
  if ((response.headers.get("content-type") || "").includes("application/json")) {
    try {
      const payload = (await response.clone().json()) as JsonRecord;
      if (audit) audit.record.moderation = await moderationFromUpstream(payload);
      if (isRecord(payload.usage)) gatewayUsage = payload.usage;
    } catch {
      gatewayUsage = undefined;
    }
  }
  const validAnlas = Number.isSafeInteger(anlasCost) && anlasCost >= 0;
  const validPromptTokens = Number.isSafeInteger(promptTokens) && promptTokens >= 0;
  const recordBilling = (chargedAff: number): void => {
    if (!audit) return;
    audit.record.billing = {
      lfnChargedAff: chargedAff,
      ...(validAnlas ? { gatewayAnlasCost: anlasCost } : {}),
      ...(validPromptTokens ? { gatewayPromptTokens: promptTokens } : {}),
      ...(gatewayUsage ? { gatewayUsage } : {}),
    };
  };
  const settleLocal = async (generatedSamples: number): Promise<void> => {
    const completed = Math.min(charge.samples, Math.max(0, generatedSamples));
    if (audit) audit.record.generatedSamples = completed;
    if (completed < charge.samples)
      await refundImageCredits(userId, charge, completed, { settlementId, requestId });
    const chargedAmount = charge.packageChargesBySample.slice(0, completed).reduce((sum, value) => sum + value, 0) +
      charge.personalChargesBySample.slice(0, completed).reduce((sum, value) => sum + value, 0);
    recordBilling(chargedAmount);
    await updateImageSettlement(settlementId, {
      generatedSamples: completed,
      gatewayAnlasCost: validAnlas ? anlasCost : undefined,
      gatewayPromptTokens: validPromptTokens ? promptTokens : undefined,
      gatewayUsage,
      status: completed === charge.samples ? "succeeded" : completed ? "partially-refunded" : "refunded",
    });
  };
  const paymentSource = paymentSourceForCharge(charge);
  if (!response.ok) {
    await refundImageCredits(userId, charge, 0, { settlementId, requestId });
    return paymentResponse(response, paymentSource);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    await settleLocal(charge.samples);
    return paymentResponse(response, paymentSource);
  }
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    await refundImageCredits(userId, charge, 0, { settlementId, requestId });
    if (audit) audit.record.generatedSamples = 0;
    recordBilling(0);
    return paymentResponse(Response.json({
      error: {
        message: "上游图像响应不完整或不是有效 JSON，本站已退还本次图像额度",
        type: "api_error",
        code: "lfn_image_invalid_response",
      },
    }, { status: 502 }), paymentSource);
  }
  await settleLocal(imageCountFromJson(payload));
  return paymentResponse(response, paymentSource);
}

// 使用适配器系统处理图像请求
export async function proxyImageWithCredits(
  request: Request,
  pathname: string,
  imageRequest: ExternalImageRequest,
): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  const identity = authorization;
  if (!isNaiExternalModel(imageRequest.generation.model))
    return proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType);
  if (!(await isNaiModelEnabled(imageRequest.generation.model)))
    return withExternalCors(Response.json({ error: { message: "该 NAI 模型已被管理员停用", code: "model_disabled" } }, { status: 403 }));
  const rate = checkImageRateLimit(request, identity);
  if (!rate.allowed)
    return withExternalCors(Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    ));

  let apiIdentity: Awaited<ReturnType<typeof requireIkunExternalIdentity>>;
  try {
    apiIdentity = await requireIkunExternalIdentity(authorization);
  } catch {
    return withExternalCors(Response.json(
      {
        error: {
          message: "暂时无法连接账号服务，请稍后重试",
          type: "api_error",
          code: "lfn_account_service_unavailable",
        },
      },
      { status: 502 },
    ));
  }
  if (apiIdentity instanceof Response) return apiIdentity;
  if (apiIdentity.allowedModels && !apiIdentity.allowedModels.some(m => naiUsageModel(m) === naiUsageModel(imageRequest.generation.model))) return withExternalCors(Response.json({ error: { message: "此 API Key 未授权当前模型", code: "lfn_key_model_forbidden" } }, { status: 403 }));
  const logUser = apiIdentity.username || maskKeyForLog(authorization);
  const audit = await startRequestAudit({
    request,
    source: "api",
    endpoint: pathname,
    userId: apiIdentity.userId ?? undefined,
    username: logUser,
    operation: imageRequest.generation.operation,
    model: imageRequest.generation.model,
    parameters: imageRequest.generation as unknown as Record<string, unknown>,
  });
  const ipEvidence = await recordIpEvidence(request, audit.requestId, apiIdentity.userId ?? undefined, logUser, true).catch(() => null);
  if (ipEvidence) audit.record.ipEvidenceId = ipEvidence.evidenceId;

  const userId = apiIdentity.userId;
  const strictBilling = userId == null || (isNaiExternalModel(imageRequest.generation.model) && (await dailyImagePolicy()).strictApiBilling !== false);
  if (userId != null) {
    try {
      const risk = await evaluateImageRisk({
        userId,
        username: logUser,
        model: imageRequest.generation.model,
        prompt: imageRequest.prompt,
        requestId: audit.requestId,
      });
      audit.record.risk = {
        score: risk.score,
        level: risk.level,
        signalIds: risk.signalIds,
        ...(risk.prompt ? {
          promptFingerprint: risk.prompt.promptFingerprint,
          promptShapeFingerprint: risk.prompt.promptShapeFingerprint,
          promptLength: risk.prompt.normalizedLength,
        } : {}),
        ...(risk.clusterId ? { clusterId: risk.clusterId } : {}),
        decision: risk.decision,
      };
      if (risk.decision === "deny")
        return auditedResponse(withExternalCors(riskBlockedResponse(risk)), audit, { error: "账号已被风控封禁" });
      if (risk.decision === "rate-limit")
        return auditedResponse(withExternalCors(await riskRateLimitedResponse(risk)), audit, { error: "账号触发风控限流" });
    } catch (error) {
      return auditedResponse(
        withExternalCors(Response.json(
          { error: { message: "风控服务暂时不可用，请稍后重试", code: "lfn_risk_unavailable" } },
          { status: 503 },
        )),
        audit,
        { error: error instanceof Error ? error.message : "风控服务不可用" },
      );
    }
  }

  // 尝试从适配器获取图像服务
  const imageAdapter = await registry.getImageAdapter();
  const platformUpstream = await resolvedImageUpstream();
  if (!imageAdapter && !platformUpstream) {
    if (strictBilling) return auditedResponse(localBillingError("没有可用的本地计费执行通道", 503), audit);
    gatewayLogStart(
      externalLogMeta(maskKeyForLog(authorization), imageRequest, pathname),
    )(-1);
    return auditedResponse(await proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType), audit);
  }
  if (userId == null) {
    if (strictBilling) return auditedResponse(localBillingError("暂时无法确认 API Key 对应账号，请稍后重试", 503), audit);
    // key 无法归属站内用户：按设计退回透明代理，仅按 NewAPI 余额计费。
    gatewayLogStart(
      externalLogMeta(maskKeyForLog(authorization), imageRequest, pathname),
    )(-1);
    return auditedResponse(await proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType), audit);
  }

  const userRate = checkImageRateLimit(request, `user:${userId}`);
  if (!userRate.allowed)
    return withExternalCors(Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(userRate.retryAfterSeconds) } },
    ));

  let charge: ImageCreditCharge | null = null;
  let settled = false;
  let settlementId: string | undefined;
  try {
    charge = await trySpendImageCredits(userId, imageRequest.generation, audit.requestId);
    if (!charge) {
      if (strictBilling) return auditedResponse(localBillingError("本站 AFF 或图包余额不足，本次未改用其他钱包扣费", 402), audit);
      gatewayLogStart(externalLogMeta(logUser, imageRequest, pathname))(-1);
      // 用户分组可能没有该模型的渠道：先尝试托管密钥换组重试。
      const managedKey = await ensureManagedFallbackToken(
        userId,
        imageRequest.generation.model,
      ).catch(() => null);
      if (managedKey) {
        const managedHeaders = new Headers({
          Authorization: `Bearer sk-${managedKey}`,
          "Content-Type": imageRequest.contentType || "application/json",
        });
        const finishManagedLog = gatewayLogStart(
          externalLogMeta(logUser, imageRequest, pathname),
        );
        const managedUpstream = await fetchWithModelConcurrency(
          `${await resolvedNewApiBaseUrl()}${pathname}`,
          {
            method: request.method,
            headers: managedHeaders,
            body: imageRequest.body,
            cache: "no-store",
            signal: AbortSignal.timeout(IMAGE_UPSTREAM_TIMEOUT_MS),
          },
        ).catch((error: unknown) => {
          finishManagedLog(0);
          throw error;
        });
        finishManagedLog(managedUpstream.status);
        return watermarkJsonResponse(await auditedResponse(paymentResponse(forwardResponse(managedUpstream), "newapi"), audit, { paymentSource: "newapi" }), userId, imageRequest.generation.model, audit);
      }
      return auditedResponse(
        paymentResponse(
          await proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType),
          "newapi",
        ),
        audit,
        { paymentSource: "newapi" },
      );
    }
    settlementId = `settlement:${audit.requestId}`;
    await createImageSettlement({ settlementId, requestId: audit.requestId, userId, charge });
    audit.record.settlement = {
      settlementId,
      status: "charged",
      chargedAmount: charge.cost,
      refundedAmount: 0,
      paymentSource: paymentSourceForCharge(charge),
    };

    // 使用适配器生成图像
    if (imageAdapter) {
      const finishAdapterLog = gatewayLogStart(
        externalLogMeta(logUser, imageRequest, "adapter"),
      );
      try {
        const gen = imageRequest.generation;
        const operation = gen.operation as "generate" | "img2img" | "inpainting" | "upscale" | undefined;
        const adapterRequest: ImageGenerationRequest = {
          model: gen.model,
          prompt: "", // 从 body 解析
          width: gen.width,
          height: gen.height,
          samples: gen.samples,
          steps: gen.steps,
          strength: gen.strength,
          operation,
        };
        
        // Preserve the same effective parameters that were quoted, including
        // inpaint strength, references and input images on configured adapters.
        let bodyJson: JsonRecord = {};
        if (typeof imageRequest.body === "string") bodyJson = JSON.parse(imageRequest.body) as JsonRecord;
        else if (imageRequest.body instanceof FormData) {
          for (const [key, value] of imageRequest.body.entries())
            bodyJson[key] = value instanceof File ? Buffer.from(await value.arrayBuffer()).toString("base64") : value;
          bodyJson = normalizeExternalImageBody(bodyJson, new Headers(), pathname.endsWith("/edits"));
        }
        adapterRequest.prompt = String(bodyJson.prompt || bodyJson.input || "");
        adapterRequest.negativePrompt = bodyJson.negative_prompt as string | undefined;
        adapterRequest.seed = bodyJson.seed as number | undefined;
        adapterRequest.extra = bodyJson;

        const result = await imageAdapter.generate(adapterRequest);

        settled = true;
        finishAdapterLog(200);

        // 转换为兼容格式
        const response = Response.json({
          data: result.images,
          usage: result.usage,
        });
        return watermarkJsonResponse(await settleExternalCharge(response, userId, charge, settlementId, audit.requestId, audit), userId, imageRequest.generation.model, audit);
      } catch (error) {
        console.error("Adapter image generation failed, falling back:", error);
        finishAdapterLog(0);
        // 失败时回退到原始方式
      }
    }

    // 回退：使用环境变量配置的端点
    if (platformUpstream) {
      const headers = queuedRiskHeaders(audit.requestId, {
        Authorization: `Bearer ${platformUpstream.token}`,
        ...(imageRequest.contentType ? { "Content-Type": imageRequest.contentType } : {}),
      });
      const finishUpstreamLog = gatewayLogStart(
        externalLogMeta(logUser, imageRequest, pathname),
      );
      const upstream = await fetchWithModelConcurrency(`${platformUpstream.baseUrl}${pathname}`, {
        method: request.method,
        headers,
        body: imageRequest.body,
        cache: "no-store",
        signal: AbortSignal.timeout(IMAGE_UPSTREAM_TIMEOUT_MS),
      }).catch((error: unknown) => {
        finishUpstreamLog(0);
        throw error;
      });
      finishUpstreamLog(upstream.status);
      settled = true;
      return watermarkJsonResponse(await settleExternalCharge(upstream, userId, charge, settlementId, audit.requestId, audit), userId, imageRequest.generation.model, audit);
    }

    throw new Error("No image service available");
  } catch (error) {
    const admission = riskAdmissionResponse(error);
    if (admission) return auditedResponse(admission, audit);
    if (charge && !settled) await refundImageCredits(userId, charge, 0, { settlementId, requestId: audit.requestId });
    const response = Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "LFN 图像请求失败",
          type: "api_error",
          code: "lfn_image_upstream_error",
        },
      },
      { status: 502 },
    );
    return auditedResponse(response, audit, { error: error instanceof Error ? error.message : "LFN 图像请求失败" });
  }
}

export function forwardResponse(upstream: Response): Response {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!droppedResponseHeaders.has(key.toLowerCase())) headers.set(key, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export function naiGenerationPayload(body: JsonRecord): JsonRecord {
  const parameters = isRecord(body.parameters) ? body.parameters : {};
  const model = assertImageModel(modelAlias(body.model));
  const width = normalizeDimension(
    parameters.width ?? (isRecord(body) ? body.width : undefined),
    "width",
  );
  const height = normalizeDimension(
    parameters.height ?? (isRecord(body) ? body.height : undefined),
    "height",
  );
  validateImageShape(width, height);
  const samples = normalizeSamples({
    n: parameters.n ?? body.n,
    n_samples: parameters.n_samples ?? body.n_samples,
  });
  const steps = normalizeSteps(parameters.steps ?? body.steps, model.endsWith("-medium") ? 14 : 28);
  const action =
    typeof body.action === "string" ? body.action.toLowerCase() : "generate";
  const operation =
    action === "img2img"
      ? "img2img"
      : action === "infill"
        ? "inpainting"
        : undefined;
  const rest = { ...parameters };
  delete rest.n;
  delete rest.n_samples;
  // OpenAI fallback must return final base64 images. A native "msgpack"
  // stream flag is not an OpenAI boolean stream flag.
  delete rest.stream;
  validateNaiGenerationCost(model, width, height, steps, imagePricingStrength(rest, operation ?? action), operation ?? action);
  validateMediumRequest(model, { ...rest, width, height, n: samples, steps }, operation ?? action);
  return {
    ...rest,
    prompt: typeof body.input === "string" ? body.input : "",
    model,
    n: samples,
    n_samples: samples,
    steps,
    width,
    height,
    size: `${width}x${height}`,
    response_format: "b64_json",
    ...(operation ? { novelai_operation: operation } : {}),
  };
}

export async function naiZipResponse(upstream: Response): Promise<Response> {
  if (!upstream.ok) return withExternalCors(forwardResponse(upstream));
  return withExternalCors(await compatibleNaiZipResponse(upstream));
}

/** Launcher v4 accepts big-endian length-prefixed MessagePack, including on NewAPI fallback. */
export async function naiMsgpackResponse(upstream: Response): Promise<Response> {
  if (!upstream.ok) return withExternalCors(forwardResponse(upstream));
  const type = (upstream.headers.get("content-type") || "").toLowerCase();
  if (type.includes("msgpack") || type.includes("octet-stream")) return withExternalCors(forwardResponse(upstream));
  let images: Uint8Array[] = [];
  const headers = new Headers(upstream.headers);
  if (type.includes("json")) {
    const result = await upstream.json() as JsonRecord;
    images = (Array.isArray(result.data) ? result.data : []).flatMap((item) => {
      if (!isRecord(item) || typeof item.b64_json !== "string") return [];
      return [Uint8Array.from(Buffer.from(item.b64_json.replace(/^data:image\/[^;]+;base64,/, ""), "base64"))];
    });
    headers.set("X-LFN-Usage", encodeURIComponent(JSON.stringify(result.usage ?? null)));
  } else if (type.includes("zip")) {
    const zip = await JSZip.loadAsync(await upstream.arrayBuffer());
    images = await Promise.all(Object.values(zip.files).filter((item) => !item.dir && /\.(png|webp|jpe?g)$/i.test(item.name)).map((item) => item.async("uint8array")));
  }
  if (!images.length || images.some((image) => !image.length)) return withExternalCors(Response.json({ message: "上游没有返回有效图片", code: "lfn_native_empty_image" }, { status: 502 }));
  const frames = images.map((image, index) => {
    const payload = encode({ event_type: "final", samp_ix: index, image });
    const frame = new Uint8Array(4 + payload.length);
    new DataView(frame.buffer).setUint32(0, payload.length, false);
    frame.set(payload, 4);
    return frame;
  });
  const bytes = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
  let offset = 0;
  for (const frame of frames) { bytes.set(frame, offset); offset += frame.length; }
  headers.set("Content-Type", "application/x-msgpack");
  headers.set("Content-Length", String(bytes.length));
  headers.set("X-LFN-Stream-Mode", "final-fallback");
  headers.set("X-LFN-Generated-Samples", String(images.length));
  return withExternalCors(new Response(bytes, { headers }));
}

async function nativeResponseForPath(response: Response, pathname: string): Promise<Response> {
  if (!pathname.startsWith("/ai/generate-image")) return response;
  return pathname.endsWith("-stream") ? naiMsgpackResponse(response) : naiZipResponse(response);
}

export function unsupportedNaiOperation(request: Request, operation: string): Response {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  return withExternalCors(Response.json(
    {
      message: `${operation} is recognized, but NewAPI has no auditable billing mapping for it`,
    },
    { status: 409 },
  ));
}

const IMAGE_NATIVE_PREFIXES = [
  "/ai/generate-image",
  "/ai/generate-image-stream",
  "/ai/encode-vibe",
  "/ai/augment-image",
  "/ai/upscale",
];

function naiNativeError(message: string, status: number, code: string): Response {
  return withExternalCors(Response.json(
    { message, error: { message, type: "invalid_request_error", code } },
    { status },
  ));
}

export function forbiddenUserAccount(): Response {
  return naiNativeError(
    "账户信息不对普通用户开放，必须由 Love for NAI 服务端使用 Gateway Token 请求",
    403,
    "gateway_auth_required",
  );
}

/**
 * NovelAI 原生 /user/subscription 兼容响应。
 *
 * 第三方客户端（如 Aaalice NAI Launcher）登录时先请求该端点验证 Token：
 * 404 会触发其降级探测，但 403 等其他 4xx 会被归为"未知错误"导致登录失败。
 * 因此这里用站内 AFF 账本合成一份订阅信息：Anlas 余额映射为
 * trainingStepsLeft，订阅等级固定 Paper（tier 0，不影响客户端费用估算），
 * active 恒为 true 以通过客户端的订阅有效性检查。
 */
export async function naiSubscriptionResponse(
  userId: number,
): Promise<Response> {
  const status = await affStatus(userId).catch(() => null);
  const anlas = status ? Math.max(0, Math.floor(status.totalBalance)) : 0;
  return withExternalCors(Response.json({
    tier: 0,
    active: true,
    trainingStepsLeft: {
      fixedTrainingStepsLeft: anlas,
      purchasedTrainingSteps: 0,
    },
    perks: {
      maxPriorityActions: 0,
      startPriority: 0,
      moduleTrainingSteps: 0,
      unlimitedImageGeneration: false,
      imageGeneration: true,
      contextTokens: 8000,
    },
  }));
}

export async function proxyNaiNativeWithCredits(
  request: Request,
  pathname: string,
  imageRequest: ExternalImageRequest,
  newApiFallback?: { pathname: string; body: BodyInit; contentType: string } | "unsupported",
): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  const identity = authorization;
  if (!(await isNaiModelEnabled(imageRequest.generation.model)))
    return withExternalCors(Response.json({ error: { message: "该 NAI 模型已被管理员停用", code: "model_disabled" } }, { status: 403 }));
  const rate = checkImageRateLimit(request, identity);
  if (!rate.allowed)
    return withExternalCors(Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    ));

  let apiIdentity: Awaited<ReturnType<typeof requireIkunExternalIdentity>>;
  try {
    apiIdentity = await requireIkunExternalIdentity(authorization);
  } catch {
    return withExternalCors(Response.json(
      { error: { message: "暂时无法连接账号服务，请稍后重试", code: "lfn_account_service_unavailable" } },
      { status: 502 },
    ));
  }
  if (apiIdentity instanceof Response) return apiIdentity;
  if (apiIdentity.allowedModels && !apiIdentity.allowedModels.some(m => naiUsageModel(m) === naiUsageModel(imageRequest.generation.model))) return withExternalCors(Response.json({ error: { message: "此 API Key 未授权当前模型", code: "lfn_key_model_forbidden" } }, { status: 403 }));
  const logUser = apiIdentity.username || maskKeyForLog(authorization);
  const audit = await startRequestAudit({
    request,
    source: "api",
    endpoint: pathname,
    userId: apiIdentity.userId ?? undefined,
    username: logUser,
    operation: imageRequest.generation.operation,
    model: imageRequest.generation.model,
    parameters: imageRequest.generation as unknown as Record<string, unknown>,
  });

  const userId = apiIdentity.userId;
  let risk: Awaited<ReturnType<typeof evaluateImageRisk>> | null = null;
  const strictBilling = userId == null || (isNaiExternalModel(imageRequest.generation.model) && (await dailyImagePolicy()).strictApiBilling !== false);
  if (userId != null) {
    try {
      risk = await evaluateImageRisk({
        userId,
        username: logUser,
        model: imageRequest.generation.model,
        prompt: imageRequest.prompt,
        requestId: audit.requestId,
      });
    } catch (error) {
      return auditedResponse(
        withExternalCors(Response.json(
          { error: { message: "风控服务暂时不可用，请稍后重试", code: "lfn_risk_unavailable" } },
          { status: 503 },
        )),
        audit,
        { error: error instanceof Error ? error.message : "风控服务不可用" },
      );
    }
    audit.record.risk = {
      score: risk.score,
      level: risk.level,
      signalIds: risk.signalIds,
      ...(risk.prompt ? {
        promptFingerprint: risk.prompt.promptFingerprint,
        promptShapeFingerprint: risk.prompt.promptShapeFingerprint,
        promptLength: risk.prompt.normalizedLength,
      } : {}),
      ...(risk.clusterId ? { clusterId: risk.clusterId } : {}),
      decision: risk.decision,
    };
    if (risk.decision === "deny")
      return auditedResponse(withExternalCors(riskBlockedResponse(risk)), audit, { error: "账号已被风控封禁" });
    if (risk.decision === "rate-limit")
      return auditedResponse(withExternalCors(await riskRateLimitedResponse(risk)), audit, { error: "账号触发风控限流" });
  }

  const preferImage = IMAGE_NATIVE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const nativeUpstream = preferImage
    ? (await resolvedNaiImageUpstream()) || (await resolvedNaiAccountUpstream())
    : (await resolvedNaiAccountUpstream()) || (await resolvedNaiImageUpstream());
  if (!nativeUpstream) {
    if (strictBilling) return auditedResponse(localBillingError("没有可用的本地计费执行通道", 503), audit);
    // 走 NewAPI 透明回退时实际到达 Gateway 的端点（可能映射为 /v1/images/*）。
    const fallbackEndpoint =
      newApiFallback && newApiFallback !== "unsupported"
        ? newApiFallback.pathname
        : pathname;
    gatewayLogStart(
      externalLogMeta(maskKeyForLog(authorization), imageRequest, fallbackEndpoint),
    )(-1);
    return auditedResponse(await nativeNewApiFallback(request, pathname, imageRequest, newApiFallback), audit, { paymentSource: "newapi" });
  }

  // 走 NewAPI 透明回退时实际到达 Gateway 的端点（可能映射为 /v1/images/*）。
  const fallbackEndpoint =
    newApiFallback && newApiFallback !== "unsupported"
      ? newApiFallback.pathname
      : pathname;
  if (userId == null) {
    // key 无法归属站内用户：按设计退回透明代理，仅按 NewAPI 余额计费。
    if (strictBilling) return auditedResponse(localBillingError("暂时无法确认 API Key 对应账号，请稍后重试", 503), audit);
    gatewayLogStart(
      externalLogMeta(maskKeyForLog(authorization), imageRequest, fallbackEndpoint),
    )(-1);
    return auditedResponse(await nativeNewApiFallback(request, pathname, imageRequest, newApiFallback), audit, { paymentSource: "newapi" });
  }

  const userRate = checkImageRateLimit(request, `user:${userId}`);
  if (!userRate.allowed)
    return withExternalCors(Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(userRate.retryAfterSeconds) } },
    ));

  let charge: ImageCreditCharge | null = null;
  let settled = false;
  let settlementId: string | undefined;
  try {
    charge = await trySpendImageCredits(userId, imageRequest.generation, audit.requestId);
    if (!charge) {
      gatewayLogStart(
        externalLogMeta(logUser, imageRequest, fallbackEndpoint),
      )(-1);
      if (strictBilling) return auditedResponse(localBillingError("本站 AFF 或图包余额不足，本次未改用其他钱包扣费", 402), audit);
      // NewAPI 执行并结算自己的真实请求，不使用 LFN 每日阶梯价格。
      // 用户分组可能没有该模型的渠道（如 default 打 NAI 模型）：
      // 先取一把可用分组的托管密钥重试，取不到再用原 key 透传保留
      // 原始错误。
      const managedKey = await ensureManagedFallbackToken(
        userId,
        imageRequest.generation.model,
      ).catch(() => null);
      if (managedKey) {
        const target = newApiFallback && newApiFallback !== "unsupported"
          ? newApiFallback
          : { pathname, body: imageRequest.body, contentType: imageRequest.contentType };
        const managedHeaders = new Headers({
          Authorization: `Bearer sk-${managedKey}`,
          "Content-Type": target.contentType || "application/json",
        });
        const accept = request.headers.get("accept");
        if (accept) managedHeaders.set("Accept", accept);
        const finishManagedLog = gatewayLogStart(
          externalLogMeta(logUser, imageRequest, target.pathname),
        );
        const managedUpstream = await fetchWithModelConcurrency(
          `${await resolvedNewApiBaseUrl()}${target.pathname}`,
          {
            method: request.method,
            headers: managedHeaders,
            body: target.body,
            cache: "no-store",
            signal: AbortSignal.timeout(IMAGE_UPSTREAM_TIMEOUT_MS),
          },
        ).catch((error: unknown) => {
          finishManagedLog(0);
          throw error;
        });
        finishManagedLog(managedUpstream.status);
        const marked = await watermarkImageResponse(managedUpstream, userId, imageRequest.generation.model, { requestId: audit.requestId, requestFingerprint: audit.requestFingerprint });
        return auditedResponse(paymentResponse(await nativeResponseForPath(marked.response, pathname), "newapi"), audit, { paymentSource: "newapi", watermarkStatus: marked.status() });
      }
      return auditedResponse(
        paymentResponse(await nativeNewApiFallback(request, pathname, imageRequest, newApiFallback), "newapi"),
        audit,
        { paymentSource: "newapi" },
      );
    }

    settlementId = charge
      ? `settlement:${audit.requestId}`
      : undefined;
    if (charge) {
      await createImageSettlement({ settlementId: settlementId!, requestId: audit.requestId, userId, charge });
      audit.record.settlement = {
        settlementId: settlementId!,
        status: "charged",
        chargedAmount: charge.cost,
        refundedAmount: 0,
        paymentSource: paymentSourceForCharge(charge),
      };
    }

    const headers = queuedRiskHeaders(audit.requestId, {
      Authorization: `Bearer ${nativeUpstream.token}`,
      ...(imageRequest.contentType ? { "Content-Type": imageRequest.contentType } : {}),
    });
    const accept = request.headers.get("accept");
    if (accept) headers.set("Accept", accept);
    const finishNativeLog = gatewayLogStart(
      externalLogMeta(logUser, imageRequest, pathname),
    );
    const upstream = await fetchWithModelConcurrency(`${nativeUpstream.baseUrl}${pathname}`, {
      method: request.method,
      headers,
      body: imageRequest.body,
      cache: "no-store",
      signal: AbortSignal.timeout(IMAGE_UPSTREAM_TIMEOUT_MS),
    }).catch((error: unknown) => {
      finishNativeLog(0);
      throw error;
    });
    finishNativeLog(upstream.status);
    if (!upstream.ok) {
      if ((upstream.headers.get("content-type") || "").includes("application/json")) {
        try { audit.record.moderation = await moderationFromUpstream(await upstream.clone().json()); } catch { /* Unknown result remains unaudited. */ }
      }
      await refundImageCredits(userId, charge, 0, { settlementId, requestId: audit.requestId });
      return auditedResponse(paymentResponse(forwardResponse(upstream), paymentSourceForCharge(charge)), audit, { paymentSource: paymentSourceForCharge(charge) });
    }
    const upstreamContentType = (upstream.headers.get("content-type") || "").toLowerCase();
    if (pathname === "/ai/encode-vibe") {
      // Encoding returns a reusable embedding, not an image/ZIP. Do not run
      // image-envelope validation (which would refund a successful encoding).
      if (!(await upstream.clone().arrayBuffer()).byteLength)
        throw new Error("原生上游没有返回 Vibe 编码");
      if (settlementId) await updateImageSettlement(settlementId, { generatedSamples: 1, status: "succeeded" });
      if (audit.record.settlement) audit.record.settlement.status = "succeeded";
      audit.record.billing = { ...audit.record.billing, lfnChargedAff: charge.cost };
      settled = true;
      return auditedResponse(paymentResponse(forwardResponse(upstream), paymentSourceForCharge(charge)), audit, { paymentSource: paymentSourceForCharge(charge), generatedSamples: 1 });
    }
    const expectedNativeResponse = pathname.endsWith("-stream")
      ? /(?:msgpack|octet-stream|zip|json)/.test(upstreamContentType)
      : /(?:zip|json|octet-stream|image\/)/.test(upstreamContentType);
    if (!expectedNativeResponse) {
      // Release the native account's stream/queue before returning a format error.
      await upstream.body?.cancel().catch(() => undefined);
      await refundImageCredits(userId, charge, 0, { settlementId, requestId: audit.requestId });
      const response = Response.json(
        {
          error: {
            message: `原生上游返回了不支持的响应格式：${upstreamContentType || "未知"}`,
            type: "api_error",
            code: "lfn_native_invalid_response_format",
          },
        },
        { status: 502 },
      );
      return auditedResponse(paymentResponse(response, paymentSourceForCharge(charge)), audit, {
        paymentSource: paymentSourceForCharge(charge),
        error: "原生上游响应格式无效",
      });
    }
    const nativeResponse = pathname.endsWith("-stream")
      ? await naiMsgpackResponse(upstream)
      : await naiZipResponse(upstream);
    if (nativeResponse && !nativeResponse.ok) {
      await refundImageCredits(userId, charge, 0, { settlementId, requestId: audit.requestId });
      return auditedResponse(paymentResponse(nativeResponse, paymentSourceForCharge(charge)), audit, { paymentSource: paymentSourceForCharge(charge), generatedSamples: 0, error: "原生上游未返回有效图片" });
    }
    if (!nativeResponse || pathname.endsWith("-stream") && !nativeResponse.body) {
      await refundImageCredits(userId, charge, 0, { settlementId, requestId: audit.requestId });
      const response = Response.json(
        {
          error: {
            message: "原生上游返回的 ZIP 响应无效",
            type: "api_error",
            code: "lfn_native_invalid_response_format",
          },
        },
        { status: 502 },
      );
      return auditedResponse(paymentResponse(response, paymentSourceForCharge(charge)), audit, {
        paymentSource: paymentSourceForCharge(charge),
        error: "原生上游 ZIP 响应无效",
      });
    }
    const markedNative = await watermarkImageResponse(nativeResponse, userId, imageRequest.generation.model, { requestId: audit.requestId, requestFingerprint: audit.requestFingerprint, parameters: audit.record.parameters });
    const nativeProduced = pathname.endsWith("-stream") ? charge.samples : Math.min(charge.samples, Number(nativeResponse.headers.get("X-LFN-Generated-Samples")) || charge.samples);
    if (!pathname.endsWith("-stream") && nativeProduced < charge.samples) await refundImageCredits(userId, charge, nativeProduced, { settlementId, requestId: audit.requestId });
    settled = true;
    if (settlementId) {
      const anlasHeader = upstream.headers.get("x-anlas-cost");
      const promptHeader = upstream.headers.get("x-prompt-tokens");
      const anlasCost = anlasHeader?.trim() ? Number(anlasHeader) : NaN;
      const promptTokens = promptHeader?.trim() ? Number(promptHeader) : NaN;
      audit.record.billing = {
        lfnChargedAff: roundAffAmount(charge.packageChargesBySample.slice(0, nativeProduced).reduce((sum, cost) => sum + cost, 0) + charge.personalChargesBySample.slice(0, nativeProduced).reduce((sum, cost) => sum + cost, 0)),
        ...(Number.isSafeInteger(anlasCost) && anlasCost >= 0
          ? { gatewayAnlasCost: anlasCost }
          : {}),
        ...(Number.isSafeInteger(promptTokens) && promptTokens >= 0
          ? { gatewayPromptTokens: promptTokens }
          : {}),
      };
      if (!pathname.endsWith("-stream")) {
        if (nativeProduced === charge.samples) await updateImageSettlement(settlementId, { generatedSamples: nativeProduced, status: "succeeded" });
        audit.record.generatedSamples = nativeProduced;
        if (audit.record.settlement) audit.record.settlement.status = nativeProduced === charge.samples ? "succeeded" : "partially-refunded";
      }
    }
    if (pathname.endsWith("-stream")) {
      const source = paymentSourceForCharge(charge);
      const reservedCharge = charge;
      const observed = observeNativeImageCompletion(markedNative.response, charge.samples, async ({ samples: produced, error }) => {
        if (produced < reservedCharge.samples) await refundImageCredits(userId, reservedCharge, produced, { settlementId, requestId: audit.requestId, reason: error });
        else if (settlementId) await updateImageSettlement(settlementId, { generatedSamples: produced, status: "succeeded" });
        const actualCost = roundAffAmount(reservedCharge.packageChargesBySample.slice(0, produced).reduce((sum, cost) => sum + cost, 0) + reservedCharge.personalChargesBySample.slice(0, produced).reduce((sum, cost) => sum + cost, 0));
        audit.record.billing = { ...audit.record.billing, lfnChargedAff: actualCost };
        if (audit.record.settlement) Object.assign(audit.record.settlement, { chargedAmount: actualCost, refundedAmount: roundAffAmount(reservedCharge.cost - actualCost), status: produced === reservedCharge.samples ? "succeeded" : produced ? "partially-refunded" : "refunded" });
        await audit.finish({ status: error ? produced ? 206 : 502 : 200, paymentSource: source, generatedSamples: produced, watermarkStatus: markedNative.status(), ...(error ? { error } : {}) });
      });
      const response = paymentResponse(observed, source);
      return withExternalCors(new Response(response.body, { status: response.status, headers: audit.responseHeaders(response.headers) }));
    }
    return auditedResponse(paymentResponse(forwardResponse(markedNative.response), paymentSourceForCharge(charge)), audit, { paymentSource: paymentSourceForCharge(charge), watermarkStatus: markedNative.status() });
  } catch (error) {
    const admission = riskAdmissionResponse(error);
    if (admission) return auditedResponse(admission, audit);
    if (charge && !settled) await refundImageCredits(userId, charge, 0, { settlementId, requestId: audit.requestId });
    return withExternalCors(Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "LFN 图像请求失败",
          type: "api_error",
          code: "lfn_image_upstream_error",
        },
      },
      { status: 502 },
    ));
  }
}

async function nativeNewApiFallback(
  request: Request,
  pathname: string,
  imageRequest: ExternalImageRequest,
  newApiFallback?: { pathname: string; body: BodyInit; contentType: string } | "unsupported",
): Promise<Response> {
  if (newApiFallback === "unsupported")
    return unsupportedNaiOperation(request, pathname.replace(/^\/ai\//, ""));
  if (newApiFallback)
    return nativeResponseForPath(await proxyNewApi(
      request,
      newApiFallback.pathname,
      newApiFallback.body,
      newApiFallback.contentType,
    ), pathname);
  return nativeResponseForPath(await proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType), pathname);
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function imageOperationFromBody(body: JsonRecord, fallback = "generate"): string {
  const parameters = isRecord(body.parameters) ? body.parameters : {};
  const raw = body.novelai_operation ?? body.operation ?? body.action;
  const operation = typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : fallback;
  if (operation === "generate") {
    const effective = { ...body, ...parameters };
    if (referenceValues(effective, "precise-reference").length) return "precise-reference";
    if (Array.isArray(effective.characters) && effective.characters.length) return "character-reference";
    if (referenceValues(effective, "vibe-transfer").length) return "vibe-transfer";
  }
  return operation === "infill" ? "inpainting" : operation;
}

function referenceValues(body: JsonRecord, operation: string): unknown[] {
  if (operation === "precise-reference") {
    const references = [body.references, body.director_reference_images].find((value) => Array.isArray(value) && value.length);
    return [...(Array.isArray(references) ? references : []), ...(Array.isArray(body.director_reference_images_cached) ? body.director_reference_images_cached : [])];
  }
  if (operation === "character-reference") {
    if (Array.isArray(body.characters))
      return [...body.characters.flatMap((character) => isRecord(character) && typeof character.reference_image === "string" && character.reference_image ? [character.reference_image] : []), ...(Array.isArray(body.reference_image_multiple_cached) ? body.reference_image_multiple_cached : [])];
  }
  const references = [body.reference_image_multiple, body.reference_images, body.vibe].find((value) => Array.isArray(value) && value.length);
  const cached = Array.isArray(body.reference_image_multiple_cached) ? body.reference_image_multiple_cached : [];
  return [...(Array.isArray(references) ? references : typeof body.reference_image === "string" && body.reference_image ? [body.reference_image] : []), ...cached];
}

export function imageReferenceCountFromBody(body: JsonRecord, operation: string): number {
  const parameters = isRecord(body.parameters) ? body.parameters : {};
  return referenceValues({ ...body, ...parameters }, operation).length;
}

function isEncodedVibe(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 1024) return false;
  const encoded = value.replace(/^data:[^,]+,/, "");
  const prefix = Buffer.from(encoded.slice(0, 64), "base64");
  if (!prefix.length) return false;
  const imageSignatures = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.from("GIF87a"),
    Buffer.from("GIF89a"),
    Buffer.from("RIFF"),
    Buffer.from("BM"),
    Buffer.from([0x00, 0x00, 0x01, 0x00]),
  ];
  return !imageSignatures.some((signature) => prefix.subarray(0, signature.length).equals(signature));
}

/**
 * 解析 NAI 原生生图请求体。官方客户端（含 Aaalice NAI Launcher）把
 * 请求编码为 multipart/form-data：JSON 放在名为 request 的部件里，
 * 图片字段（image/mask/参考图等）以二进制部件传输、JSON 内用部件名
 * 占位（占位符 == 字段名，或列表项的 data 字段）。这里还原为纯 JSON
 * （图片字段恢复 base64），计费解析与转发均按 JSON 处理；普通 JSON
 * 请求原样返回。
 */
export async function parseNaiGenerationBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data"))
    return (await request.json()) as Record<string, unknown>;
  const form = await request.formData();
  const requestPart = form.get("request");
  if (!(requestPart instanceof File) && typeof requestPart !== "string")
    throw new Error("multipart 请求缺少 request 部件");
  const json = JSON.parse(typeof requestPart === "string" ? requestPart : await requestPart.text()) as JsonRecord;
  const parts = new Map<string, string>();
  for (const [name, value] of form.entries()) {
    if (name === "request" || !(value instanceof File)) continue;
    parts.set(name, Buffer.from(await value.arrayBuffer()).toString("base64"));
  }
  if (parts.size) {
    const substituteIn = (container: JsonRecord): void => {
      for (const [key, value] of Object.entries(container)) {
        if (typeof value === "string") {
          if ((/^(image|mask|reference_image|data)$/.test(key) || /images|image_multiple/.test(key)) && parts.has(value))
            container[key] = parts.get(value);
        } else if (Array.isArray(value)) {
          container[key] = value.map((item) => {
            if (isRecord(item)) substituteIn(item);
            if (typeof item === "string" && /images|image_multiple/.test(key) && parts.has(item)) return parts.get(item);
            return item;
          });
        } else if (isRecord(value)) {
          substituteIn(value);
        }
      }
    };
    substituteIn(json);
  }
  return json;
}

export function modelAlias(model: unknown): unknown {
  return typeof model === "string" ? novelAiModelAliases[model] || model : model;
}

export function validateExternalMediumRequest(body: JsonRecord, operation = "generate"): void {
  const model = modelAlias(body.model);
  if (typeof model === "string" && isNaiExternalModel(model))
    validateMediumRequest(model, body, operation);
}

export function imageRequestErrorBody(error: unknown, fallback: string): { message: string; code?: string } {
  if (error instanceof ImageRequestValidationError)
    return { message: error.message, code: error.code };
  return { message: error instanceof Error ? error.message : fallback };
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed != null && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function parseSize(value: unknown): { width: number; height: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

// Resolve the Gateway's compatibility overrides before both quoting and forwarding.
// In particular, multipart fields are strings and fallback requests retain headers.
export function normalizeExternalImageBody(body: JsonRecord, headers: Headers, edits = false): JsonRecord {
  if (!isNaiExternalModel(String(modelAlias(body.model) ?? ""))) return body;
  const effective = { ...body, ...(isRecord(body.parameters) ? body.parameters : {}) };
  const reserved = new Set([
    "model", "prompt", "input", "action", "response_format", "size", "n", "user",
    "quality_tags", "revised_prompt", "operation", "novelai_operation", "service_tier",
    "extra_params", "references", "characters", "reference_image", "reference_images",
    "reference_strength", "reference_information_extracted", "image", "mask", "stream", "image_format",
  ]);
  let bodyExtra = body.extra_params;
  if (typeof bodyExtra === "string") {
    try { bodyExtra = JSON.parse(bodyExtra); }
    catch { throw new ImageRequestValidationError("extra_params 必须是 JSON 对象"); }
  }
  const headerExtra = headers.get("x-novelai-extra-params");
  let parsedHeader: unknown;
  if (headerExtra) {
    try { parsedHeader = JSON.parse(headerExtra); }
    catch { throw new ImageRequestValidationError("X-NovelAI-Extra-Params 必须是 JSON 对象"); }
  }
  for (const extra of [bodyExtra, parsedHeader]) {
    if (extra === undefined || extra === null) continue;
    if (!isRecord(extra)) throw new ImageRequestValidationError("extra_params 必须是对象");
    if (Object.keys(extra).some(key => reserved.has(key)))
      throw new ImageRequestValidationError("extra_params 不允许覆盖网关协议字段");
    Object.assign(effective, extra);
    if (extra.n_samples !== undefined) effective.n = extra.n_samples;
  }
  delete effective.extra_params;
  delete effective.parameters;
  if (!edits) {
    for (const [header, key] of [["x-sampler", "sampler"], ["x-noise-schedule", "noise_schedule"], ["x-negative-prompt", "negative_prompt"], ["x-service-tier", "service_tier"]]) {
      const value = headers.get(header);
      if (value !== null) effective[key] = value;
    }
    for (const [header, key] of [["x-steps", "steps"], ["x-seed", "seed"], ["x-n-samples", "n_samples"], ["x-scale", "scale"]]) {
      const value = headers.get(header);
      if (value === null) continue;
      const number = parseFiniteNumber(value);
      if (number === undefined || (key !== "scale" && !Number.isInteger(number)))
        throw new ImageRequestValidationError(`${header} 必须是有效数字`);
      effective[key] = number;
      if (key === "n_samples") effective.n = number;
    }
    const operation = headers.get("x-novelai-operation")?.trim().toLowerCase();
    if (operation) {
      if (typeof effective.novelai_operation === "string" && effective.novelai_operation.trim() && effective.novelai_operation.trim().toLowerCase() !== operation)
        throw new ImageRequestValidationError("X-NovelAI-Operation 与 novelai_operation 冲突");
      effective.novelai_operation = operation;
    }
  }
  for (const key of ["strength", "inpaintImg2ImgStrength", "uncond_scale", "cfg_rescale", "params_version", "ucPreset", "tag_hint_uc_preset"]) {
    if (effective[key] === undefined) continue;
    const value = parseFiniteNumber(effective[key]);
    if (value === undefined) throw new ImageRequestValidationError(`${key} 必须是有效数字`);
    effective[key] = value;
  }
  for (const key of ["sm", "sm_dyn"]) {
    if (effective[key] === "false") effective[key] = false;
    if (effective[key] === "true") effective[key] = true;
  }
  return effective;
}

export function externalGeneration(
  body: JsonRecord,
  operation = imageOperationFromBody(body),
): AffGeneration | null {
  const parameters = isRecord(body.parameters) ? body.parameters : {};
  body = { ...body, ...parameters, ...(!isRecord(body.parameters) && isRecord(body.extra_params) ? body.extra_params : {}) };
  for (const key of ["strength", "inpaintImg2ImgStrength", "uncond_scale"]) {
    if (body[key] === undefined) continue;
    const value = parseFiniteNumber(body[key]);
    if (value === undefined || value < 0) return null;
    body[key] = value;
  }
  const preciseReferences = referenceValues(body, "precise-reference");
  const vibeReferences = referenceValues(body, operation === "precise-reference" ? "generate" : operation);
  const references = preciseReferences.length ? preciseReferences : vibeReferences;
  const size = operation === "upscale"
    ? (typeof body.image === "string" ? pngDimensions(body.image) : null)
    : parseSize(body.size);
  if (operation === "upscale" && !size) return null;
  let width: number;
  let height: number;
  let samples: number;
  let steps: number;
  let model: string;
  try {
    const rawWidth = operation === "upscale" ? size?.width : parsePositiveInteger(body.width) ?? size?.width;
    const rawHeight = operation === "upscale" ? size?.height : parsePositiveInteger(body.height) ?? size?.height;
    width = operation === "upscale" ? size!.width : normalizeDimension(rawWidth, "width");
    height = operation === "upscale" ? size!.height : normalizeDimension(rawHeight, "height");
    validateImageShape(width, height);
    if (operation === "upscale") upscaleAnlasCost(width, height);
    samples = normalizeSamples(body);
    if ((operation === "upscale" || operation.startsWith("director-")) && samples !== 1) return null;
    const requestedModel = modelAlias(body.model);
    if (typeof requestedModel !== "string" || !/^[^\u0000-\u001f\u007f]{1,160}$/.test(requestedModel.trim()))
      throw new ImageRequestValidationError("模型名称无效");
    model = isNaiExternalModel(requestedModel)
      ? assertImageModel(requestedModel)
      : requestedModel.trim();
    steps = operation === "upscale" ? 1 : normalizeSteps(body.steps, isNaiMediumModel(model) ? 14 : 28);
    validateReferenceCount(preciseReferences.length + vibeReferences.length);
    if (isNaiExternalModel(model)) {
      if (operation !== "upscale") validateNaiGenerationCost(model, width, height, steps, imagePricingStrength(body, operation), operation);
      validateMediumRequest(model, body, operation);
    }
  } catch (error) {
    if (error instanceof ImageRequestValidationError) return null;
    return null;
  }
  const generation: AffGeneration = {
    model,
    width,
    height,
    steps,
    samples,
    strength: imagePricingStrength(body, operation),
    uncondScale: typeof body.uncond_scale === "number" ? body.uncond_scale : undefined,
    operation,
    referenceImageCount: references.length,
    vibeReferenceImageCount: vibeReferences.length,
    preciseReferenceImageCount: preciseReferences.length,
    referenceMode: preciseReferences.length ? "precise" : "vibe",
    encodedVibeCount: vibeReferences.filter((reference) =>
      (isRecord(reference) && !reference.data && typeof reference.cache_secret_key === "string" && Boolean(reference.cache_secret_key)) || isEncodedVibe(isRecord(reference) ? reference.data ?? reference.reference_image : reference),
    ).length,
    hasInputImage: Boolean(body.image),
    serviceTier: typeof body.service_tier === "string" ? body.service_tier : undefined,
    characterPromptCount: Array.isArray(body.characterPrompts)
      ? body.characterPrompts.length
      : 0,
  };
  if (isNaiLimitModel(model) && !isInFreeEnvelope(generation)) return null;
  return generation;
}

export function externalJsonBody(body: JsonRecord): BodyInit {
  return JSON.stringify(body);
}
