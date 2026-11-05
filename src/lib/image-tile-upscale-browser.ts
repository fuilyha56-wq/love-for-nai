import type { EditorDocument, RgbaImage } from "./image-editor";
import { checkEditorStorageResponse, needsTiledSource } from "./image-editor-source";
import { TILE_UPSCALE_EDGE, type ImageUpscalePlan, type ImageUpscaleTile } from "./image-tile-upscale";
import { decodeCachedUpscaleTile } from "./image-tile-upscale-requests";

const SOURCE_ENDPOINT = "/api/images/tiled-upscale/source";
const RESULT_ENDPOINT = "/api/images/tiled-upscale/result";
const PREVIEW_MAX_EDGE = 1200;

export type TiledResultArchive = { id: string; preview: HTMLCanvasElement };

function canvasWithSize(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  context.imageSmoothingQuality = "high";
  return { canvas, context };
}

function localTileInput(image: RgbaImage, tile: ImageUpscaleTile): string {
  const { sourceX, sourceY, sourceWidth, sourceHeight, inputX, inputY, inputWidth, inputHeight } = tile;
  const { canvas: crop, context: cropContext } = canvasWithSize(sourceWidth, sourceHeight);
  const { canvas, context } = canvasWithSize(TILE_UPSCALE_EDGE, TILE_UPSCALE_EDGE);
  try {
    const pixels = cropContext.createImageData(sourceWidth, sourceHeight);
    for (let row = 0; row < sourceHeight; row += 1) {
      const start = ((sourceY + row) * image.width + sourceX) * 4;
      pixels.data.set(image.data.subarray(start, start + sourceWidth * 4), row * sourceWidth * 4);
    }
    cropContext.putImageData(pixels, 0, 0);
    context.drawImage(crop, inputX, inputY, inputWidth, inputHeight);
    const right = inputX + inputWidth;
    const bottom = inputY + inputHeight;
    // Repeat the edge pixels in the unused space, keeping the source scale exact.
    if (inputX) context.drawImage(canvas, inputX, inputY, 1, inputHeight, 0, inputY, inputX, inputHeight);
    if (right < TILE_UPSCALE_EDGE) context.drawImage(canvas, right - 1, inputY, 1, inputHeight, right, inputY, TILE_UPSCALE_EDGE - right, inputHeight);
    if (inputY) context.drawImage(canvas, 0, inputY, TILE_UPSCALE_EDGE, 1, 0, 0, TILE_UPSCALE_EDGE, inputY);
    if (bottom < TILE_UPSCALE_EDGE) context.drawImage(canvas, 0, bottom - 1, TILE_UPSCALE_EDGE, 1, 0, bottom, TILE_UPSCALE_EDGE, TILE_UPSCALE_EDGE - bottom);
    return canvas.toDataURL("image/png");
  } finally {
    crop.width = 0;
    canvas.width = 0;
  }
}

export async function getTiledUpscaleInput(source: EditorDocument, plan: ImageUpscalePlan, tile: ImageUpscaleTile, signal: AbortSignal): Promise<string> {
  if (!source.tiledSource) return localTileInput(source.image, tile);
  const query = new URLSearchParams({ id: source.tiledSource.id, scale: String(plan.scale), index: String(tile.index) });
  const response = await checkEditorStorageResponse(await fetch(`${SOURCE_ENDPOINT}?${query}`, { signal, cache: "no-store" }));
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取源图分块"));
    reader.readAsDataURL(blob);
  });
}

export function needsTiledResultArchive(source: EditorDocument, plan: ImageUpscalePlan): boolean {
  return Boolean(source.tiledSource) || needsTiledSource(plan.outputWidth, plan.outputHeight);
}

export async function createTiledResultArchive(plan: ImageUpscalePlan, signal: AbortSignal): Promise<TiledResultArchive> {
  const response = await checkEditorStorageResponse(await fetch(RESULT_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ width: plan.sourceWidth, height: plan.sourceHeight, scale: plan.scale }),
    signal,
  }));
  const { id } = await response.json() as { id: string };
  const ratio = Math.min(1, PREVIEW_MAX_EDGE / Math.max(plan.outputWidth, plan.outputHeight));
  const { canvas } = canvasWithSize(Math.max(1, Math.round(plan.outputWidth * ratio)), Math.max(1, Math.round(plan.outputHeight * ratio)));
  return { id, preview: canvas };
}

export function tiledResultDownloadUrl(id: string): string {
  return `${RESULT_ENDPOINT}?id=${encodeURIComponent(id)}`;
}

export async function saveTiledResultTile(
  archive: TiledResultArchive, plan: ImageUpscalePlan, tile: ImageUpscaleTile,
  blob: Blob, bitmap: ImageBitmap, signal: AbortSignal,
): Promise<void> {
  await checkEditorStorageResponse(await fetch(`${tiledResultDownloadUrl(archive.id)}&index=${tile.index}`, {
    method: "PUT", body: blob, signal,
  }));
  const context = archive.preview.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  const scaleX = archive.preview.width / plan.outputWidth;
  const scaleY = archive.preview.height / plan.outputHeight;
  const x = Math.round(tile.coreX * scaleX);
  const y = Math.round(tile.coreY * scaleY);
  const width = Math.round((tile.coreX + tile.coreWidth) * scaleX) - x;
  const height = Math.round((tile.coreY + tile.coreHeight) * scaleY) - y;
  if (width && height) {
    context.clearRect(x, y, width, height);
    context.drawImage(bitmap, tile.cropX, tile.cropY, tile.coreWidth, tile.coreHeight, x, y, width, height);
  }
}

export async function stitchTiledUpscale(
  plan: ImageUpscalePlan, generated: Map<number, Blob>, archive?: TiledResultArchive,
): Promise<RgbaImage> {
  if (archive) {
    const { width, height } = archive.preview;
    const context = archive.preview.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 Canvas");
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  }
  const { canvas, context } = canvasWithSize(plan.outputWidth, plan.outputHeight);
  try {
    for (const tile of plan.tiles) {
      const bitmap = await decodeCachedUpscaleTile(generated, tile.index, plan.tiles.length);
      try {
        context.drawImage(
          bitmap, tile.cropX, tile.cropY, tile.coreWidth, tile.coreHeight,
          tile.coreX, tile.coreY, tile.coreWidth, tile.coreHeight,
        );
      } finally {
        bitmap.close();
      }
    }
    return { width: plan.outputWidth, height: plan.outputHeight, data: context.getImageData(0, 0, plan.outputWidth, plan.outputHeight).data };
  } finally {
    canvas.width = 0;
  }
}
