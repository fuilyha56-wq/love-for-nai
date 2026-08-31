import {
  externalGeneration,
  proxyImageWithCredits,
} from "@/lib/compat-api";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.clone().formData();
    const body: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        body[key] = await value.arrayBuffer();
      } else {
        body[key] = value;
      }
    }
    const generation = externalGeneration(body, "edits");
    if (!generation)
      return Response.json(
        { error: { message: "model、size 和 n 必须是有效的图像编辑参数" } },
        { status: 400 },
      );
    return proxyImageWithCredits(request, "/v1/images/edits", {
      body: await request.arrayBuffer(),
      contentType,
      generation,
    });
  }
  if (!contentType.includes("application/json"))
    return Response.json(
      { error: { message: "LFN 图像编辑接口只接受 JSON 或 multipart/form-data" } },
      { status: 415 },
    );
  let body: Record<string, unknown>;
  try {
    body = (await request.clone().json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: { message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }
  const generation = externalGeneration(body, "edits");
  if (!generation)
    return Response.json(
      { error: { message: "model、size 和 n 必须是有效的图像编辑参数" } },
      { status: 400 },
    );
  return proxyImageWithCredits(request, "/v1/images/edits", {
    body: await request.arrayBuffer(),
    contentType,
    generation,
  });
}