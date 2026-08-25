import { isRecord, proxyNewApi } from "@/lib/compat-api";

export async function GET(request: Request): Promise<Response> {
  const upstream = await proxyNewApi(request, "/v1/models");
  if (!upstream.ok) return upstream;
  const result = (await upstream.json()) as Record<string, unknown>;
  const data = Array.isArray(result.data)
    ? result.data.filter(
        (model) =>
          isRecord(model) &&
          typeof model.id === "string" &&
          model.id.startsWith("nai-"),
      )
    : [];
  return Response.json({ ...result, data });
}