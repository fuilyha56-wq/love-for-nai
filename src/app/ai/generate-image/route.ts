import {
  bearerAuthorization,
  externalGeneration,
  imageOperationFromBody,
  imageRequestErrorBody,
  isRecord,
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
    body = await parseNaiGenerationBody(request);
  } catch {
    return withExternalCors(Response.json({ message: "Request body must be valid JSON" }, { status: 400 }));
  }
  if (typeof body.input !== "string" || !body.input.trim())
    return withExternalCors(Response.json({ message: "input is required" }, { status: 400 }));
  if (typeof body.model !== "string" || !body.model.trim())
    return withExternalCors(Response.json({ message: "model is required" }, { status: 400 }));

  const parameters =
    body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
      ? (body.parameters as Record<string, unknown>)
      : {};
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
          : request.headers.get("accept") || "application/zip",
      },
    });
    const native = await proxyNaiNativeWithCredits(
      proxyRequest,
      nativePath,
      {
        body: JSON.stringify(nativeBody),
        contentType: "application/json",
        generation,
        prompt: typeof body.input === "string" ? body.input : undefined,
      },
      {
        pathname: "/v1/images/generations",
        body: JSON.stringify(payload),
        contentType: "application/json",
      },
    );
    // 原生 Gateway 的响应保持协议、字节和响应头透传；只有没有原生上游时，
    // 下方的 OpenAI 回退结果才需要转换成 Launcher 能识别的 ZIP。
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
      prompt: typeof body.input === "string" ? body.input : undefined,
    },
  );
  return naiZipResponse(upstream);
}