export const TILE_UPSCALE_DEFAULT_STRENGTH = 0.1;
export const TILE_UPSCALE_EDGE = 1024;
export const TILE_UPSCALE_MAX_FREE_PIXELS = TILE_UPSCALE_EDGE ** 2;
export const TILE_UPSCALE_OVERLAP = 32;
export const TILE_UPSCALE_LAYOUT_VERSION = 2;

export type TileUpscaleFactor = 2 | 3 | 4 | 5 | 6;
export type TileUpscaleLayoutVersion = 1 | typeof TILE_UPSCALE_LAYOUT_VERSION;

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
  /** Integer crop in the source image. */
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Trim these output-pixel offsets from the crop after scaling it. */
  sampleX: number;
  sampleY: number;
  /** Core position and size in the final output. */
  coreX: number;
  coreY: number;
  coreWidth: number;
  coreHeight: number;
  /** Resized source crop placed inside the padded request. */
  inputX: number;
  inputY: number;
  inputWidth: number;
  inputHeight: number;
  /** Core origin in the returned request-sized tile. */
  cropX: number;
  cropY: number;
  requestWidth: number;
  requestHeight: number;
};

export type ImageUpscaleLayout = {
  sourceWidth: number;
  sourceHeight: number;
  layoutVersion: TileUpscaleLayoutVersion;
  scale: TileUpscaleFactor;
  outputWidth: number;
  outputHeight: number;
  rows: number;
  columns: number;
};

export type ImageUpscalePlan = ImageUpscaleLayout & { tiles: ImageUpscaleTile[] };

function splitAxis(length: number, parts: number, index: number) {
  const base = Math.floor(length / parts);
  const remainder = length % parts;
  return {
    coreStart: index * base + Math.min(index, remainder),
    coreLength: base + (index < remainder ? 1 : 0),
  };
}

function planLegacyTileAxis(length: number, parts: number, index: number, scale: TileUpscaleFactor) {
  const { coreStart, coreLength } = splitAxis(length, parts, index);
  const overlap = Math.ceil(TILE_UPSCALE_OVERLAP / scale);
  const sourceStart = Math.max(0, coreStart - overlap);
  const sourceEnd = Math.min(length, coreStart + coreLength + overlap);
  const sourceLength = sourceEnd - sourceStart;
  const inputLength = sourceLength * scale;
  const inputStart = Math.floor((TILE_UPSCALE_EDGE - inputLength) / 2);
  return {
    sourceStart, sourceLength, inputStart, inputLength, sampleOffset: 0,
    coreStart: coreStart * scale,
    coreLength: coreLength * scale,
    cropStart: inputStart + (coreStart - sourceStart) * scale,
  };
}

function planTileAxis(length: number, parts: number, index: number, scale: TileUpscaleFactor) {
  const { coreStart, coreLength } = splitAxis(length, parts, index);
  const coreEnd = coreStart + coreLength;
  const spare = TILE_UPSCALE_EDGE - coreLength;
  const leftLimit = Math.min(coreStart, TILE_UPSCALE_OVERLAP);
  const rightLimit = Math.min(length - coreEnd, TILE_UPSCALE_OVERLAP);
  const after = Math.min(rightLimit, spare - Math.min(leftLimit, Math.floor(spare / 2)));
  const before = Math.min(leftLimit, spare - after);
  const sampleStart = coreStart - before;
  const sampleEnd = coreEnd + after;
  const sourceStart = Math.floor(sampleStart / scale);
  const sourceLength = Math.ceil(sampleEnd / scale) - sourceStart;
  const sampleOffset = sampleStart - sourceStart * scale;
  const inputLength = sampleEnd - sampleStart;
  const inputStart = Math.floor((TILE_UPSCALE_EDGE - inputLength) / 2);
  return { sourceStart, sourceLength, sampleOffset, inputStart, inputLength, coreStart, coreLength, cropStart: inputStart + before };
}

