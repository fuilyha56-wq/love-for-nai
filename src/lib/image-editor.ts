export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type WorldRect = Point & Size;
export type Rect = WorldRect;

export type CameraState = {
  x: number;
  y: number;
  zoom: number;
};

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type ImageSourceMetadata = {
  id?: string;
  name?: string;
  url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
};

export type EditorGenerationSettings = {
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  strength?: number;
  sampler?: string;
  noiseSchedule?: string;
};

export type EditorDocument = {
  version: 1;
  image: RgbaImage;
  worldRect: WorldRect;
  prompt?: string;
  negativePrompt?: string;
  seed?: number | string | null;
  source?: ImageSourceMetadata;
  generation?: EditorGenerationSettings;
  revision: number;
};

export type GenerationViewport = WorldRect;
export type ViewportCorner = "nw" | "ne" | "sw" | "se";

export type MaskStroke = {
  points: Point[];
  radius: number;
  mode?: "add" | "erase";
  opacity?: number;
  shape?: "freehand" | "rectangle";
};

export type MaskData = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

export type MaskState = {
  strokes: MaskStroke[];
  undone: MaskStroke[];
};

export type PendingCandidate = {
  id: string;
  patch: RgbaImage;
  viewport: GenerationViewport;
  mask?: MaskData | Uint8Array | Uint8ClampedArray;
  prompt?: string;
  seed?: number | string | null;
  createdAt?: number;
};

export type ReviewSession = {
  status: "review" | "applied" | "discarded";
  base: EditorDocument;
  candidate: PendingCandidate;
};

export type ResizeViewportOptions = {
  aspect?: number;
  minWidth?: number;
  minHeight?: number;
};

export type SnapOptions = {
  threshold?: number;
  edges?: Partial<WorldRect>;
};

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function assertFinitePoint(point: Point): void {
  if (!finite(point.x) || !finite(point.y)) throw new RangeError("点坐标必须是有限数字");
}

function assertFiniteRect(rect: WorldRect): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(finite)) {
    throw new RangeError("矩形必须由有限数字组成");
  }
  if (rect.width < 0 || rect.height < 0) throw new RangeError("矩形宽高不能为负数");
}

function assertImage(image: RgbaImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 0 || image.height < 0) {
    throw new RangeError("图像尺寸必须是非负整数");
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError("RGBA 数据长度与图像尺寸不匹配");
  }
}

function cloneImage(image: RgbaImage): RgbaImage {
  assertImage(image);
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

function rectRight(rect: WorldRect): number {
  return rect.x + rect.width;
}

function rectBottom(rect: WorldRect): number {
  return rect.y + rect.height;
}

export function createRgbaImage(width: number, height: number, data?: ArrayLike<number>): RgbaImage {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError("图像尺寸必须是非负整数");
  }
  if (data !== undefined) {
    if (data.length !== image.data.length) throw new RangeError("RGBA 数据长度与图像尺寸不匹配");
    image.data.set(data);
  }
  return image;
}

export function cloneRgbaImage(image: RgbaImage): RgbaImage {
  return cloneImage(image);
}

export function createEditorDocument(
  image: RgbaImage,
  worldRect: WorldRect = { x: 0, y: 0, width: image.width, height: image.height },
  metadata: Omit<EditorDocument, "version" | "image" | "worldRect" | "revision"> = {},
): EditorDocument {
  assertImage(image);
  assertFiniteRect(worldRect);
  if (worldRect.width !== image.width || worldRect.height !== image.height) {
    throw new RangeError("世界矩形尺寸必须与图像尺寸一致");
  }
  return {
    version: 1,
    image: cloneImage(image),
    worldRect: { ...worldRect },
    revision: 0,
    ...metadata,
  };
}

export function normalizeWorldRect(rect: WorldRect): WorldRect {
  if (![rect.x, rect.y, rect.width, rect.height].every(finite)) {
    throw new RangeError("矩形必须由有限数字组成");
  }
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

export function unionWorldRects(first: WorldRect, second: WorldRect): WorldRect {
  const a = normalizeWorldRect(first);
  const b = normalizeWorldRect(second);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(rectRight(a), rectRight(b)) - x, height: Math.max(rectBottom(a), rectBottom(b)) - y };
}

export function intersectWorldRects(first: WorldRect, second: WorldRect): WorldRect | null {
  const a = normalizeWorldRect(first);
  const b = normalizeWorldRect(second);
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(rectRight(a), rectRight(b));
  const bottom = Math.min(rectBottom(a), rectBottom(b));
  return right <= x || bottom <= y ? null : { x, y, width: right - x, height: bottom - y };
}

