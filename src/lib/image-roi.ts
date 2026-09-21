/**
 * Geometry helpers for rectangular image ROIs.
 *
 * This module deliberately has no browser or canvas dependencies. Coordinates are
 * expressed in source-image pixels; the right and bottom edges are exclusive.
 */

export const ROI_ALIGNMENT = 64;
export const ROI_MIN_DIMENSION = 64;
export const ROI_MAX_DIMENSION = 1600;
export const ROI_MAX_PIXELS = 2_560_000;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type ImageSize = { width: number; height: number };
export type RectBounds = ImageSize | (Rect & Partial<ImageSize>);

export type RoiValidationResult = {
  valid: boolean;
  errors: string[];
  width: number;
  height: number;
  area: number;
};

export type SelectionToPatchResult = {
  /** The area that may be replaced in the original image. */
  selectionRect: Rect;
  /** The area sent to inpainting, including context but not necessarily replaced. */
  cropRect: Rect;
  /** Selection coordinates relative to the top-left of cropRect. */
  selectionInPatch: Rect;
  width: number;
  height: number;
};

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function boundsSize(bounds: RectBounds): ImageSize {
  return { width: bounds.width, height: bounds.height };
}

function assertFiniteRect(rect: Rect, label: string): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(finite))
    throw new RangeError(`${label} 必须由有限数字组成`);
}

function assertFiniteSize(size: ImageSize): void {
  if (![size.width, size.height].every(finite) || size.width <= 0 || size.height <= 0)
    throw new RangeError("图像尺寸必须是正数");
}

/** Clamp a point to the inclusive edge of an image or rectangular bounds. */
export function clampPoint(point: Point, bounds: RectBounds): Point {
  if (!finite(point.x) || !finite(point.y)) throw new RangeError("点坐标必须是有限数字");
  assertFiniteSize(boundsSize(bounds));
  const left = "x" in bounds && finite(bounds.x) ? bounds.x : 0;
  const top = "y" in bounds && finite(bounds.y) ? bounds.y : 0;
  return {
    x: Math.min(left + bounds.width, Math.max(left, point.x)),
    y: Math.min(top + bounds.height, Math.max(top, point.y)),
  };
}

/**
 * Normalize a rectangle with a drag in either direction. Negative dimensions
 * are converted to a top-left origin while retaining the same covered pixels.
 */
export function normalizeRect(rect: Rect): Rect;
export function normalizeRect(start: Point, end: Point): Rect;
export function normalizeRect(first: Rect | Point, second?: Point): Rect {
  const rect: Rect = second
    ? { x: first.x, y: first.y, width: second.x - first.x, height: second.y - first.y }
    : first as Rect;
  assertFiniteRect(rect, "矩形");
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

/** Expand a rectangle by equal or per-axis padding, optionally clipping it. */
export function expandRect(rect: Rect, padding: number, bounds?: RectBounds): Rect;
export function expandRect(rect: Rect, padding: Point, bounds?: RectBounds): Rect;
export function expandRect(rect: Rect, padding: number | Point, bounds?: RectBounds): Rect {
  const normalized = normalizeRect(rect);
  const padX = typeof padding === "number" ? padding : padding.x;
  const padY = typeof padding === "number" ? padding : padding.y;
  if (!finite(padX) || !finite(padY) || padX < 0 || padY < 0)
    throw new RangeError("外扩距离必须是非负有限数字");
  const expanded = {
    x: normalized.x - padX,
    y: normalized.y - padY,
    width: normalized.width + padX * 2,
    height: normalized.height + padY * 2,
  };
  if (!bounds) return expanded;
  const size = boundsSize(bounds);
  assertFiniteSize(size);
  const left = "x" in bounds && finite(bounds.x) ? bounds.x : 0;
  const top = "y" in bounds && finite(bounds.y) ? bounds.y : 0;
  const right = left + size.width;
  const bottom = top + size.height;
  const x = Math.max(left, expanded.x);
  const y = Math.max(top, expanded.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(right, expanded.x + expanded.width) - x),
    height: Math.max(0, Math.min(bottom, expanded.y + expanded.height) - y),
  };
}

/**
 * Enclose a rectangle in a grid-aligned rectangle. When bounds are supplied,
 * the result remains inside those bounds; a non-aligned bound can therefore
 * make the returned dimensions non-aligned and should be rejected by validateRoi.
 */
