/**
 * 适配器系统兼容层
 * 将现有 compat-api 逻辑迁移到适配器系统，保持 API 向后兼容
 */

import JSZip from "jszip";
import { Buffer } from "node:buffer";
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
  validateReferenceCount,
} from "@/lib/image-request";
import { isNaiModelEnabled } from "@/lib/runtime-config";
import { registry } from "@/lib/adapters/registry";
import type { ImageGenerationRequest } from "@/lib/adapters/types";
import {
  fetchWithModelConcurrency,
} from "@/lib/model-concurrency";

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
 * 图包/个人 AFF 余额，无余额则透明代理回 NewAPI 按其分组通道计费。
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
};

export function bearerAuthorization(request: Request): string | Response {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return Response.json(
      {
        error: {
          message: "Missing or invalid Authorization: Bearer <NewAPI key>",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
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
    if (pathname.startsWith("/v1/images/")) {
      const identity = await requireIkunExternalIdentity(authorization);
      if (identity instanceof Response) return identity;
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
      signal: AbortSignal.timeout(120_000),
    });
    return forwardResponse(upstream);
  } catch (error) {
    return Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Upstream request failed",
          type: "api_error",
          code: "upstream_unavailable",
        },
      },
      { status: 502 },
    );
  }
}

function paymentResponse(response: Response, source: "package" | "personal" | "mixed" | "newapi"): Response {
  const headers = new Headers(response.headers);
  headers.set("X-LFN-Payment-Source", source);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function auditedResponse(
  response: Response,
  audit: Awaited<ReturnType<typeof startRequestAudit>>,
  patch: Parameters<Awaited<ReturnType<typeof startRequestAudit>>["finish"]>[0] = {},
): Promise<Response> {
  await audit.finish({ ...patch, status: response.status });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: audit.responseHeaders(response.headers),
  });
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
    const marked = await Promise.all(data.map(async (item) => {
      if (!isRecord(item) || typeof item.b64_json !== "string") return item;
      const input = `data:image/png;base64,${item.b64_json.replace(/^data:image\/[^;]+;base64,/, "")}`;
      const result = await watermarkImages([input], userId, model, {
        requestId: audit.requestId,
        requestFingerprint: audit.requestFingerprint,
        parameters: audit.record.parameters,
      });
      watermarkStatus = result.status;
      return { ...item, b64_json: result.images[0].replace(/^data:image\/[^;]+;base64,/, "") };
    }));
    const body = JSON.stringify(data.length ? { ...payload, data: marked } : payload);
    const headers = audit.responseHeaders(response.headers);
    headers.set("content-type", "application/json");
    await audit.finish({ status: response.status, watermarkStatus });
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
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
): Promise<Response> {
  const paymentSource = paymentSourceForCharge(charge);
  if (!response.ok) {
    await refundImageCredits(userId, charge, 0);
    return paymentResponse(response, paymentSource);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json"))
    return paymentResponse(response, paymentSource);
  try {
    const payload = (await response.clone().json()) as unknown;
    const generated = imageCountFromJson(payload);
    if (generated < charge.samples)
      await refundImageCredits(userId, charge, generated);
  } catch {
    await refundImageCredits(userId, charge, 0);
  }
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
  if (!(await isNaiModelEnabled(imageRequest.generation.model)))
    return Response.json({ error: { message: "该 NAI 模型已被管理员停用", code: "model_disabled" } }, { status: 403 });
  const rate = checkImageRateLimit(request, identity);
  if (!rate.allowed)
    return Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );

  let apiIdentity: Awaited<ReturnType<typeof requireIkunExternalIdentity>>;
  try {
    apiIdentity = await requireIkunExternalIdentity(authorization);
  } catch {
    return Response.json(
      {
        error: {
          message: "暂时无法连接账号服务，请稍后重试",
          type: "api_error",
          code: "lfn_account_service_unavailable",
        },
      },
      { status: 502 },
    );
  }
  if (apiIdentity instanceof Response) return apiIdentity;
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

  // 尝试从适配器获取图像服务
  const imageAdapter = await registry.getImageAdapter();
  const platformUpstream = await resolvedImageUpstream();
  if (!imageAdapter && !platformUpstream) {
    gatewayLogStart(
      externalLogMeta(maskKeyForLog(authorization), imageRequest, pathname),
    )(-1);
    return auditedResponse(await proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType), audit);
  }
  const userId = apiIdentity.userId;
  if (userId == null) {
    // key 无法归属站内用户：按设计退回透明代理，仅按 NewAPI 余额计费。
    gatewayLogStart(
      externalLogMeta(maskKeyForLog(authorization), imageRequest, pathname),
    )(-1);
    return auditedResponse(await proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType), audit);
  }

  const userRate = checkImageRateLimit(request, `user:${userId}`);
  if (!userRate.allowed)
    return Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(userRate.retryAfterSeconds) } },
    );

  let charge: ImageCreditCharge | null = null;
  let settled = false;
  try {
    charge = await trySpendImageCredits(userId, imageRequest.generation);
    if (!charge) {
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
            signal: AbortSignal.timeout(180_000),
          },
        ).catch((error: unknown) => {
          finishManagedLog(0);
          throw error;
        });
        finishManagedLog(managedUpstream.status);
        return auditedResponse(paymentResponse(forwardResponse(managedUpstream), "newapi"), audit, { paymentSource: "newapi" });
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
        
        // 解析原始请求体获取 prompt 等参数
        if (imageRequest.body && typeof imageRequest.body === "string") {
          try {
            const bodyJson = JSON.parse(imageRequest.body) as JsonRecord;
            adapterRequest.prompt = String(bodyJson.prompt || bodyJson.input || "");
            adapterRequest.negativePrompt = bodyJson.negative_prompt as string | undefined;
            adapterRequest.seed = bodyJson.seed as number | undefined;
          } catch {
            // 无法解析 body，使用默认值
          }
        }

        const result = await imageAdapter.generate(adapterRequest);

        settled = true;
        finishAdapterLog(200);

        // 转换为兼容格式
        const response = Response.json({
          data: result.images,
          usage: result.usage,
        });
        return watermarkJsonResponse(await settleExternalCharge(response, userId, charge), userId, imageRequest.generation.model, audit);
      } catch (error) {
        console.error("Adapter image generation failed, falling back:", error);
        finishAdapterLog(0);
        // 失败时回退到原始方式
      }
    }

    // 回退：使用环境变量配置的端点
    if (platformUpstream) {
      const headers = new Headers({
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
        signal: AbortSignal.timeout(180_000),
      }).catch((error: unknown) => {
        finishUpstreamLog(0);
        throw error;
      });
      finishUpstreamLog(upstream.status);
      settled = true;
      return watermarkJsonResponse(await settleExternalCharge(upstream, userId, charge), userId, imageRequest.generation.model, audit);
    }

    throw new Error("No image service available");
  } catch (error) {
    if (charge && !settled) await refundImageCredits(userId, charge, 0);
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
  const steps = normalizeSteps(parameters.steps ?? body.steps);
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
  return {
    ...rest,
    prompt: typeof body.input === "string" ? body.input : "",
    model: assertImageModel(modelAlias(body.model)),
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
  const contentType = upstream.headers.get("content-type") || "";
  if (!upstream.ok || !contentType.includes("application/json"))
    return forwardResponse(upstream);

  const result = (await upstream.json()) as JsonRecord;
  const data = Array.isArray(result.data) ? result.data : [];
  const images = data.flatMap((item) => {
    if (!isRecord(item) || typeof item.b64_json !== "string") return [];
    return [item.b64_json.replace(/^data:image\/[^;]+;base64,/, "")];
  });
  if (!images.length) {
    return Response.json(
      { message: "NewAPI returned no base64 image data" },
      { status: 502 },
    );
  }

  const archive = new JSZip();
  images.forEach((image, index) => {
    archive.file(`image_${index}.png`, image, { base64: true });
  });
  const zip = await archive.generateAsync({ type: "arraybuffer" });
  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Length": String(zip.byteLength),
    "Content-Disposition": 'attachment; filename="images.zip"',
    "X-LFN-Usage": encodeURIComponent(JSON.stringify(result.usage ?? null)),
  });
  const paymentSource = upstream.headers.get("x-lfn-payment-source");
  if (paymentSource) headers.set("X-LFN-Payment-Source", paymentSource);
  return new Response(zip, { headers });
}