export function worldToScreen(point: Point, camera: CameraState, screenOrigin: Point = { x: 0, y: 0 }): Point {
  assertFinitePoint(point);
  if (!finite(camera.x) || !finite(camera.y) || !finite(camera.zoom) || camera.zoom <= 0) {
    throw new RangeError("相机必须有正的缩放比例");
  }
  return {
    x: screenOrigin.x + (point.x - camera.x) * camera.zoom,
    y: screenOrigin.y + (point.y - camera.y) * camera.zoom,
  };
}

export function screenToWorld(point: Point, camera: CameraState, screenOrigin: Point = { x: 0, y: 0 }): Point {
  assertFinitePoint(point);
  if (!finite(camera.x) || !finite(camera.y) || !finite(camera.zoom) || camera.zoom <= 0) {
    throw new RangeError("相机必须有正的缩放比例");
  }
  return {
    x: camera.x + (point.x - screenOrigin.x) / camera.zoom,
    y: camera.y + (point.y - screenOrigin.y) / camera.zoom,
  };
}

export function worldRectToScreen(rect: WorldRect, camera: CameraState, screenOrigin?: Point): WorldRect {
  const topLeft = worldToScreen({ x: rect.x, y: rect.y }, camera, screenOrigin);
  return { x: topLeft.x, y: topLeft.y, width: rect.width * camera.zoom, height: rect.height * camera.zoom };
}

export function screenRectToWorld(rect: WorldRect, camera: CameraState, screenOrigin?: Point): WorldRect {
  const topLeft = screenToWorld({ x: rect.x, y: rect.y }, camera, screenOrigin);
  return { x: topLeft.x, y: topLeft.y, width: rect.width / camera.zoom, height: rect.height / camera.zoom };
}

export function moveCamera(camera: CameraState, delta: Point): CameraState {
  assertFinitePoint(delta);
  return { ...camera, x: camera.x + delta.x, y: camera.y + delta.y };
}

export function panCamera(camera: CameraState, screenDelta: Point): CameraState {
  assertFinitePoint(screenDelta);
  if (!finite(camera.zoom) || camera.zoom <= 0) throw new RangeError("相机必须有正的缩放比例");
  return { ...camera, x: camera.x - screenDelta.x / camera.zoom, y: camera.y - screenDelta.y / camera.zoom };
}

export function zoomCameraAt(camera: CameraState, factor: number, screenPoint: Point = { x: 0, y: 0 }, screenOrigin?: Point): CameraState {
  if (!finite(factor) || factor <= 0) throw new RangeError("缩放比例必须为正数");
  const anchor = screenToWorld(screenPoint, camera, screenOrigin);
  const zoom = camera.zoom * factor;
  const next = { ...camera, zoom };
  const moved = screenToWorld(screenPoint, next, screenOrigin);
  return { ...next, x: next.x + anchor.x - moved.x, y: next.y + anchor.y - moved.y };
}

export function moveViewport(viewport: GenerationViewport, delta: Point): GenerationViewport {
  assertFinitePoint(delta);
  return { ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y };
}

export const moveGenerationViewport = moveViewport;

export function resizeViewport(
  viewport: GenerationViewport,
  corner: ViewportCorner,
  pointer: Point,
  options: ResizeViewportOptions = {},
): GenerationViewport {
  assertFiniteRect(viewport);
  assertFinitePoint(pointer);
  const aspect = options.aspect ?? (viewport.width / viewport.height);
  if (!finite(aspect) || aspect <= 0) throw new RangeError("宽高比必须为正数");
  const minWidth = Math.max(0, options.minWidth ?? 1);
  const minHeight = Math.max(0, options.minHeight ?? minWidth / aspect);
  const anchor = {
    x: corner.includes("w") ? rectRight(viewport) : viewport.x,
    y: corner.includes("n") ? rectBottom(viewport) : viewport.y,
  };
  const horizontal = Math.max(minWidth, Math.abs(pointer.x - anchor.x));
  const vertical = Math.max(minHeight, Math.abs(pointer.y - anchor.y));
  let width = Math.max(horizontal, vertical * aspect);
  let height = width / aspect;
  if (height < minHeight) {
    height = minHeight;
    width = height * aspect;
  }
  const x = corner.includes("w") ? anchor.x - width : anchor.x;
  const y = corner.includes("n") ? anchor.y - height : anchor.y;
  return { x, y, width, height };
}

export const resizeGenerationViewport = resizeViewport;

