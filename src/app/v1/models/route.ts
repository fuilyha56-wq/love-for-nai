import { isRecord, proxyNewApi } from "@/lib/compat-api";
import { isNaiModelEnabled } from "@/lib/runtime-config";

export async function GET(request: Request): Promise<Response> {
  const upstream = await proxyNewApi(request, "/v1/models");
  if (!upstream.ok) return upstream;
  if (!(upstream.headers.get("content-type") || "").includes("application/json"))
    return upstream;

  const result = (await upstream.json()) as Record<string, unknown>;
  if (!Array.isArray(result.data))
    return Response.json(
      {
        error: {
          message: "NewAPI returned an unexpected model list",
          type: "api_error",
          code: "upstream_invalid_response",
        },
      },
      { status: 502 },
    );
  const data: unknown[] = [];
  for (const model of result.data) {
    if (!isRecord(model) || typeof model.id !== "string" || !model.id.startsWith("nai-")) continue;
    if (await isNaiModelEnabled(model.id)) data.push(model);
  }
  return Response.json({ ...result, data });
}