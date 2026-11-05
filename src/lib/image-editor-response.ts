import { dataUrlToBlob } from "./local-image-history";
import { TileStreamEndedWithoutImageError } from "./image-tile-upscale-requests";

type ImageResponse = {
  image?: unknown;
  images?: unknown;
  message?: unknown;
  code?: unknown;
  error?: { message?: unknown; code?: unknown } | null;
};

const STREAM_WITHOUT_IMAGE_MESSAGES = new Set([
  "流式接口未返回最终图像",
  "流式响应未返回最终图像",
  "流式响应没有返回图像",
  "上游未返回最终图片",
  "上游流未返回最终图片",
  "上游流未返回全部最终图片",
]);

function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

function readImage(payload: ImageResponse | null | undefined): string | undefined {
  const image = Array.isArray(payload?.images) ? payload.images.find(isImageDataUrl) : undefined;
  return image ?? (isImageDataUrl(payload?.image) ? payload.image : undefined);
}

function generationError(payload: ImageResponse | null | undefined, fallback: string, successfulStream = false): Error {
  const message = [payload?.message, payload?.error?.message]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? fallback;
  const code = payload?.code ?? payload?.error?.code;
  return successfulStream && code !== "lfn_image_watermark_failed" && STREAM_WITHOUT_IMAGE_MESSAGES.has(message.trim().replace(/[。.!！]+$/, ""))
    ? new TileStreamEndedWithoutImageError(message)
    : new Error(message);
}

async function readEditorImageStream(response: Response): Promise<string> {
  const canRetryMissingImage = response.ok && response.headers.get("X-LFN-Watermark") !== "failed";
  let image: string | undefined;
  let streamError: Error | undefined;
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let leftover = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        leftover += decoder.decode(value, { stream: !done });
        const blocks = leftover.split(/\r?\n\r?\n/);
        leftover = done ? "" : blocks.pop() ?? "";
        for (const block of blocks) {
          const event = block.match(/^event:[ \t]*([^\r\n]+)/m)?.[1].trim();
          if (event !== "final" && event !== "done" && event !== "error") continue;
          const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5)).join("\n");
          let payload: ImageResponse | null;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }
          if (event === "error") streamError = generationError(payload, "流式生成失败", canRetryMissingImage);
          else image = readImage(payload) ?? image;
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }
  if (streamError) throw streamError;
  if (!response.ok) throw new Error(`图像生成失败（HTTP ${response.status}）`);
  if (!image) {
    if (canRetryMissingImage) throw new TileStreamEndedWithoutImageError();
    throw new Error("流式响应未返回最终图像");
  }
  return image;
}

export async function readEditorGenerationResponse(response: Response): Promise<string> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) return readEditorImageStream(response);
  const payload = await response.json().catch(() => null) as ImageResponse | null;
  if (!response.ok) throw generationError(payload, `图像生成失败（HTTP ${response.status}）`);
  const image = readImage(payload);
  if (!image) throw generationError(payload, "生成结果为空");
  return image;
}

export async function readEditorUpscaleTile(response: Response): Promise<Blob> {
  const blob = await dataUrlToBlob(await readEditorGenerationResponse(response));
  // Check that the tile can be stitched before saving it as a completed request.
  if (typeof createImageBitmap !== "function") throw new Error("当前浏览器不支持解码分块图像");
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
  return blob;
}
