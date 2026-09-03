/**
 * 适配器系统兼容层
 * 将现有 compat-api 逻辑迁移到适配器系统，保持 API 向后兼容
 */

import JSZip from "jszip";
import {
  refundImageCredits,
  trySpendImageCredits,
  type AffGeneration,
  type ImageCreditCharge,
} from "@/lib/aff";
import { resolveExternalApiUser } from "@/lib/newapi-db";
import { resolvedAffGateway, resolvedNewApiBaseUrl } from "@/lib/newapi";
import { resolvedGenericImageProvider } from "@/lib/platform";
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
import { registry } from "@/lib/adapters/registry";
import type { ImageGenerationRequest } from "@/lib/adapters/types";

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

const novelAiModelAliases: Record<string, string> = {
  "nai-diffusion-4-5-full": "nai-v4.5-full",
  "nai-diffusion-4-5-curated": "nai-v4.5-curated",
  "nai-diffusion-4-5-full-inpainting": "nai-v4.5-inpaint",
  "nai-diffusion-5": "nai-v5-full",
  "nai-diffusion-5-curated": "nai-v5-curated",
  "nai-diffusion-5-full": "nai-v5-full",
  "nai-diffusion-5-inpainting": "nai-v5-inpaint",
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
    const upstream = await fetch(`${await resolvedNewApiBaseUrl()}${pathname}`, {
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
  const rate = checkImageRateLimit(request, identity);
  if (!rate.allowed)
    return Response.json(
      { error: { message: "图像请求过于频繁，请稍后重试", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );

  // 尝试从适配器获取图像服务
  const imageAdapter = await registry.getImageAdapter();
  
  // 向后兼容：如果没有适配器，使用环境变量配置
  const platformUpstream = (await resolvedAffGateway()) || (await resolvedGenericImageProvider());
  if (!imageAdapter && !platformUpstream) {
    return proxyNewApi(request, pathname, imageRequest.body, imageRequest.contentType);
  }

  let userId: number | null;
  try {
    userId = await resolveExternalApiUser(authorization);
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
  if (userId == null)
    return paymentResponse(
      await proxyNewApi(
        request,
        pathname,
        imageRequest.body,
        imageRequest.contentType,
      ),
      "newapi",
    );

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
    if (!charge)
      return paymentResponse(
        await proxyNewApi(
          request,
          pathname,
          imageRequest.body,
          imageRequest.contentType,
        ),
        "newapi",
      );

    // 使用适配器生成图像
    if (imageAdapter) {
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

        const token = authorization.replace(/^Bearer\s+/i, "");
        const result = await imageAdapter.generate(adapterRequest, token);
        
        settled = true;
        
        // 转换为兼容格式
        const response = Response.json({
          data: result.images,
          usage: result.usage,
        });
        return settleExternalCharge(response, userId, charge);
      } catch (error) {
        console.error("Adapter image generation failed, falling back:", error);
        // 失败时回退到原始方式
      }
    }

    // 回退：使用环境变量配置的端点
    if (platformUpstream) {
      const headers = new Headers({
        Authorization: `Bearer ${platformUpstream.token}`,
        ...(imageRequest.contentType ? { "Content-Type": imageRequest.contentType } : {}),
      });
      const upstream = await fetch(`${platformUpstream.baseUrl}${pathname}`, {
        method: request.method,
        headers,
        body: imageRequest.body,
        cache: "no-store",
        signal: AbortSignal.timeout(180_000),
      });
      settled = true;
      return settleExternalCharge(upstream, userId, charge);
    }

    throw new Error("No image service available");
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

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (typeof body.reference_image === "string" && body.reference_image) return 1;
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