export function snapRectToEdges(rect: WorldRect, bounds: WorldRect, options: SnapOptions = {}): WorldRect {
  const threshold = Math.max(0, options.threshold ?? 8);
  const edgeSource = options.edges ?? bounds;
  const result = { ...rect };
  const edges = {
    left: edgeSource.x,
    top: edgeSource.y,
    right: edgeSource.x === undefined || edgeSource.width === undefined ? undefined : edgeSource.x + edgeSource.width,
    bottom: edgeSource.y === undefined || edgeSource.height === undefined ? undefined : edgeSource.y + edgeSource.height,
  };
  if (edges.left !== undefined && Math.abs(result.x - edges.left) <= threshold) result.x = edges.left;
  if (edges.top !== undefined && Math.abs(result.y - edges.top) <= threshold) result.y = edges.top;
  if (edges.right !== undefined && Math.abs(rectRight(result) - edges.right) <= threshold) result.x = edges.right - result.width;
  if (edges.bottom !== undefined && Math.abs(rectBottom(result) - edges.bottom) <= threshold) result.y = edges.bottom - result.height;
  return result;
}

export const snapWorldRect = snapRectToEdges;

export function alphaBounds(image: RgbaImage, threshold = 0, offset: Point = { x: 0, y: 0 }): WorldRect | null {
  assertImage(image);
  if (!finite(threshold) || threshold < 0 || threshold > 255) throw new RangeError("alpha 阈值必须在 0 到 255 之间");
  assertFinitePoint(offset);
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > threshold) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { x: offset.x + left, y: offset.y + top, width: right - left + 1, height: bottom - top + 1 };
}

export const getAlphaBounds = alphaBounds;

export function createTransparentMask(image: RgbaImage, threshold = 0): MaskData {
  assertImage(image);
  if (!finite(threshold) || threshold < 0 || threshold > 255) throw new RangeError("alpha 阈值必须在 0 到 255 之间");
  const data = new Uint8ClampedArray(image.width * image.height);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = image.data[index * 4 + 3] <= threshold ? 255 : 0;
  }
  return { width: image.width, height: image.height, data };
}

export const createTransparentRegionMask = createTransparentMask;

export function createMaskState(strokes: MaskStroke[] = []): MaskState {
  return { strokes: strokes.map(cloneStroke), undone: [] };
}

function cloneStroke(stroke: MaskStroke): MaskStroke {
  return { ...stroke, points: stroke.points.map((point) => ({ ...point })) };
}

export function addMaskStroke(state: MaskState, stroke: MaskStroke): MaskState {
  if (!finite(stroke.radius) || stroke.radius <= 0 || stroke.points.length === 0) throw new RangeError("蒙版笔刷参数无效");
  return { strokes: [...state.strokes.map(cloneStroke), cloneStroke(stroke)], undone: [] };
}

export function undoMaskStroke(state: MaskState): MaskState {
  if (state.strokes.length === 0) return { strokes: [], undone: state.undone.map(cloneStroke) };
  const strokes = state.strokes.map(cloneStroke);
  const removed = strokes.pop()!;
  return { strokes, undone: [removed, ...state.undone.map(cloneStroke)] };
}

export function redoMaskStroke(state: MaskState): MaskState {
  if (state.undone.length === 0) return createMaskState(state.strokes);
  const undone = state.undone.map(cloneStroke);
  const restored = undone.shift()!;
  return { strokes: [...state.strokes.map(cloneStroke), restored], undone };
}

function maskValues(mask: PendingCandidate["mask"], width: number, height: number): Uint8Array | Uint8ClampedArray | undefined {
  if (!mask) return undefined;
  const values = typeof mask === "object" && "data" in mask ? mask.data : mask;
  if (values.length !== width * height) throw new RangeError("蒙版尺寸与 patch 不匹配");
  return values;
}

