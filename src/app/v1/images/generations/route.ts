import {
  externalGeneration,
  externalJsonBody,
  imageRequestErrorBody,
  imageOperationFromBody,
  imageReferenceCountFromBody,
  isNaiExternalModel,
  normalizeExternalImageBody,
  proxyImageWithCredits,
  validateExternalMediumRequest,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";
import { externalCorsPreflight, withExternalCors } from "@/lib/external-cors";

export function OPTIONS(): Response {
  return externalCorsPreflight();
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json"))
    return withExternalCors(Response.json(
      { error: { message: "LFN 图像生成接口只接受 application/json" } },
      { status: 415 },
    ));
  let body: Record<string, unknown>;
  try {
    assertBodySize(request);
    body = (await request.clone().json()) as Record<string, unknown>;
    body = normalizeExternalImageBody(body, request.headers);
  } catch (error) {
    return withExternalCors(Response.json(
      { error: { message: error instanceof Error ? error.message : "Request body must be valid JSON" } },
      { status: 400 },
    ));
  }
  const operation = imageOperationFromBody(body);
  try {
    validateExternalMediumRequest(body, operation);
  } catch (error) {
    const detail = imageRequestErrorBody(error, "Medium 参数无效");
    return withExternalCors(Response.json(
      { error: { message: detail.message, type: "invalid_request_error", code: detail.code } },
      { status: 400 },
    ));
  }
  const generation = externalGeneration({
    ...body,
    operation,
    referenceImageCount: imageReferenceCountFromBody(body, operation),
  }, operation);
  if (!generation)
    return withExternalCors(Response.json(
      { error: { message: "model、size 和 n 必须是有效的图像生成参数", type: "invalid_request_error", code: "lfn_invalid_image_request" } },
      { status: 400 },
    ));
  const sanitized = isNaiExternalModel(generation.model)
    ? {
        ...body,
        model: generation.model,
        size: `${generation.width}x${generation.height}`,
        n: generation.samples,
        n_samples: generation.samples,
        steps: generation.steps,
        width: generation.width,
        height: generation.height,
        operation,
        novelai_operation: operation,
      }
    : body;
  return proxyImageWithCredits(request, "/v1/images/generations", {
    body: externalJsonBody(sanitized),
    contentType: "application/json",
    generation,
    prompt: typeof body.prompt === "string" ? body.prompt : undefined,
  });
}
