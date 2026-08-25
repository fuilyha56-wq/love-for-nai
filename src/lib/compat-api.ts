import JSZip from "jszip";
import { newApiBaseUrl } from "@/lib/newapi";

const droppedResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const droppedRequestHeaders = new Set([
  ...droppedResponseHeaders,
  "content-length",
  "cookie",
  "host",
]);

type JsonRecord = Record<string, unknown>;

const novelAiModelAliases: Record<string, string> = {
  "nai-diffusion-4-5-full": "nai-v4.5-full",
  "nai-diffusion-4-5-curated": "nai-v4.5-curated",
  "nai-diffusion-4-5-full-inpainting": "nai-v4.5-inpaint",
  "nai-diffusion-4-full": "nai-v4-full",
  "nai-diffusion-4-curated-preview": "nai-v4-curated",
  "nai-diffusion-3": "nai-v3",
  "nai-diffusion-3-inpainting": "nai-v3-inpaint",
  "nai-diffusion-furry-3": "nai-v3-furry",
  "nai-diffusion-furry-3-inpainting": "nai-v3-furry-inpaint",
};

export function bearerAuthorization(request: Request): string | Response {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return Response.json(
      {
        error: {
          message: "Missing or invalid Authorization: Bearer <NewAPI key>",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  return authorization;
}

export async function proxyNewApi(
  request: Request,
  pathname: string,
  body?: BodyInit | null,
  contentType?: string | null,
): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;

  try {
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!droppedRequestHeaders.has(key.toLowerCase())) headers.set(key, value);
    });
    headers.set("Authorization", authorization);
    const requestContentType = contentType ?? request.headers.get("content-type");
    if (requestContentType) headers.set("Content-Type", requestContentType);
    const upstream = await fetch(`${newApiBaseUrl()}${pathname}`, {
      method: request.method,
      headers,
      body: body === undefined && request.method !== "GET" ? await request.arrayBuffer() : body,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    return forwardResponse(upstream);
  } catch (error) {
    return Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Upstream request failed",
          type: "api_error",
          code: "upstream_unavailable",
        },
      },
      { status: 502 },
    );
  }
}

export function forwardResponse(upstream: Response): Response {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!droppedResponseHeaders.has(key.toLowerCase())) headers.set(key, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export function naiGenerationPayload(body: JsonRecord): JsonRecord {
  const parameters = isRecord(body.parameters) ? body.parameters : {};
  const width = positiveInteger(parameters.width);
  const height = positiveInteger(parameters.height);
  const samples = positiveInteger(parameters.n_samples) ?? 1;
  const action =
    typeof body.action === "string" ? body.action.toLowerCase() : "generate";
  const operation =
    action === "img2img"
      ? "img2img"
      : action === "infill"
        ? "inpainting"
        : undefined;
  const rest = { ...parameters };
  delete rest.n_samples;
  return {
    ...rest,
    prompt: typeof body.input === "string" ? body.input : "",
    model: modelAlias(body.model),
    n_samples: samples,
    ...(width && height ? { size: `${width}x${height}` } : {}),
    response_format: "b64_json",
    ...(operation ? { novelai_operation: operation } : {}),
  };
}

export async function naiZipResponse(upstream: Response): Promise<Response> {
  const contentType = upstream.headers.get("content-type") || "";
  if (!upstream.ok || !contentType.includes("application/json"))
    return forwardResponse(upstream);

  const result = (await upstream.json()) as JsonRecord;
  const data = Array.isArray(result.data) ? result.data : [];
  const images = data.flatMap((item) => {
    if (!isRecord(item) || typeof item.b64_json !== "string") return [];
    return [item.b64_json.replace(/^data:image\/[^;]+;base64,/, "")];
  });
  if (!images.length) {
    return Response.json(
      { message: "NewAPI returned no base64 image data" },
      { status: 502 },
    );
  }

  const archive = new JSZip();
  images.forEach((image, index) => {
    archive.file(`image_${index}.png`, image, { base64: true });
  });
  const zip = await archive.generateAsync({ type: "arraybuffer" });
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.byteLength),
      "Content-Disposition": 'attachment; filename="images.zip"',
      "X-LFN-Usage": encodeURIComponent(JSON.stringify(result.usage ?? null)),
    },
  });
}

export function unsupportedNaiOperation(request: Request, operation: string): Response {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  return Response.json(
    {
      message: `${operation} is recognized, but NewAPI has no auditable billing mapping for it`,
    },
    { status: 409 },
  );
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function modelAlias(model: unknown): unknown {
  return typeof model === "string" ? novelAiModelAliases[model] || model : model;
}