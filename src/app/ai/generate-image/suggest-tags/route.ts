import {
  bearerAuthorization,
  modelAlias,
  proxyNewApi,
} from "@/lib/compat-api";

export async function GET(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  const url = new URL(request.url);
  return suggestTags(
    request,
    url.searchParams.get("prompt") || "",
    url.searchParams.get("model") || "nai-diffusion-3",
  );
}

export async function POST(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ message: "Request body must be valid JSON" }, { status: 400 });
  }
  return suggestTags(request, body.prompt, body.model ?? "nai-diffusion-3");
}

async function suggestTags(
  request: Request,
  prompt: unknown,
  model: unknown,
): Promise<Response> {
  if (typeof prompt !== "string" || !prompt.trim())
    return Response.json({ message: "prompt is required" }, { status: 400 });
  return proxyNewApi(
    new Request(request.url, { method: "POST", headers: request.headers }),
    "/v1/images/suggest-tags",
    JSON.stringify({ prompt, model: modelAlias(model) }),
    "application/json",
  );
}