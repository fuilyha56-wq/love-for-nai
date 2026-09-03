import {
  externalGeneration,
  externalJsonBody,
  proxyImageWithCredits,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";

function badRequest(message: string): Response {
  return Response.json({ error: { message } }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  try {
    assertBodySize(request);
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : "请求体过大" } },
      { status: 413 },
    );
  }

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.clone().formData();
      const body: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        body[key] = value instanceof File ? await value.arrayBuffer() : value;
      }
      const generation = externalGeneration(body, "edits");
      if (!generation) return badRequest("model、size 和 n 必须是有效的图像编辑参数");

      const sanitized = new FormData();
      for (const [key, value] of form.entries()) {
        if (key === "novelai_operation" || key === "n" || key === "n_samples")
          continue;
        sanitized.append(key, value);
      }
      sanitized.set("model", generation.model);
      sanitized.set("size", `${generation.width}x${generation.height}`);
      sanitized.set("n", String(generation.samples));
      sanitized.set("n_samples", String(generation.samples));
      sanitized.set("novelai_operation", "edits");

      return proxyImageWithCredits(request, "/v1/images/edits", {
        body: sanitized,
        contentType: null,
        generation,
      });
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "图像编辑参数无效");
    }
  }

  if (!contentType.includes("application/json"))
    return Response.json(
      { error: { message: "LFN 图像编辑接口只接受 JSON 或 multipart/form-data" } },
      { status: 415 },
    );

  let body: Record<string, unknown>;
  try {
    body = (await request.clone().json()) as Record<string, unknown>;
    assertBodySize(request);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Request body must be valid JSON");
  }
  const generation = externalGeneration(body, "edits");
  if (!generation) return badRequest("model、size 和 n 必须是有效的图像编辑参数");
  const sanitized = {
    ...body,
    model: generation.model,
    size: `${generation.width}x${generation.height}`,
    n: generation.samples,
    n_samples: generation.samples,
    novelai_operation: "edits",
  };
  return proxyImageWithCredits(request, "/v1/images/edits", {
    body: externalJsonBody(sanitized),
    contentType: "application/json",
    generation,
  });
}
