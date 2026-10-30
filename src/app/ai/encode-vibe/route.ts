import {
  bearerAuthorization,
  isRecord,
  nativeRequestHeaders,
  proxyNaiNativeWithCredits,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";
import { naiUpstreamModel, naiUsageModel } from "@/lib/nai-native-request";
import { externalCorsPreflight, withExternalCors } from "@/lib/external-cors";

export function OPTIONS(): Response {
  return externalCorsPreflight();
}

export async function POST(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  try {
    assertBodySize(request);
  } catch (error) {
    return withExternalCors(Response.json(
      { message: error instanceof Error ? error.message : "请求体过大" },
      { status: 413 },
    ));
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    if (!isRecord(body)) throw new Error("Invalid object");
  } catch {
    return withExternalCors(Response.json({ message: "Request body must be valid JSON" }, { status: 400 }));
  }
  if (Array.isArray(body.images)) {
    if (body.images.length !== 1 || typeof body.images[0] !== "string" || !body.images[0])
      return withExternalCors(Response.json({ message: "Vibe 编码每次仅支持一张图片" }, { status: 400 }));
    if (!body.image) body.image = body.images[0];
    delete body.images;
  }
  if (typeof body.image !== "string" || !body.image)
    return withExternalCors(Response.json({ message: "image is required" }, { status: 400 }));

  const model = naiUsageModel(typeof body.model === "string" ? body.model : "nai-v4.5-full");

  return proxyNaiNativeWithCredits(
    new Request(request.url, {
      method: "POST",
      headers: nativeRequestHeaders(request, authorization),
      signal: request.signal,
    }),
    "/ai/encode-vibe",
    {
      body: JSON.stringify(body),
      contentType: "application/json",
      generation: {
        model,
        width: 512,
        height: 512,
        steps: 1,
        samples: 1,
        operation: "encode-vibe",
        referenceImageCount: 1,
      },
    },
    {
      pathname: "/v1/images/generations",
      body: JSON.stringify({ ...body, model: naiUpstreamModel(model), prompt: "", novelai_operation: "encode-vibe", response_format: "b64_json" }),
      contentType: "application/json",
    },
  );
}
