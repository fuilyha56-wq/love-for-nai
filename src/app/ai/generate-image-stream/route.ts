import {
  bearerAuthorization,
  nativeRequestHeaders,
  externalGeneration,
  imageRequestErrorBody,
  naiGenerationPayload,
  parseNaiGenerationBody,
  proxyNaiNativeWithCredits,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";
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
    body = await parseNaiGenerationBody(request.clone());
  } catch {
    return withExternalCors(Response.json(
      { message: "Request body must be valid JSON" },
      { status: 400 },
    ));
  }
  if (typeof body.input !== "string" || !body.input.trim())
    return withExternalCors(Response.json({ message: "input is required" }, { status: 400 }));
  if (typeof body.model !== "string" || !body.model.trim())
    return withExternalCors(Response.json({ message: "model is required" }, { status: 400 }));

  const nativeGeneration = externalGeneration(body);
  let fallbackPayload: Record<string, unknown>;
  try {
    fallbackPayload = naiGenerationPayload(body);
  } catch (error) {
    const detail = imageRequestErrorBody(error, "图像参数无效");
    return withExternalCors(Response.json(
      detail,
      { status: 400 },
    ));
  }
  const generation = nativeGeneration ?? externalGeneration(fallbackPayload);
  if (!generation)
    return withExternalCors(Response.json({ message: "图像尺寸或张数参数无效" }, { status: 400 }));

  const contentType = request.headers.get("content-type") || "application/json";
  const rawBody = await request.arrayBuffer();
  const proxyRequest = new Request(request.url, {
    method: "POST",
    headers: nativeRequestHeaders(request, authorization, request.headers.get("accept") || "application/x-msgpack"),
  });
  const response = await proxyNaiNativeWithCredits(
    proxyRequest,
    "/ai/generate-image-stream",
    {
      body: rawBody,
      contentType,
      generation,
      prompt: typeof body.input === "string" ? body.input : undefined,
    },
    {
      pathname: "/v1/images/generations",
      body: JSON.stringify(fallbackPayload),
      contentType: "application/json",
    },
  );
  return response;
}