export function unsupportedNaiOperation(request: Request, operation: string): Response {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  return Response.json(
    {
      message: `${operation} is recognized, but NewAPI has no auditable billing mapping for it`,
    },
    { status: 409 },
  );
}

const IMAGE_NATIVE_PREFIXES = [
  "/ai/generate-image",
  "/ai/generate-image-stream",
  "/ai/encode-vibe",
  "/ai/augment-image",
  "/ai/upscale",
];

function naiNativeError(message: string, status: number, code: string): Response {
  return Response.json(
    { message, error: { message, type: "invalid_request_error", code } },
    { status },
  );
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
  return Response.json({
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
  });
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
    return Response.json({ error: { message: "该 NAI 模型已被管理员停用", code: "model_disabled" } }, { status: 403 });
  const rate = checkImageRateLimit(request, identity);
  if (!rate.allowed)
    return Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );

  let apiIdentity: Awaited<ReturnType<typeof requireIkunExternalIdentity>>;
  try {
    apiIdentity = await requireIkunExternalIdentity(authorization);
  } catch {
    return Response.json(
      { error: { message: "暂时无法连接账号服务，请稍后重试", code: "lfn_account_service_unavailable" } },
      { status: 502 },
    );
  }
  if (apiIdentity instanceof Response) return apiIdentity;
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

  const preferImage = IMAGE_NATIVE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const nativeUpstream = preferImage
    ? (await resolvedNaiImageUpstream()) || (await resolvedNaiAccountUpstream())
    : (await resolvedNaiAccountUpstream()) || (await resolvedNaiImageUpstream());
  if (!nativeUpstream) {
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

  const userId = apiIdentity.userId;
  // 走 NewAPI 透明回退时实际到达 Gateway 的端点（可能映射为 /v1/images/*）。
  const fallbackEndpoint =
    newApiFallback && newApiFallback !== "unsupported"
      ? newApiFallback.pathname
      : pathname;
  if (userId == null) {
    // key 无法归属站内用户：按设计退回透明代理，仅按 NewAPI 余额计费。
    gatewayLogStart(
      externalLogMeta(maskKeyForLog(authorization), imageRequest, fallbackEndpoint),
    )(-1);
    return auditedResponse(await nativeNewApiFallback(request, pathname, imageRequest, newApiFallback), audit, { paymentSource: "newapi" });
  }

  const userRate = checkImageRateLimit(request, `user:${userId}`);
  if (!userRate.allowed)
    return Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(userRate.retryAfterSeconds) } },
    );

  let charge: ImageCreditCharge | null = null;
  let settled = false;
  try {
    charge = await trySpendImageCredits(userId, imageRequest.generation);
    if (!charge) {
      gatewayLogStart(
        externalLogMeta(logUser, imageRequest, fallbackEndpoint),
      )(-1);
      // 用户分组可能没有该模型的渠道（如 default 打 NAI 模型）：
      // 先取一把可用分组的托管密钥重试，取不到再用原 key 透传保留
      // 原始错误。
      const managedKey = await ensureManagedFallbackToken(
        userId,
        imageRequest.generation.model,
      ).catch(() => null);
      if (managedKey) {
        const managedHeaders = new Headers({
          Authorization: `Bearer sk-${managedKey}`,
          "Content-Type": imageRequest.contentType || "application/json",
        });
        const accept = request.headers.get("accept");
        if (accept) managedHeaders.set("Accept", accept);
        const target = newApiFallback && newApiFallback !== "unsupported"
          ? newApiFallback
          : { pathname, body: imageRequest.body, contentType: imageRequest.contentType };
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
            signal: AbortSignal.timeout(180_000),
          },
        ).catch((error: unknown) => {
          finishManagedLog(0);
          throw error;
        });
        finishManagedLog(managedUpstream.status);
        return auditedResponse(paymentResponse(forwardResponse(managedUpstream), "newapi"), audit, { paymentSource: "newapi" });
      }
      return auditedResponse(
        paymentResponse(await nativeNewApiFallback(request, pathname, imageRequest, newApiFallback), "newapi"),
        audit,
        { paymentSource: "newapi" },
      );
    }

    const headers = new Headers({
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
      signal: AbortSignal.timeout(180_000),
    }).catch((error: unknown) => {
      finishNativeLog(0);
      throw error;
    });
    finishNativeLog(upstream.status);
    settled = true;
    if (!upstream.ok) {
      await refundImageCredits(userId, charge, 0);
      return auditedResponse(paymentResponse(forwardResponse(upstream), paymentSourceForCharge(charge)), audit, { paymentSource: paymentSourceForCharge(charge) });
    }
    return auditedResponse(paymentResponse(forwardResponse(upstream), paymentSourceForCharge(charge)), audit, { paymentSource: paymentSourceForCharge(charge) });
  } catch (error) {
    if (charge && !settled) await refundImageCredits(userId, charge, 0);
    return Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "LFN 图像请求失败",
          type: "api_error",
          code: "lfn_image_upstream_error",
        },
      },
      { status: 502 },
    );
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
    return proxyNewApi(
      request,
      newApiFallback.pathname,
      newApiFallback.body,
      newApiFallback.contentType,
    );
  return proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType);
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!(requestPart instanceof File))
    throw new Error("multipart 请求缺少 request 部件");
  const json = JSON.parse(await requestPart.text()) as JsonRecord;
  const parts = new Map<string, string>();
  for (const [name, value] of form.entries()) {
    if (name === "request" || !(value instanceof File)) continue;
    parts.set(name, Buffer.from(await value.arrayBuffer()).toString("base64"));
  }
  if (parts.size) {
    const substituteIn = (container: JsonRecord): void => {
      for (const [key, value] of Object.entries(container)) {
        if (typeof value === "string") {
          if ((value === key || key === "data") && parts.has(value))
            container[key] = parts.get(value);
        } else if (Array.isArray(value)) {
          value.forEach((item) => {
            if (isRecord(item)) substituteIn(item);
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

function externalReferenceCount(body: JsonRecord): number {
  if (Array.isArray(body.reference_images)) {
    const count = body.reference_images.filter(
      (item) => typeof item === "string" && item.trim(),
    ).length;
    if (count) return count;
  }
  if (Array.isArray(body.reference_image_multiple)) {
    const count = body.reference_image_multiple.filter(
      (item) => typeof item === "string" && item.trim(),
    ).length;
    if (count) return count;
  }
  if (typeof body.reference_image === "string" && body.reference_image) return 1;
  if (Array.isArray(body.vibe)) return body.vibe.length;
  if (Array.isArray(body.references)) return body.references.length;
  if (Array.isArray(body.characters)) return body.characters.length;
  return 0;
}

export function externalGeneration(
  body: JsonRecord,
  operation = "generate",
): AffGeneration | null {
  const size = parseSize(body.size);
  let width: number;
  let height: number;
  let samples: number;
  let steps: number;
  let model: string;
  try {
    const rawWidth = parsePositiveInteger(body.width) ?? size?.width;
    const rawHeight = parsePositiveInteger(body.height) ?? size?.height;
    width = normalizeDimension(rawWidth, "width");
    height = normalizeDimension(rawHeight, "height");
    validateImageShape(width, height);
    samples = normalizeSamples(body);
    steps = normalizeSteps(body.steps);
    model = assertImageModel(modelAlias(body.model));
    validateReferenceCount(externalReferenceCount(body));
  } catch (error) {
    if (error instanceof ImageRequestValidationError) return null;
    return null;
  }
  return {
    model,
    width,
    height,
    steps,
    samples,
    strength: typeof body.strength === "number" ? body.strength : undefined,
    operation,
    referenceImageCount: externalReferenceCount(body),
    characterPromptCount: Array.isArray(body.characterPrompts)
      ? body.characterPrompts.length
      : 0,
  };
}

export function externalJsonBody(body: JsonRecord): BodyInit {
  return JSON.stringify(body);
}
