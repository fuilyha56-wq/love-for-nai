import { isRecord, proxyNewApi } from "@/lib/compat-api";

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
  const data = result.data.filter(
    (model) =>
      isRecord(model) &&
      typeof model.id === "string" &&
      model.id.startsWith("nai-"),
  );
  return Response.json({ ...result, data });
}