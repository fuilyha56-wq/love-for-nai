import {
  externalGeneration,
  externalJsonBody,
  imageOperationFromBody,
  imageReferenceCountFromBody,
  isNaiExternalModel,
  proxyImageWithCredits,
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
  } catch (error) {
    return withExternalCors(Response.json(
      { error: { message: error instanceof Error ? error.message : "Request body must be valid JSON" } },
      { status: 400 },
    ));
  }
  const operation = imageOperationFromBody(body);
  const generation = externalGeneration({
    ...body,
    operation,
    referenceImageCount: imageReferenceCountFromBody(body, operation),
  }, operation);
  if (!generation)
    return withExternalCors(Response.json(
      { error: { message: "model、size 和 n 必须是有效的图像生成参数" } },
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