export function compositePatch(
  base: RgbaImage,
  patch: RgbaImage,
  viewport: GenerationViewport,
  mask?: PendingCandidate["mask"],
): { image: RgbaImage; worldRect: WorldRect } {
  assertImage(base);
  assertImage(patch);
  assertFiniteRect(viewport);
  if (viewport.width <= 0 || viewport.height <= 0) throw new RangeError("patch viewport 必须有正的宽高");
  const values = maskValues(mask, patch.width, patch.height);
  const worldRect = {
    x: Math.floor(Math.min(0, viewport.x)),
    y: Math.floor(Math.min(0, viewport.y)),
    width: Math.ceil(Math.max(base.width, viewport.x + viewport.width)) - Math.floor(Math.min(0, viewport.x)),
    height: Math.ceil(Math.max(base.height, viewport.y + viewport.height)) - Math.floor(Math.min(0, viewport.y)),
  };
  const image = createRgbaImage(worldRect.width, worldRect.height);
  const baseOffsetX = -worldRect.x;
  const baseOffsetY = -worldRect.y;
  for (let y = 0; y < base.height; y += 1) {
    for (let x = 0; x < base.width; x += 1) {
      const sourceIndex = (y * base.width + x) * 4;
      const targetIndex = ((y + baseOffsetY) * image.width + x + baseOffsetX) * 4;
      image.data.set(base.data.subarray(sourceIndex, sourceIndex + 4), targetIndex);
    }
  }
  const drawWidth = Math.max(1, Math.ceil(viewport.width));
  const drawHeight = Math.max(1, Math.ceil(viewport.height));
  const targetLeft = Math.floor(viewport.x) - worldRect.x;
  const targetTop = Math.floor(viewport.y) - worldRect.y;
  for (let y = 0; y < drawHeight; y += 1) {
    const sourceY = Math.min(patch.height - 1, Math.floor((y / drawHeight) * patch.height));
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceX = Math.min(patch.width - 1, Math.floor((x / drawWidth) * patch.width));
      const targetX = targetLeft + x;
      const targetY = targetTop + y;
      if (targetX < 0 || targetY < 0 || targetX >= image.width || targetY >= image.height) continue;
      const sourcePixel = sourceY * patch.width + sourceX;
      const sourceIndex = sourcePixel * 4;
      const targetIndex = (targetY * image.width + targetX) * 4;
      const coverage = values ? values[sourcePixel] / 255 : 1;
      const sourceAlpha = (patch.data[sourceIndex + 3] / 255) * coverage;
      if (sourceAlpha <= 0) continue;
      const destinationAlpha = image.data[targetIndex + 3] / 255;
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const source = patch.data[sourceIndex + channel] / 255;
        const destination = image.data[targetIndex + channel] / 255;
        image.data[targetIndex + channel] = outputAlpha === 0 ? 0 : Math.round(((source * sourceAlpha) + (destination * destinationAlpha * (1 - sourceAlpha))) / outputAlpha * 255);
      }
      image.data[targetIndex + 3] = Math.round(outputAlpha * 255);
    }
  }
  return { image, worldRect };
}

export function applyPendingCandidate(document: EditorDocument, candidate: PendingCandidate): EditorDocument {
  const result = compositePatch(document.image, candidate.patch, {
    x: candidate.viewport.x - document.worldRect.x,
    y: candidate.viewport.y - document.worldRect.y,
    width: candidate.viewport.width,
    height: candidate.viewport.height,
  }, candidate.mask);
  return {
    ...document,
    image: result.image,
    worldRect: {
      x: document.worldRect.x + result.worldRect.x,
      y: document.worldRect.y + result.worldRect.y,
      width: result.worldRect.width,
      height: result.worldRect.height,
    },
    revision: document.revision + 1,
  };
}

export function createReviewSession(base: EditorDocument, candidate: PendingCandidate): ReviewSession {
  return { status: "review", base: cloneDocument(base), candidate: cloneCandidate(candidate) };
}

function cloneCandidate(candidate: PendingCandidate): PendingCandidate {
  return {
    ...candidate,
    patch: cloneImage(candidate.patch),
    viewport: { ...candidate.viewport },
    mask: candidate.mask && (typeof candidate.mask === "object" && "data" in candidate.mask
      ? { ...candidate.mask, data: new Uint8ClampedArray(candidate.mask.data) }
      : new Uint8ClampedArray(candidate.mask)),
  };
}

function cloneDocument(document: EditorDocument): EditorDocument {
  return { ...document, image: cloneImage(document.image), worldRect: { ...document.worldRect }, source: document.source && { ...document.source } };
}

export function applyReviewSession(session: ReviewSession): { document: EditorDocument; session: ReviewSession } {
  if (session.status !== "review") throw new Error("当前没有待确认候选结果");
  return { document: applyPendingCandidate(session.base, session.candidate), session: { ...session, status: "applied" } };
}

export function discardReviewSession(session: ReviewSession): ReviewSession {
  return { ...session, status: "discarded", candidate: cloneCandidate(session.candidate) };
}

export function toTransparentExport(image: RgbaImage): RgbaImage {
  return cloneImage(image);
}

export function toWhiteBackgroundExport(image: RgbaImage): RgbaImage {
  assertImage(image);
  const result = createRgbaImage(image.width, image.height);
  for (let index = 0; index < image.width * image.height; index += 1) {
    const source = index * 4;
    const alpha = image.data[source + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      result.data[source + channel] = Math.round(image.data[source + channel] * alpha + 255 * (1 - alpha));
    }
    result.data[source + 3] = 255;
  }
  return result;
}

export const prepareTransparentExport = toTransparentExport;
export const prepareWhiteBackgroundExport = toWhiteBackgroundExport;
