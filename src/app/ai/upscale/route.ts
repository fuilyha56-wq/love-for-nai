import {
  bearerAuthorization,
  proxyNaiNativeWithCredits,
  unsupportedNaiOperation,
} from "@/lib/compat-api";
import { assertBodySize } from "@/lib/image-request";
import { UPSCALE_MAX_PIXELS, UPSCALE_MODELS, upscaleAnlasCost } from "@/lib/image-pricing";
import { resolvedNaiImageUpstream } from "@/lib/newapi";
import { pngDimensions, stripDataUrl } from "@/lib/png-dims";

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
  if (!nativeUpstream) return unsupportedNaiOperation(request, "upscale");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ message: "Request body must be valid JSON" }, { status: 400 });
  }
  if (typeof body.image !== "string" || !body.image)
    return Response.json({ message: "image is required" }, { status: 400 });

  const image = stripDataUrl(body.image);
  const dims = pngDimensions(image);
  if (!dims)
    return Response.json(
      { message: "image 必须是 base64 编码的 PNG（超分不接受 JPEG/WEBP）" },
      { status: 400 },
    );
  if (dims.width * dims.height > UPSCALE_MAX_PIXELS)
    return Response.json(
      {
        message: `图片超出超分上限：${dims.width * dims.height} 像素，最大 ${UPSCALE_MAX_PIXELS}（1536x2048）`,
      },
      { status: 400 },
    );

  const model =
    typeof body.model === "string" && body.model ? body.model : "nai-diffusion-5-curated";
  if (!UPSCALE_MODELS.has(model))
    return Response.json(
      {
        message: `Invalid model '${model}'. Standalone upscaling supports: ${[...UPSCALE_MODELS].sort()}`,
      },
      { status: 400 },
    );

  const payload: Record<string, unknown> = { image, model, declared_blur_sigma: 0 };
  if (typeof body.declared_blur_sigma === "number" && Number.isFinite(body.declared_blur_sigma))
    payload.declared_blur_sigma = Math.max(0, Math.floor(body.declared_blur_sigma));

  // 先在入口把费用档位算干净：面积非法/超限在这里返回 400，
  // 而不是等 trySpendImageCredits 内部抛错变成 502。
  try {
    upscaleAnlasCost(dims.width, dims.height);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "超分参数无效" },
      { status: 400 },
    );
  }

  return proxyNaiNativeWithCredits(
    new Request(request.url, {
      method: "POST",
      headers: { Authorization: authorization },
    }),
    "/ai/upscale",
    {
      body: JSON.stringify(payload),
      contentType: "application/json",
      generation: {
        model,
        width: dims.width,
        height: dims.height,
        steps: 1,
        samples: 1,
        operation: "upscale",
      },
    },
    "unsupported",
  );
}