export function alignRectToMultiple(rect: Rect, multiple?: number, bounds?: RectBounds): Rect;
export function alignRectToMultiple(rect: Rect, bounds: RectBounds, multiple?: number): Rect;
export function alignRectToMultiple(
  rect: Rect,
  multipleOrBounds: number | RectBounds = ROI_ALIGNMENT,
  maybeBounds?: RectBounds | number,
): Rect {
  const multiple = typeof multipleOrBounds === "number"
    ? multipleOrBounds
    : typeof maybeBounds === "number" ? maybeBounds : ROI_ALIGNMENT;
  const bounds = typeof multipleOrBounds === "number"
    ? typeof maybeBounds === "object" ? maybeBounds : undefined
    : multipleOrBounds;
  if (!Number.isFinite(multiple) || multiple <= 0)
    throw new RangeError("对齐倍数必须是正数");
  const normalized = normalizeRect(rect);
  let left = Math.floor(normalized.x / multiple) * multiple;
  let top = Math.floor(normalized.y / multiple) * multiple;
  let right = Math.ceil((normalized.x + normalized.width) / multiple) * multiple;
  let bottom = Math.ceil((normalized.y + normalized.height) / multiple) * multiple;

  if (bounds) {
    const size = boundsSize(bounds);
    assertFiniteSize(size);
    const boundLeft = "x" in bounds && finite((bounds as Partial<Rect>).x ?? NaN)
      ? (bounds as Partial<Rect>).x!
      : 0;
    const boundTop = "y" in bounds && finite((bounds as Partial<Rect>).y ?? NaN)
      ? (bounds as Partial<Rect>).y!
      : 0;
    const boundRight = boundLeft + size.width;
    const boundBottom = boundTop + size.height;
    left = Math.max(boundLeft, left);
    top = Math.max(boundTop, top);
    right = Math.min(boundRight, right);
    bottom = Math.min(boundBottom, bottom);

    // A selection touching an edge still gets one complete grid cell when possible.
    if (right - left < multiple) {
      right = Math.min(boundRight, left + multiple);
      left = Math.max(boundLeft, right - multiple);
    }
    if (bottom - top < multiple) {
      bottom = Math.min(boundBottom, top + multiple);
      top = Math.max(boundTop, bottom - multiple);
    }
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Validate a candidate patch against the image-request limits. */
export function validateRoi(
  rect: Rect,
  bounds?: ImageSize,
  options: { requireAligned?: boolean; alignment?: number } = {},
): RoiValidationResult {
  const errors: string[] = [];
  const width = rect.width;
  const height = rect.height;
  const area = width * height;
  if (![rect.x, rect.y, width, height].every(finite)) {
    errors.push("ROI 必须由有限数字组成");
    return { valid: false, errors, width, height, area };
  }
  if (width <= 0 || height <= 0) errors.push("ROI 必须有正的宽高");
  if (options.requireAligned && (!Number.isInteger(width) || !Number.isInteger(height)))
    errors.push("ROI 宽高必须是整数");
  const alignment = options.alignment ?? ROI_ALIGNMENT;
  if (options.requireAligned && (width % alignment !== 0 || height % alignment !== 0))
    errors.push(`ROI 宽高必须是 ${alignment} 的倍数`);
  if (width < ROI_MIN_DIMENSION || height < ROI_MIN_DIMENSION)
    errors.push(`ROI 宽高不能小于 ${ROI_MIN_DIMENSION}`);
  if (width > ROI_MAX_DIMENSION || height > ROI_MAX_DIMENSION)
    errors.push(`ROI 宽高不能超过 ${ROI_MAX_DIMENSION}`);
  if (area > ROI_MAX_PIXELS) errors.push(`ROI 像素不能超过 ${ROI_MAX_PIXELS}`);
  if (bounds) {
    if (!finite(bounds.width) || !finite(bounds.height) || bounds.width <= 0 || bounds.height <= 0)
      errors.push("图像尺寸必须是正数");
    else if (rect.x < 0 || rect.y < 0 || rect.x + width > bounds.width || rect.y + height > bounds.height)
      errors.push("ROI 必须位于图像范围内");
  }
  return { valid: errors.length === 0, errors, width, height, area };
}

function invalidRoi(result: RoiValidationResult): never {
  throw new RangeError(result.errors.join("；"));
}

export type SelectionToPatchOptions = {
  selectionRect: Rect;
  imageSize: ImageSize;
  context?: number;
  alignment?: number;
};

function selectionOptions(
  selectionOrOptions: Rect | SelectionToPatchOptions,
  imageSizeOrWidth: ImageSize | number,
  imageHeightOrContext?: number,
  context = 64,
): SelectionToPatchOptions {
  if ("selectionRect" in selectionOrOptions) return selectionOrOptions;
  if (typeof imageSizeOrWidth === "number") {
    if (imageHeightOrContext === undefined) throw new TypeError("缺少图像高度");
    return { selectionRect: selectionOrOptions, imageSize: { width: imageSizeOrWidth, height: imageHeightOrContext }, context };
  }
  return { selectionRect: selectionOrOptions, imageSize: imageSizeOrWidth, context: imageHeightOrContext ?? context };
}

/** Map a source selection to an aligned, context-expanded inpainting patch. */
export function selectionToPatch(options: SelectionToPatchOptions): SelectionToPatchResult;
export function selectionToPatch(selectionRect: Rect, imageSize: ImageSize, context?: number): SelectionToPatchResult;
export function selectionToPatch(selectionRect: Rect, imageWidth: number, imageHeight: number, context?: number): SelectionToPatchResult;
export function selectionToPatch(
  selectionOrOptions: Rect | SelectionToPatchOptions,
  imageSizeOrWidth?: ImageSize | number,
  imageHeightOrContext?: number,
  context = 64,
): SelectionToPatchResult {
  const options = "selectionRect" in selectionOrOptions
    ? selectionOrOptions
    : selectionOptions(
        selectionOrOptions,
        imageSizeOrWidth as ImageSize | number,
        imageHeightOrContext,
        context,
      );
  const size = options.imageSize;
  assertFiniteSize(size);
  const alignment = options.alignment ?? ROI_ALIGNMENT;
  const selection = expandRect(normalizeRect(options.selectionRect), 0, size);
  if (selection.width <= 0 || selection.height <= 0) throw new RangeError("选区必须有正的宽高");
  const cropRect = alignRectToMultiple(
    expandRect(selection, options.context ?? 64, size),
    alignment,
    size,
  );
  const validation = validateRoi(cropRect, size, { requireAligned: true, alignment });
  if (!validation.valid) invalidRoi(validation);
  return {
    selectionRect: selection,
    cropRect,
    selectionInPatch: {
      x: selection.x - cropRect.x,
      y: selection.y - cropRect.y,
      width: selection.width,
      height: selection.height,
    },
    width: cropRect.width,
    height: cropRect.height,
  };
}
