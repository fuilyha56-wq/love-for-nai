import {
  externalGeneration,
  externalJsonBody,
  proxyImageWithCredits,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json"))
    return Response.json(
      { error: { message: "LFN 图像生成接口只接受 application/json" } },
      { status: 415 },
    );
  let body: Record<string, unknown>;
  try {
    assertBodySize(request);
    body = (await request.clone().json()) as Record<string, unknown>;
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : "Request body must be valid JSON" } },
      { status: 400 },
    );
  }
  const generation = externalGeneration(body);
  if (!generation)
    return Response.json(
      { error: { message: "model、size 和 n 必须是有效的图像生成参数" } },
      { status: 400 },
    );
  const sanitized = {
    ...body,
    model: generation.model,
    size: `${generation.width}x${generation.height}`,
    n: generation.samples,
    n_samples: generation.samples,
    steps: generation.steps,
    width: generation.width,
    height: generation.height,
  };
  return proxyImageWithCredits(request, "/v1/images/generations", {
    body: externalJsonBody(sanitized),
    contentType: "application/json",
    generation,
  });
}