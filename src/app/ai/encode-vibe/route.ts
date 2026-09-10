import {
  bearerAuthorization,
  proxyNaiNativeWithCredits,
  unsupportedNaiOperation,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";
import { resolvedNaiImageUpstream } from "@/lib/newapi";

export async function POST(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (authorization instanceof Response) return authorization;
  try {
    assertBodySize(request);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "请求体过大" },
      { status: 413 },
    );
  }

  const nativeUpstream = await resolvedNaiImageUpstream();
  if (!nativeUpstream) return unsupportedNaiOperation(request, "encode-vibe");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ message: "Request body must be valid JSON" }, { status: 400 });
  }
  const imageCount = Array.isArray(body.images)
    ? body.images.filter((item) => typeof item === "string" && item).length
    : typeof body.image === "string" && body.image
      ? 1
      : 0;
  if (!imageCount)
    return Response.json({ message: "image is required" }, { status: 400 });

  return proxyNaiNativeWithCredits(
    new Request(request.url, {
      method: "POST",
      headers: { Authorization: authorization },
    }),
    "/ai/encode-vibe",
    {
      body: JSON.stringify(body),
      contentType: "application/json",
      generation: {
        model: typeof body.model === "string" ? body.model : "nai-v4.5-full",
        width: 512,
        height: 512,
        steps: 1,
        samples: 1,
        operation: "encode-vibe",
        referenceImageCount: imageCount,
      },
    },
    "unsupported",
  );
}
