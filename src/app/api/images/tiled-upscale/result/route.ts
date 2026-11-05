import { getSession } from "@/lib/session";
import type { TileUpscaleFactor } from "@/lib/image-tile-upscale";
import {
  assertTiledUpscaleResultComplete,
  createTiledUpscaleResult,
  openTiledUpscaleResult,
  saveTiledUpscaleResultTile,
  streamTiledUpscaleResult,
  TiledUpscaleResultError,
} from "@/lib/image-tile-upscale-result";

export const runtime = "nodejs";

const RESULT_UPLOAD_LIMIT = 8 * 1024 * 1024;
const UPLOAD_TYPES = new Set(["application/octet-stream", "image/png", "image/jpeg", "image/webp"]);
const NO_STORE = { "Cache-Control": "private, no-store" };

function failure(message: string, status: number) {
  return Response.json({ message }, { status, headers: NO_STORE });
}

function resultFailure(error: unknown) {
  if (error instanceof TiledUpscaleResultError) return failure(error.message, error.status);
  if (error instanceof RangeError) return failure(error.message, 400);
  return failure("暂时无法处理分块超分结果，请重试。", 500);
}

function mimeType(request: Request) {
  return request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() || "";
}

async function boundedBody(request: Request, maximum: number) {
  const tooLarge = () => new TiledUpscaleResultError("分块超分请求内容过大", 413);
  if (Number(request.headers.get("Content-Length")) > maximum) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new TiledUpscaleResultError("分块超分请求内容为空", 400);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return failure("请先登录后生成分块超分结果", 401);
  if (mimeType(request) !== "application/json") return failure("分块尺寸必须以 JSON 提交", 415);
  try {
    const bytes = await boundedBody(request, 1024);
    let dimensions: { width: number; height: number; scale: TileUpscaleFactor };
    try { dimensions = JSON.parse(bytes.toString("utf8")); }
    catch { return failure("分块尺寸不是有效的 JSON", 400); }
    if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) return failure("分块尺寸无效", 400);
    const { width, height, scale } = dimensions;
    const id = await createTiledUpscaleResult(session.userId, width, height, scale);
    return Response.json({ id }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return resultFailure(error);
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return failure("请先登录后保存分块超分结果", 401);
  if (!UPLOAD_TYPES.has(mimeType(request))) return failure("只接受 PNG、JPEG 或 WebP 分块图像", 415);
  const query = new URL(request.url).searchParams;
  const rawIndex = query.get("index") ?? "";
  if (!/^\d+$/.test(rawIndex)) return failure("图块编号无效", 400);
  try {
    const result = await openTiledUpscaleResult(session.userId, query.get("id") || "");
    const index = Number(rawIndex);
    if (!Number.isSafeInteger(index) || index >= result.layout.rows * result.layout.columns) return failure("图块编号无效", 400);
    await saveTiledUpscaleResultTile(result, index, await boundedBody(request, RESULT_UPLOAD_LIMIT));
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return resultFailure(error);
  }
}

async function downloadResult(request: Request, headersOnly: boolean) {
  const session = await getSession();
  if (!session) {
    return headersOnly ? new Response(null, { status: 401, headers: NO_STORE }) : failure("请先登录后下载分块超分结果", 401);
  }
  try {
    const result = await openTiledUpscaleResult(session.userId, new URL(request.url).searchParams.get("id") || "");
    await assertTiledUpscaleResultComplete(result);
    const { outputWidth, outputHeight } = result.layout;
    return new Response(headersOnly ? null : await streamTiledUpscaleResult(result, request.signal), {
      headers: {
        ...NO_STORE,
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="lfn-tiled-upscale-${outputWidth}x${outputHeight}.png"`,
      },
    });
  } catch (error) {
    const response = resultFailure(error);
    return headersOnly ? new Response(null, { status: response.status, headers: NO_STORE }) : response;
  }
}

export async function GET(request: Request) {
  return downloadResult(request, false);
}

export async function HEAD(request: Request) {
  return downloadResult(request, true);
}
