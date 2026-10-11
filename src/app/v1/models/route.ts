import { isRecord, proxyNewApi } from "@/lib/compat-api";
import { isNaiModelEnabled } from "@/lib/runtime-config";
import { isKnownImageModel } from "@/lib/image-model-capabilities";
import { externalCorsPreflight, withExternalCors } from "@/lib/external-cors";

export function OPTIONS(): Response {
  return externalCorsPreflight();
}

export async function GET(request: Request): Promise<Response> {
  const upstream = await proxyNewApi(request, "/v1/models");
  if (!upstream.ok) return withExternalCors(upstream);
  if (!(upstream.headers.get("content-type") || "").includes("application/json"))
    return withExternalCors(upstream);

  const result = (await upstream.json()) as Record<string, unknown>;
  if (!Array.isArray(result.data))
    return withExternalCors(Response.json(
      {
        error: {
          message: "NewAPI returned an unexpected model list",
          type: "api_error",
          code: "upstream_invalid_response",
        },
      },
      { status: 502 },
    ));
  const data: unknown[] = [];
  for (const model of result.data) {
    if (!isRecord(model) || typeof model.id !== "string") continue;
    const metadata = [model.type, model.kind, model.category, model.capabilities, model.modalities, model.supported_endpoint_types]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    const isImageModel = isKnownImageModel(model.id) || /(?:image|图像|绘图|图片|draw)/.test(metadata);
    if (isImageModel && (!model.id.startsWith("nai-") || await isNaiModelEnabled(model.id))) data.push(model);
  }
  return withExternalCors(Response.json({ ...result, data }));
}