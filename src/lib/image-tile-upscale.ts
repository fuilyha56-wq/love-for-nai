export const TILE_UPSCALE_EDGE = 1024;
export const TILE_UPSCALE_MAX_FREE_PIXELS = 1_048_576;
export const TILE_UPSCALE_OVERLAP = 32;
export const TILE_UPSCALE_MAX_OUTPUT_EDGE = 8192;
export const TILE_UPSCALE_MAX_OUTPUT_PIXELS = 40_000_000;
export const TILE_UPSCALE_MAX_TILES = 64;

export type TileUpscaleFactor = 2 | 3 | 4 | 5 | 6;

export type TileUpscaleGatewayCapacity = {
  total: number;
  v5: number;
  v45: number;
  anlas: number;
  v5_and_anlas: number;
  v45_and_anlas: number;
  concurrency: number;
};

/** Select the live Gateway account pool that can serve these img2img tiles. */
export function tileUpscaleConcurrencyLimit(
  model: string,
  steps: number,
  capacity: TileUpscaleGatewayCapacity,
): number {
  const needsAnlas = steps > 28;
  if (/nai-v5/i.test(model)) return needsAnlas ? capacity.v5_and_anlas : capacity.v5;
  if (/nai-v4\.5/i.test(model)) return needsAnlas ? capacity.v45_and_anlas : capacity.v45;
  return capacity.concurrency;
}

export type ImageUpscaleTile = {
  index: number;
  row: number;
  column: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  coreX: number;
  coreY: number;
  coreWidth: number;
  coreHeight: number;
  requestWidth: number;
  requestHeight: number;
};

export type ImageUpscalePlan = {
  sourceWidth: number;
  sourceHeight: number;
  scale: TileUpscaleFactor;
  outputWidth: number;
  outputHeight: number;
  tiles: ImageUpscaleTile[];
};

function fitFreeTileRequest(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const idealScale = Math.min(
    TILE_UPSCALE_EDGE / sourceWidth,
    TILE_UPSCALE_EDGE / sourceHeight,
    Math.sqrt(TILE_UPSCALE_MAX_FREE_PIXELS / (sourceWidth * sourceHeight)),
  );
  const targetWidth = sourceWidth * idealScale;
  const targetHeight = sourceHeight * idealScale;
  const maxWidth = TILE_UPSCALE_EDGE;
  const maxHeight = TILE_UPSCALE_EDGE;
  const idealArea = targetWidth * targetHeight;
  let best: { width: number; height: number; score: number; area: number } | null = null;

  // NAI dimensions are multiples of 64. Choose the closest legal size while
  // strongly favoring the crop's aspect ratio, within the 1024² free envelope.
  for (let width = 64; width <= maxWidth; width += 64) {
    for (let height = 64; height <= maxHeight; height += 64) {
      const area = width * height;
      if (area > TILE_UPSCALE_MAX_FREE_PIXELS) continue;
      const ratioError = Math.abs(Math.log((width / height) / (targetWidth / targetHeight)));
      const areaError = Math.abs(Math.log(area / idealArea));
      const score = ratioError * 12 + areaError * 0.5;
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && area > best.area))
        best = { width, height, score, area };
    }
  }
  if (!best) throw new RangeError("无法为分块选择符合免费范围的请求尺寸");
  return { width: best.width, height: best.height };
}

/** Split an image into overlapped source tiles whose redraw requests stay <= 1024px. */
export function planImageTileUpscale(
  sourceWidth: number,
  sourceHeight: number,
  scale: TileUpscaleFactor,
): ImageUpscalePlan {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) || sourceWidth < 64 || sourceHeight < 64)
    throw new RangeError("源图尺寸至少为 64×64 像素");
  if (![2, 3, 4, 5, 6].includes(scale)) throw new RangeError("分块超分仅支持 2× 至 6×");

  const outputWidth = sourceWidth * scale;
  const outputHeight = sourceHeight * scale;
  if (outputWidth > TILE_UPSCALE_MAX_OUTPUT_EDGE || outputHeight > TILE_UPSCALE_MAX_OUTPUT_EDGE || outputWidth * outputHeight > TILE_UPSCALE_MAX_OUTPUT_PIXELS)
    throw new RangeError(`目标图过大：${outputWidth}×${outputHeight}；上限为 ${TILE_UPSCALE_MAX_OUTPUT_EDGE} 边长且不超过 ${TILE_UPSCALE_MAX_OUTPUT_PIXELS.toLocaleString()} 像素`);

  // Keep more context at low scales; reduce source overlap at 5×/6× so
  // common portrait images stay within the automatic 64-request limit.
  const overlap = scale >= 5 ? TILE_UPSCALE_OVERLAP / 2 : TILE_UPSCALE_OVERLAP;
  const coreEdge = Math.floor(TILE_UPSCALE_EDGE / scale) - overlap * 2;
  const rows = Math.ceil(sourceHeight / coreEdge);
  const columns = Math.ceil(sourceWidth / coreEdge);
  const count = rows * columns;
  if (count > TILE_UPSCALE_MAX_TILES)
    throw new RangeError(`需要 ${count} 个分块，超过单次最多 ${TILE_UPSCALE_MAX_TILES} 块的限制`);

  const tiles: ImageUpscaleTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const coreX = column * coreEdge;
      const coreY = row * coreEdge;
      const coreWidth = Math.min(coreEdge, sourceWidth - coreX);
      const coreHeight = Math.min(coreEdge, sourceHeight - coreY);
      const sourceX = Math.max(0, coreX - overlap);
      const sourceY = Math.max(0, coreY - overlap);
      const sourceRight = Math.min(sourceWidth, coreX + coreWidth + overlap);
      const sourceBottom = Math.min(sourceHeight, coreY + coreHeight + overlap);
      const sourceTileWidth = sourceRight - sourceX;
      const sourceTileHeight = sourceBottom - sourceY;
      const request = fitFreeTileRequest(sourceTileWidth, sourceTileHeight);
      const requestWidth = request.width;
      const requestHeight = request.height;
      if (requestWidth > TILE_UPSCALE_EDGE || requestHeight > TILE_UPSCALE_EDGE || requestWidth * requestHeight > TILE_UPSCALE_MAX_FREE_PIXELS)
        throw new RangeError("分块尺寸超过 1024 像素，请减小源图或超分倍率");
      tiles.push({
        index: tiles.length,
        row,
        column,
        sourceX,
        sourceY,
        sourceWidth: sourceTileWidth,
        sourceHeight: sourceTileHeight,
        coreX,
        coreY,
        coreWidth,
        coreHeight,
        requestWidth,
        requestHeight,
      });
    }
  }

  return { sourceWidth, sourceHeight, scale, outputWidth, outputHeight, tiles };
}
