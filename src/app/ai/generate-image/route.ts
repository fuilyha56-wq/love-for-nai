import {
  bearerAuthorization,
  externalGeneration,
  naiGenerationPayload,
  naiZipResponse,
  proxyImageWithCredits,
} from "@/lib/compat-api";

export async function POST(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;

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

  const payload = naiGenerationPayload(body);
  const generation = externalGeneration(payload);
  if (!generation)
    return Response.json({ message: "图像尺寸或张数参数无效" }, { status: 400 });
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