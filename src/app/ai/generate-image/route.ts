import {
  bearerAuthorization,
  nativeRequestHeaders,
  externalGeneration,
  imageOperationFromBody,
  imageRequestErrorBody,
  naiGenerationPayload,
  naiZipResponse,
  parseNaiGenerationBody,
  proxyImageWithCredits,
  proxyNaiNativeWithCredits,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";
import { resolvedNaiImageUpstream } from "@/lib/newapi";
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
    return withExternalCors(Response.json({ message: error instanceof Error ? error.message : "请求体过大" }, { status: 413 }));
  }

  let body: Record<string, unknown>;
  try {
    body = await parseNaiGenerationBody(request.clone());
  } catch {
    return withExternalCors(Response.json({ message: "Request body must be valid JSON" }, { status: 400 }));
  }
  if (typeof body.input !== "string" || !body.input.trim())
    return withExternalCors(Response.json({ message: "input is required" }, { status: 400 }));
  if (typeof body.model !== "string" || !body.model.trim())
    return withExternalCors(Response.json({ message: "model is required" }, { status: 400 }));

  const billingOperation = imageOperationFromBody(body);
  const nativeGeneration = externalGeneration(body, billingOperation);
  let payload: Record<string, unknown>;
  try {
    payload = naiGenerationPayload(body);
  } catch (error) {
    const detail = imageRequestErrorBody(error, "图像参数无效");
    return withExternalCors(Response.json(
      detail,
      { status: 400 },
    ));
  }
  const generation = nativeGeneration ?? externalGeneration(payload);
  if (!generation)
    return withExternalCors(Response.json({ message: "图像尺寸或张数参数无效" }, { status: 400 }));

  const nativeUpstream = await resolvedNaiImageUpstream();
  if (nativeUpstream) {
    // NovelAI exposes separate ZIP and streaming endpoints. Some clients send
    // parameters.stream on this ZIP endpoint while still decoding a ZIP;
    // forwarding that field must not silently select a different endpoint.
    // Parse a clone for billing, then preserve the original JSON/multipart body.
    const contentType = request.headers.get("content-type") || "application/json";
    const rawBody = await request.arrayBuffer();
    const proxyRequest = new Request(request.url, {
      method: "POST",
      headers: nativeRequestHeaders(request, authorization, request.headers.get("accept") || "application/zip"),
    });
    const native = await proxyNaiNativeWithCredits(
      proxyRequest,
      "/ai/generate-image",
      {
        body: rawBody,
        contentType,
        generation,
        prompt: typeof body.input === "string" ? body.input : undefined,
      },
      {
        pathname: "/v1/images/generations",
        body: JSON.stringify(payload),
        contentType: "application/json",
      },
    );
    // The proxy already normalizes native and NewAPI fallback envelopes before
    // settlement. Avoid loading the ZIP a second time at the public route.
    return native;
  }
  const proxyRequest = new Request(request.url, {
    method: "POST",
    headers: nativeRequestHeaders(request, authorization),
  });
  const upstream = await proxyImageWithCredits(
    proxyRequest,
    "/v1/images/generations",
    {
      body: JSON.stringify(payload),
      contentType: "application/json",
      generation,
      prompt: typeof body.input === "string" ? body.input : undefined,
    },
  );
  return naiZipResponse(upstream);
}
