import { createEditorDocument, type EditorDocument, type RgbaImage, type TiledEditorSource } from "./image-editor";
import { createEditorDraft, IMAGE_EDITOR_MAX_PIXELS, saveEditorDraft } from "./image-editor-store";
import { loadImageStudioForm } from "./image-studio-form";

const SOURCE_ENDPOINT = "/api/images/tiled-upscale/source";
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const LOCAL_EDITOR_MAX_EDGE = 4096;
const TILED_PREVIEW_MAX_EDGE = 1200;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function needsTiledSource(width: number, height: number): boolean {
  return width * height > IMAGE_EDITOR_MAX_PIXELS || Math.max(width, height) > LOCAL_EDITOR_MAX_EDGE;
}

/** Older drafts and history nodes may contain the entire raster. Keep those pixels
 * as a sliceable local Blob and use a bounded image for the canvas and draft. */
export function prepareRestoredEditorDocument(document: EditorDocument): EditorDocument {
  const { width, height, data } = document.image;
  if (document.tiledSource || document.characterReference || !needsTiledSource(width, height)) return document;

  const ratio = TILED_PREVIEW_MAX_EDGE / Math.max(width, height);
  const previewWidth = Math.max(1, Math.round(width * ratio));
  const previewHeight = Math.max(1, Math.round(height * ratio));
  const preview = new Uint8ClampedArray(previewWidth * previewHeight * 4);
  for (let y = 0; y < previewHeight; y += 1) {
    const row = Math.floor((y + 0.5) * height / previewHeight) * width;
    for (let x = 0; x < previewWidth; x += 1) {
      const from = (row + Math.floor((x + 0.5) * width / previewWidth)) * 4;
      const to = (y * previewWidth + x) * 4;
      preview[to] = data[from];
      preview[to + 1] = data[from + 1];
      preview[to + 2] = data[from + 2];
      preview[to + 3] = data[from + 3];
    }
  }
  const bytes = data.buffer instanceof ArrayBuffer
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  return {
    ...document,
    image: { width: previewWidth, height: previewHeight, data: preview },
    worldRect: { ...document.worldRect, width: previewWidth, height: previewHeight },
    tiledSource: { width, height, rgba: new Blob([bytes]) },
  };
}

/** Read common image headers without making the browser decode the full raster. */
export async function readEditorSourceSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  const head = new DataView(await blob.slice(0, 30).arrayBuffer());
  if (head.byteLength >= 24 && head.getUint32(0) === 0x89504e47 && head.getUint32(12) === 0x49484452) {
    return { width: head.getUint32(16), height: head.getUint32(20) };
  }
  if (head.byteLength === 30 && head.getUint32(0) === 0x52494646 && head.getUint32(8) === 0x57454250) {
    const chunk = head.getUint32(12);
    if (chunk === 0x56503858) {
      const dimension = (offset: number) => 1 + head.getUint8(offset) + head.getUint8(offset + 1) * 256 + head.getUint8(offset + 2) * 65536;
      return { width: dimension(24), height: dimension(27) };
    }
    if (chunk === 0x5650384c && head.getUint8(20) === 0x2f) {
      const size = head.getUint32(21, true);
      return { width: 1 + (size & 0x3fff), height: 1 + ((size >>> 14) & 0x3fff) };
    }
    if (chunk === 0x56503820 && head.getUint8(23) === 0x9d && head.getUint16(24) === 0x012a) {
      return { width: head.getUint16(26, true) & 0x3fff, height: head.getUint16(28, true) & 0x3fff };
    }
  }
  if (head.byteLength < 2 || head.getUint16(0) !== 0xffd8) return null;
  const jpeg = new DataView(await blob.slice(0, 1024 * 1024).arrayBuffer());
  let offset = 2;
  while (offset + 4 <= jpeg.byteLength && jpeg.getUint8(offset++) === 0xff) {
    while (offset < jpeg.byteLength && jpeg.getUint8(offset) === 0xff) offset++;
    if (offset + 3 > jpeg.byteLength) break;
    const marker = jpeg.getUint8(offset++);
    if (marker === 0xda || marker === 0xd9) break;
    const length = jpeg.getUint16(offset);
    if (length < 2 || offset + length > jpeg.byteLength) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && length >= 7) {
      return { width: jpeg.getUint16(offset + 5), height: jpeg.getUint16(offset + 3) };
    }
    offset += length;
  }
  return null;
}