/** Describe the grid without allocating any tile objects. */
export function describeImageTileUpscale(
  sourceWidth: number,
  sourceHeight: number,
  scale: TileUpscaleFactor,
  layoutVersion: TileUpscaleLayoutVersion = TILE_UPSCALE_LAYOUT_VERSION,
): ImageUpscaleLayout {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1)
    throw new RangeError("源图尺寸必须是正整数");
  if (![2, 3, 4, 5, 6].includes(scale)) throw new RangeError("分块超分仅支持 2× 至 6×");
  if (layoutVersion !== 1 && layoutVersion !== TILE_UPSCALE_LAYOUT_VERSION) throw new RangeError("分块规划版本无效");

  const outputWidth = sourceWidth * scale;
  const outputHeight = sourceHeight * scale;
  if (!Number.isSafeInteger(outputWidth) || !Number.isSafeInteger(outputHeight))
    throw new RangeError("目标图尺寸超出可表示的整数范围");

  // Version 1 archives already stored their cropped tile cores, so they must
  // be exported with the grid that was used to create them.
  const overlap = Math.ceil(TILE_UPSCALE_OVERLAP / scale);
  const legacyCoreEdge = Math.floor(TILE_UPSCALE_EDGE / scale) - overlap * 2;
  const rows = Math.max(Math.min(scale, sourceHeight), layoutVersion === 1 ? Math.ceil(sourceHeight / legacyCoreEdge) : Math.ceil(outputHeight / TILE_UPSCALE_EDGE));
  const columns = Math.max(Math.min(scale, sourceWidth), layoutVersion === 1 ? Math.ceil(sourceWidth / legacyCoreEdge) : Math.ceil(outputWidth / TILE_UPSCALE_EDGE));
  if (!Number.isSafeInteger(rows * columns)) throw new RangeError("分块数量超出可表示的整数范围");
  return { sourceWidth, sourceHeight, layoutVersion, scale, outputWidth, outputHeight, rows, columns };
}

export function imageUpscaleTileAt(plan: ImageUpscaleLayout, index: number): ImageUpscaleTile {
  const { sourceWidth, sourceHeight, outputWidth, outputHeight, rows, columns, scale, layoutVersion } = plan;
  if (!Number.isSafeInteger(index) || index < 0 || index >= rows * columns) throw new RangeError("图块编号无效");
  const row = Math.floor(index / columns);
  const column = index % columns;
  const x = layoutVersion === 1 ? planLegacyTileAxis(sourceWidth, columns, column, scale) : planTileAxis(outputWidth, columns, column, scale);
  const y = layoutVersion === 1 ? planLegacyTileAxis(sourceHeight, rows, row, scale) : planTileAxis(outputHeight, rows, row, scale);
  return {
    index, row, column,
    sourceX: x.sourceStart,
    sourceY: y.sourceStart,
    sourceWidth: x.sourceLength,
    sourceHeight: y.sourceLength,
    sampleX: x.sampleOffset,
    sampleY: y.sampleOffset,
    coreX: x.coreStart,
    coreY: y.coreStart,
    coreWidth: x.coreLength,
    coreHeight: y.coreLength,
    inputX: x.inputStart,
    inputY: y.inputStart,
    inputWidth: x.inputLength,
    inputHeight: y.inputLength,
    cropX: x.cropStart,
    cropY: y.cropStart,
    requestWidth: TILE_UPSCALE_EDGE,
    requestHeight: TILE_UPSCALE_EDGE,
  };
}

/** Plan overlapped 1024² redraws without stretching cropped source pixels. */
export function planImageTileUpscale(sourceWidth: number, sourceHeight: number, scale: TileUpscaleFactor): ImageUpscalePlan {
  const layout = describeImageTileUpscale(sourceWidth, sourceHeight, scale);
  const count = layout.rows * layout.columns;
  if (count > 0xffffffff) throw new RangeError("分块数量超出浏览器可表示的范围");
  return { ...layout, tiles: Array.from({ length: count }, (_, index) => imageUpscaleTileAt(layout, index)) };
}
