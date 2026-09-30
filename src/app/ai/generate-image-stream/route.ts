import {
  bearerAuthorization,
  externalGeneration,
  isRecord,
  naiGenerationPayload,
  parseNaiGenerationBody,
  proxyNaiNativeWithCredits,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";

export async function POST(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  try {
    assertBodySize(request);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "请求体过大" },
      { status: 413 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await parseNaiGenerationBody(request.clone());
  } catch {
    return Response.json(
      { message: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  if (typeof body.input !== "string" || !body.input.trim())
    return Response.json({ message: "input is required" }, { status: 400 });
  if (typeof body.model !== "string" || !body.model.trim())
    return Response.json({ message: "model is required" }, { status: 400 });

  const parameters = isRecord(body.parameters) ? body.parameters : {};
  const billingBody = {
    ...parameters,
    model: body.model,
    width: parameters.width ?? body.width,
    height: parameters.height ?? body.height,
    n: parameters.n ?? body.n,
    n_samples: parameters.n_samples ?? body.n_samples,
    steps: parameters.steps ?? body.steps,
    strength: parameters.strength ?? body.strength,
    reference_image_multiple: parameters.reference_image_multiple,
    reference_image: parameters.reference_image,
    vibe: parameters.vibe,
  };
  const nativeGeneration = externalGeneration(billingBody, "generate");
  let fallbackPayload: Record<string, unknown>;
  try {
    fallbackPayload = naiGenerationPayload(body);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "图像参数无效" },
      { status: 400 },
    );
  }
  const generation = nativeGeneration ?? externalGeneration(fallbackPayload);
  if (!generation)
    return Response.json({ message: "图像尺寸或张数参数无效" }, { status: 400 });

  const contentType = request.headers.get("content-type") || "application/json";
  const rawBody = await request.arrayBuffer();
  const proxyRequest = new Request(request.url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      Accept: request.headers.get("accept") || "application/x-msgpack",
    },
  });
  const response = await proxyNaiNativeWithCredits(
    proxyRequest,
    "/ai/generate-image-stream",
    {
      body: rawBody,
      contentType,
      generation,
    },
    {
      pathname: "/v1/images/generations",
      body: JSON.stringify(fallbackPayload),
      contentType: "application/json",
    },
  );
  return response;
}
