import { getSession } from "@/lib/session";
import { proxyNaiNativeWithCredits } from "@/lib/compat-api";
import { assertImageModel } from "@/lib/image-request";
import { naiUpstreamModel, naiUsageModel } from "@/lib/nai-native-request";
import { resolveImageModelCapabilities } from "@/lib/image-model-capabilities";

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: { message: "请先登录后再预处理参考图。" } }, { status: 401 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: { message: "缺少参考图。" } }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 24 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: { message: "参考图请求不能超过 24 MB。" } }, { status: 413 }); } chunks.push(value); }
  } catch { return Response.json({ error: { message: "参考图上传已中断。" } }, { status: 400 }); }
  finally { reader.releaseLock(); }
  let body: Record<string, unknown>;
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } body = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return Response.json({ error: { message: "请求格式不正确。" } }, { status: 400 }); }
  let model: string;
  try { model = assertImageModel(body.model); } catch { return Response.json({ error: { message: "请选择支持风格参考的 NAI 模型。" } }, { status: 400 }); }
  if (!resolveImageModelCapabilities(model).vibe) return Response.json({ error: { message: "此模型不支持风格预处理。" } }, { status: 400 });
  if (typeof body.image !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) return Response.json({ error: { message: "请选择 PNG、JPEG 或 WebP 参考图。" } }, { status: 400 });
  const information = body.information_extracted;
  if (typeof information !== "number" || !Number.isFinite(information) || information < 0 || information > 1) return Response.json({ error: { message: "信息提取值应介于 0 和 1。" } }, { status: 400 });
  return proxyNaiNativeWithCredits(request, "/ai/encode-vibe", {
    body: JSON.stringify({ model: naiUpstreamModel(model), image: body.image.replace(/^data:[^,]+,/, ""), information_extracted: information }), contentType: "application/json",
    generation: { model: naiUsageModel(model), width: 512, height: 512, steps: 1, samples: 1, operation: "encode-vibe", referenceImageCount: 1 },
  }, "unsupported", { userId: session.userId, username: session.username });
}
