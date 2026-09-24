import {
  bearerAuthorization,
  modelAlias,
  proxyNewApi,
  requireIkunExternalIdentity,
} from "@/lib/compat-api";
import { resolvedNaiImageUpstream } from "@/lib/newapi";
import { fetchWithModelConcurrency } from "@/lib/model-concurrency";

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
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  const identity = await requireIkunExternalIdentity(authorization).catch(() => null);
  if (!identity)
    return Response.json(
      { error: { message: "暂时无法连接账号服务，请稍后重试", code: "lfn_account_service_unavailable" } },
      { status: 502 },
    );
  if (identity instanceof Response) return identity;
  const native = await resolvedNaiImageUpstream();
  if (native) {
    const params = new URLSearchParams({
      prompt: prompt.trim(),
      model: String(model || "nai-diffusion-3"),
    });
    const upstream = await fetchWithModelConcurrency(
      `${native.baseUrl}/ai/generate-image/suggest-tags?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${native.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }
  return proxyNewApi(
    new Request(request.url, { method: "POST", headers: request.headers }),
    "/v1/images/suggest-tags",
    JSON.stringify({ prompt, model: modelAlias(model) }),
    "application/json",
  );
}