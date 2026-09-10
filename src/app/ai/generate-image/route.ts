import {
  bearerAuthorization,
  externalGeneration,
  isRecord,
  naiGenerationPayload,
  naiZipResponse,
  proxyImageWithCredits,
  proxyNaiNativeWithCredits,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";
import { resolvedNaiImageUpstream } from "@/lib/newapi";

export async function POST(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  try {
    assertBodySize(request);
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "请求体过大" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ message: "Request body must be valid JSON" }, { status: 400 });
  }
  if (typeof body.input !== "string" || !body.input.trim())
    return Response.json({ message: "input is required" }, { status: 400 });
  if (typeof body.model !== "string" || !body.model.trim())
    return Response.json({ message: "model is required" }, { status: 400 });

  const parameters =
    body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
      ? (body.parameters as Record<string, unknown>)
      : {};
  const action = typeof body.action === "string" ? body.action.toLowerCase() : "generate";
  const operation =
    action === "img2img" ? "img2img" : action === "infill" ? "inpainting" : "generate";
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
  const nativeGeneration = externalGeneration(billingBody, operation);
  let payload: Record<string, unknown>;
  try {
    payload = naiGenerationPayload(body);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "图像参数无效" },
      { status: 400 },
    );
  }
  const generation = nativeGeneration ?? externalGeneration(payload);
  if (!generation)
    return Response.json({ message: "图像尺寸或张数参数无效" }, { status: 400 });

  const nativeUpstream = await resolvedNaiImageUpstream();
  const wantsStream =
    (isRecord(parameters) && parameters.stream === "msgpack") ||
    request.headers.get("accept")?.includes("msgpack") ||
    request.url.includes("generate-image-stream");
  if (nativeUpstream) {
    const nativePath = wantsStream ? "/ai/generate-image-stream" : "/ai/generate-image";
    const nativeBody = wantsStream
      ? {
          ...body,
          parameters: { ...parameters, stream: "msgpack" },
        }
      : body;
    const proxyRequest = new Request(request.url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        Accept: wantsStream
          ? "application/x-msgpack"
          : request.headers.get("accept") || "",
      },
    });
    const native = await proxyNaiNativeWithCredits(
      proxyRequest,
      nativePath,
      {
        body: JSON.stringify(nativeBody),
        contentType: "application/json",
        generation,
      },
      {
        pathname: "/v1/images/generations",
        body: JSON.stringify(payload),
        contentType: "application/json",
      },
    );
    if ((native.headers.get("content-type") || "").includes("application/json"))
      return naiZipResponse(native);
    return native;
  }
  const proxyRequest = new Request(request.url, {
    method: "POST",
    headers: { Authorization: authorization },
  });
  const upstream = await proxyImageWithCredits(
    proxyRequest,
    "/v1/images/generations",
    {
      body: JSON.stringify(payload),
      contentType: "application/json",
      generation,
    },
  );
  return naiZipResponse(upstream);
}