export async function checkEditorStorageResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  throw new Error(body?.message || body?.error || (response.status === 401 ? "请先登录后处理大图。" : `大图处理失败（HTTP ${response.status}）`));
}

type UploadedTiledSource = Extract<TiledEditorSource, { id: string }> & { preview: string };

async function uploadTiledSource(blob: Blob, signal?: AbortSignal): Promise<UploadedTiledSource> {
  const initialized = await checkEditorStorageResponse(await fetch(SOURCE_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bytes: blob.size }), signal,
  }));
  const { id } = await initialized.json() as { id: string };
  const url = `${SOURCE_ENDPOINT}?id=${encodeURIComponent(id)}`;
  try {
    for (let offset = 0; offset < blob.size; offset += UPLOAD_CHUNK_BYTES) {
      await checkEditorStorageResponse(await fetch(`${url}&offset=${offset}`, {
        method: "PUT", body: blob.slice(offset, offset + UPLOAD_CHUNK_BYTES), signal,
      }));
    }
    const finalized = await checkEditorStorageResponse(await fetch(url, { method: "POST", signal }));
    return await finalized.json() as UploadedTiledSource;
  } catch (error) {
    void fetch(url, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败，请重新上传。"));
    image.src = url;
  });
}

function readPixels(image: HTMLImageElement): RgbaImage {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器不支持 Canvas");
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } finally {
    canvas.width = 0;
  }
}

export async function readEditorSource(
  input: string | Blob,
  { allowLarge = true, signal }: { allowLarge?: boolean; signal?: AbortSignal } = {},
): Promise<{ image: RgbaImage; tiledSource?: TiledEditorSource }> {
  const blob = typeof input === "string" ? await (await fetch(input, { signal })).blob() : input;
  const size = await readEditorSourceSize(blob);
  const tiled = async () => {
    if (!allowLarge) throw new Error("大图请使用分块超分。");
    const { preview, ...tiledSource } = await uploadTiledSource(blob, signal);
    return { image: readPixels(await loadImage(preview)), tiledSource };
  };
  if (size && needsTiledSource(size.width, size.height)) return tiled();
  const url = URL.createObjectURL(blob);
  try {
    const decoded = await loadImage(url);
    return needsTiledSource(decoded.naturalWidth, decoded.naturalHeight) ? tiled() : { image: readPixels(decoded) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ImageEditorMode = "inpaint" | "canvas" | "tiled-upscale";

export async function createEditorUploadDraft(file: File, requestedMode: ImageEditorMode): Promise<{ draftId: string; mode: ImageEditorMode }> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
  const { image, tiledSource } = await readEditorSource(file);
  const mode = tiledSource ? "tiled-upscale" : requestedMode;
  const studio = loadImageStudioForm();
  const document = createEditorDocument(image, undefined, {
    tiledSource,
    prompt: studio.prompt,
    negativePrompt: studio.negative,
    seed: studio.seed || null,
    source: { name: file.name, mimeType: file.type },
    generation: {
      model: studio.model, providerId: studio.providerId, imageProtocol: studio.imageProtocol,
      quality: studio.imageQuality, imageSize: studio.imageResolution, background: studio.imageBackground,
      width: studio.width, height: studio.height, steps: studio.steps, scale: studio.scale,
      strength: studio.strength, sampler: studio.sampler, noiseSchedule: studio.schedule,
    },
  });
  const random = crypto.getRandomValues(new Uint32Array(2)).join("-");
  const draftId = `editor-${Date.now().toString(36)}-${random}`;
  await saveEditorDraft(createEditorDraft(draftId, mode === "inpaint" ? "inpaint" : "canvas", document));
  return { draftId, mode };
}
