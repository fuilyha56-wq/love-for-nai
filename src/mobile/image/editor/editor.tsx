"use client";
import { CharacterEditReferenceCard, characterReferencePayload } from "@/app/ui/character-edit-reference";
import { supportsCharacterReferenceEdit } from "@/lib/character-reference";
import { waitWithAbort } from "@/lib/abortable";

import { prepareInpaintMasks } from "@/lib/inpaint-mask";

import { filterTiledUpscaleModelOptions, generationModelFor, inpaintModelFor } from "@/lib/inpaint-model";
import { DEFAULT_CLIENT_MODEL_POLICY, filterNaiModelOptions, isNaiModelEnabledForPolicy, type ModelPolicy } from "@/lib/model-policy";
import { NAI_IMAGE_MODEL_OPTIONS, NAI_INPAINT_MODEL_OPTIONS } from "@/lib/nai-model-catalog";
import { normalizeImageModelSize, resolveImageModelCapabilities, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { NaturalImageSettings } from "../natural-image-settings";
import { saveEditorComposite } from "@/lib/editor-composite-history";
import { dataUrlToBlob, readImageHistoryMode, saveLocalImageHistory } from "@/lib/local-image-history";
import { lfnConfirm, lfnPrompt } from "@/mobile/ui/lfn-dialog";
import {
  createEditorHistoryBranch,
  createEditorHistoryRoot,
  deleteEditorHistoryNode,
  deleteEditorHistoryProject,
  listEditorHistory,
  loadEditorHistoryNode,
  saveEditorHistoryCheckpoint,
  editorHistoryChanged,
  type EditorHistoryOperation,
  type EditorHistoryBranch,
  type EditorHistoryNode,
  type EditorHistorySnapshot,
} from "@/lib/image-editor-history";
import { editorHistoryNodeDraft } from "@/lib/image-editor-record";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Eraser,
  GitBranch,
  History,
  Maximize2,
  Minus,
  Move,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  Settings2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import NextImage from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { PopupSelect, type SelectOption } from "@/mobile/ui/popup-select";
import { WheelNumberInput } from "@/mobile/ui/wheel-number";
import { syncEditorPromptToStudioForm } from "@/lib/image-studio-form";
import { ImageDownloadMenu } from "@/mobile/image-download-menu";
import { planImageTileUpscale, tileUpscaleConcurrencyLimit, type ImageUpscalePlan, type ImageUpscaleTile, type TileUpscaleFactor, type TileUpscaleGatewayCapacity } from "@/lib/image-tile-upscale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPendingCandidate,
  createEditorDocument,
  createRgbaImage,
  moveViewport,
  panCamera,
  resizeViewport,
  screenToWorld,
  worldRectToScreen,
  zoomCameraAt,
  type CameraState,
  type EditorDocument,
  type GenerationViewport,
  type MaskStroke,
  type PendingCandidate,
  type Point,
  type RgbaImage,
} from "@/lib/image-editor";
import {
  createEditorDraft,
  loadEditorDraft,
  saveEditorDraft,
  type EditorDraft,
} from "@/lib/image-editor-store";
import "./editor.css";

type EditorClientProps = { authenticated: boolean; userId?: number };
type EditorMode = "inpaint" | "canvas" | "tiled-upscale";
type Tool = "pan" | "brush" | "eraser" | "rectangle";
type EditorStroke = MaskStroke & { shape?: "freehand" | "rectangle" };
type TiledUpscaleRestore = { document: EditorDocument; viewport: GenerationViewport; camera: CameraState };
type TiledUpscaleCache = { sourceImage: RgbaImage; signature: string; tiles: Map<number, Blob> };
type TiledUpscaleProgress = { completed: number; total: number; active: number; concurrency: number; waiting: number; source: "Gateway" | "LFN" };
type DragState =
  | { kind: "pan"; screen: Point; camera: CameraState }
  | { kind: "pinch"; distance: number; midpoint: Point; camera: CameraState }
  | { kind: "viewport"; point: Point; viewport: GenerationViewport }
  | { kind: "resize"; point: Point; viewport: GenerationViewport; corner: "nw" | "ne" | "sw" | "se" }
  | { kind: "stroke"; stroke: EditorStroke };

function replaceEditorModeInAddress(mode: EditorMode, draftId?: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", mode);
  if (draftId) url.searchParams.set("draftId", draftId);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

const DEFAULT_WIDTH = 832;
const DEFAULT_HEIGHT = 1216;
const MASK_COLORS = ["#a83a4c", "#2d7567", "#6c7fff", "#b47c2a", "#f783ac"];
type InpaintModelOption = readonly [string, string];
const INPAINT_MODELS: readonly InpaintModelOption[] = NAI_INPAINT_MODEL_OPTIONS;
const SAMPLERS = [
  ["k_euler_ancestral", "欧拉祖先"],
  ["k_euler", "欧拉"],
  ["k_dpmpp_2s_ancestral", "DPM++ 2S 祖先"],
  ["k_dpmpp_2m", "DPM++ 2M"],
] as const;

async function dataUrlToRgba(dataUrl: string, output?: { width: number; height: number }): Promise<RgbaImage> {
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await image.decode();
  if (output && (image.naturalWidth !== output.width || image.naturalHeight !== output.height)) {
    throw new Error(`接口返回图片为 ${image.naturalWidth}×${image.naturalHeight}，与请求的 ${output.width}×${output.height} 不一致。为避免拉伸损失，未应用结果，请调整输出尺寸后重试。`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = output?.width || image.naturalWidth;
  canvas.height = output?.height || image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return createRgbaImage(canvas.width, canvas.height, pixels.data);
}

function cropRgbaImage(image: RgbaImage, tile: ImageUpscaleTile): RgbaImage {
  const crop = createRgbaImage(tile.sourceWidth, tile.sourceHeight);
  for (let y = 0; y < tile.sourceHeight; y += 1) {
    const sourceStart = ((tile.sourceY + y) * image.width + tile.sourceX) * 4;
    const targetStart = y * tile.sourceWidth * 4;
    crop.data.set(image.data.subarray(sourceStart, sourceStart + tile.sourceWidth * 4), targetStart);
  }
  return crop;
}

async function stitchUpscaleTiles(plan: ImageUpscalePlan, generated: Map<number, Blob>): Promise<RgbaImage> {
  const canvas = window.document.createElement("canvas");
  canvas.width = plan.outputWidth;
  canvas.height = plan.outputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  for (const tile of plan.tiles) {
    const blob = generated.get(tile.index);
    if (!blob) throw new Error(`分块 ${tile.index + 1} 尚未生成`);
    const output = await createImageBitmap(blob);
    try {
      const scaleX = output.width / tile.sourceWidth;
      const scaleY = output.height / tile.sourceHeight;
      const sourceX = (tile.coreX - tile.sourceX) * scaleX;
      const sourceY = (tile.coreY - tile.sourceY) * scaleY;
      const sourceWidth = tile.coreWidth * scaleX;
      const sourceHeight = tile.coreHeight * scaleY;
      context.drawImage(
        output,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        tile.coreX * plan.scale,
        tile.coreY * plan.scale,
        tile.coreWidth * plan.scale,
        tile.coreHeight * plan.scale,
      );
    } finally {
      output.close();
    }
  }
  return { width: plan.outputWidth, height: plan.outputHeight, data: context.getImageData(0, 0, plan.outputWidth, plan.outputHeight).data };
}

function rgbaToDataUrl(image: RgbaImage, white = false): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  const output = white ? new Uint8ClampedArray(image.data) : image.data;
  if (white) {
    for (let index = 0; index < image.width * image.height; index += 1) {
      const offset = index * 4;
      const alpha = output[offset + 3] / 255;
      output[offset] = Math.round(output[offset] * alpha + 255 * (1 - alpha));
      output[offset + 1] = Math.round(output[offset + 1] * alpha + 255 * (1 - alpha));
      output[offset + 2] = Math.round(output[offset + 2] * alpha + 255 * (1 - alpha));
      output[offset + 3] = 255;
    }
  }
  context.putImageData(new ImageData(imageDataArray(output), image.width, image.height), 0, 0);
  return canvas.toDataURL("image/png");
}

function imageDataArray(data: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.length);
}

function rgbaImageToBlob(image: RgbaImage, white = false): Promise<Blob> {
  const canvas = window.document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("当前浏览器不支持 Canvas"));
  const pixels = white ? new Uint8ClampedArray(image.data) : image.data;
  if (white) {
    for (let index = 0; index < image.width * image.height; index += 1) {
      const offset = index * 4;
      const alpha = pixels[offset + 3] / 255;
      pixels[offset] = Math.round(pixels[offset] * alpha + 255 * (1 - alpha));
      pixels[offset + 1] = Math.round(pixels[offset + 1] * alpha + 255 * (1 - alpha));
      pixels[offset + 2] = Math.round(pixels[offset + 2] * alpha + 255 * (1 - alpha));
      pixels[offset + 3] = 255;
    }
  }
  context.putImageData(new ImageData(imageDataArray(pixels), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("无法导出 PNG 图片"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function maskToPngDataUrl(values: ArrayLike<number>, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = values[index];
  }
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

function maskedPatchDataUrl(candidate: PendingCandidate): string {
  const rawMask = candidate.mask && typeof candidate.mask === "object" && "data" in candidate.mask
    ? candidate.mask.data
    : candidate.mask;
  const patch = rawMask ? createRgbaImage(candidate.patch.width, candidate.patch.height, candidate.patch.data) : candidate.patch;
  if (rawMask) {
    for (let index = 0; index < patch.width * patch.height; index += 1) {
      patch.data[index * 4 + 3] = Math.round(patch.data[index * 4 + 3] * (rawMask[index] / 255));
    }
  }
  return rgbaToDataUrl(patch);
}

function hexChannels(color: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "a83a4c";
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

function createEditorId(): string {
  const values = new Uint32Array(2);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(values);
  else {
    values[0] = Math.floor(Math.random() * 2 ** 32);
    values[1] = Math.floor(Math.random() * 2 ** 32);
  }
  return `editor-${Date.now().toString(36)}-${values[0].toString(36)}${values[1].toString(36)}`;
}

function imageFromDraft(draft: EditorDraft): EditorDocument {
  return {
    ...draft.document,
    image: createRgbaImage(draft.document.image.width, draft.document.image.height, draft.document.image.data),
    worldRect: { ...draft.document.worldRect },
  };
}

export function normalizeEditorOutputSize(model: string, width: number, height: number, protocol?: ImageProviderProtocol): { width: number; height: number } {
  const capabilities = resolveImageModelCapabilities(model, protocol);
  const valid = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
  width = valid(width, DEFAULT_WIDTH); height = valid(height, DEFAULT_HEIGHT);
  if (capabilities.promptStyle === "tags") return normalizeImageModelSize(model, width, height, protocol);
  const normalized = normalizeImageModelSize(model, width, height, protocol);
  if (capabilities.sizes.length || capabilities.sizeConstraints) return normalized;
  const maxEdge = 4096, maxPixels = 8_294_400, step = 16;
  const scale = Math.min(1, maxEdge / Math.max(normalized.width, normalized.height), Math.sqrt(maxPixels / (normalized.width * normalized.height)));
  let w = Math.max(step, Math.min(maxEdge, Math.round(normalized.width * scale / step) * step));
  let h = Math.max(step, Math.min(maxEdge, Math.round(normalized.height * scale / step) * step));
  while (w * h > maxPixels) { if (w >= h) w -= step; else h -= step; }
  return { width: w, height: h };
}

export function viewportImage(document: EditorDocument, viewport: GenerationViewport, output: { width: number; height: number }): { image: RgbaImage; mask: Uint8ClampedArray } {
  // Callers normalize once for the selected model; image, mask and request share these dimensions.
  const { width, height } = output;
  const image = createRgbaImage(width, height);
  const mask = new Uint8ClampedArray(width * height);
  const sourceLeft = document.worldRect.x;
  const sourceTop = document.worldRect.y;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const worldX = viewport.x + (x / width) * viewport.width;
      const worldY = viewport.y + (y / height) * viewport.height;
      const sourceX = worldX - sourceLeft;
      const sourceY = worldY - sourceTop;
      const target = (y * width + x) * 4;
      if (sourceX < 0 || sourceY < 0 || sourceX >= document.image.width || sourceY >= document.image.height) {
        mask[y * width + x] = 255;
        continue;
      }
      const source = (Math.floor(sourceY) * document.image.width + Math.floor(sourceX)) * 4;
      image.data.set(document.image.data.subarray(source, source + 4), target);
      if (document.image.data[source + 3] < 250) mask[y * width + x] = 255;
    }
  }
  return { image, mask };
}

function applyStrokes(mask: Uint8ClampedArray, width: number, height: number, viewport: GenerationViewport, strokes: EditorStroke[]): void {
  const scaleX = width / viewport.width;
  const scaleY = height / viewport.height;
  const paint = (x: number, y: number, value: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = value;
  };
  for (const stroke of strokes) {
    const value = stroke.mode === "erase" ? 0 : 255;
    if (stroke.shape === "rectangle" && stroke.points.length >= 2) {
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];
      const left = Math.max(0, Math.floor((Math.min(start.x, end.x) - viewport.x) * scaleX));
      const top = Math.max(0, Math.floor((Math.min(start.y, end.y) - viewport.y) * scaleY));
      const right = Math.min(width, Math.ceil((Math.max(start.x, end.x) - viewport.x) * scaleX));
      const bottom = Math.min(height, Math.ceil((Math.max(start.y, end.y) - viewport.y) * scaleY));
      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) paint(x, y, value);
      continue;
    }
    const radius = Math.max(1, (stroke.radius / 2) * ((scaleX + scaleY) / 2));
    for (let index = 0; index < stroke.points.length; index += 1) {
      const previous = stroke.points[Math.max(0, index - 1)];
      const point = stroke.points[index];
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));
      for (let step = 0; step <= steps; step += 1) {
        const cx = Math.round((previous.x + (point.x - previous.x) * (step / steps) - viewport.x) * scaleX);
        const cy = Math.round((previous.y + (point.y - previous.y) * (step / steps) - viewport.y) * scaleY);
        for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y += 1) {
          for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x += 1) {
            if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) paint(x, y, value);
          }
        }
      }
    }
  }
}

export function fitViewport(document: EditorDocument, width: number, height: number): GenerationViewport {
  const natural = resolveImageModelCapabilities(document.generation?.model || "nai-v5-full", document.generation?.imageProtocol).promptStyle === "natural";
  const sourceWidth = natural ? document.image.width : Math.max(64, Math.min(resolveImageModelCapabilities(document.generation?.model || "nai-v5-full", document.generation?.imageProtocol).sizeConstraints?.maxEdge || 49152, document.image.width));
  const sourceHeight = natural ? document.image.height : Math.max(64, Math.min(resolveImageModelCapabilities(document.generation?.model || "nai-v5-full", document.generation?.imageProtocol).sizeConstraints?.maxEdge || 49152, document.image.height));
  const aspect = width / height;
  let viewportWidth = sourceWidth;
  let viewportHeight = Math.max(1, Math.round(viewportWidth / aspect));
  if (viewportHeight > sourceHeight) {
    viewportHeight = sourceHeight;
    viewportWidth = Math.max(1, Math.round(viewportHeight * aspect));
  }
  return {
    x: document.worldRect.x + Math.round((sourceWidth - viewportWidth) / 2),
    y: document.worldRect.y + Math.round((sourceHeight - viewportHeight) / 2),
    width: viewportWidth,
    height: viewportHeight,
  };
}

function parseDataUrlResult(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("data:image/")) return value;
  return null;
}

async function readGenerationResponse(response: Response): Promise<string> {
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      text += decoder.decode(value || new Uint8Array(), { stream: !done });
      if (done) break;
    }
    const events = text.split("\n\n");
    for (const event of events.reverse()) {
      const line = event.split("\n").find((entry) => entry.startsWith("data:"));
      if (!line) continue;
      try {
        const payload = JSON.parse(line.slice(5).trim()) as { images?: unknown[]; image?: unknown; message?: string };
        const image = Array.isArray(payload.images) ? payload.images.find(parseDataUrlResult) : payload.image;
        const result = parseDataUrlResult(image);
        if (result) return result;
        if (payload.message) throw new Error(payload.message);
      } catch (error) {
        if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
      }
    }
    throw new Error("流式响应没有返回图像");
  }
  const payload = (await response.json()) as { images?: unknown[]; image?: unknown; message?: string };
  if (!response.ok) throw new Error(payload.message || "图像生成失败");
  const image = Array.isArray(payload.images) ? payload.images.find(parseDataUrlResult) : payload.image;
  const result = parseDataUrlResult(image);
  if (!result) throw new Error(payload.message || "生成结果为空");
  return result;
}

export default function EditorClient({ authenticated, userId }: EditorClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draftId");
  const requestedMode = searchParams.get("mode");
  const requestedReturn = searchParams.get("returnTo") || "";
  const returnHref = /^\/image\/editor\/history(?:\?[^#]*)?$/.test(requestedReturn) && requestedReturn.length < 2048 ? requestedReturn : "/image";
  const returnLabel = returnHref === "/image" ? "返回工作台" : "返回重绘历史";
  const mode: EditorMode = requestedMode === "canvas" ? "canvas" : requestedMode === "tiled-upscale" ? "tiled-upscale" : "inpaint";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCanvasCacheRef = useRef<{ image: RgbaImage; canvas: HTMLCanvasElement } | null>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewportRef = useRef<GenerationViewport | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [viewport, setViewport] = useState<GenerationViewport | null>(null);
  const [camera, setCamera] = useState<CameraState>({ x: 0, y: 0, zoom: 0.5 });
  const [tool, setTool] = useState<Tool>("pan");
  const [brushSize, setBrushSize] = useState(80);
  const [maskColor, setMaskColor] = useState("#a83a4c");
  const [maskOpacity, setMaskOpacity] = useState(52);
  const [showMaskPreview, setShowMaskPreview] = useState(true);
  const [canvasBackground, setCanvasBackground] = useState<"checker" | "white" | "dark">("checker");
  const [mobileSheet, setMobileSheet] = useState<"tools" | "generate" | "canvas" | "history" | null>("tools");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState("");
  const [strokes, setStrokes] = useState<EditorStroke[]>([]);
  const [undone, setUndone] = useState<EditorStroke[]>([]);
  const [pending, setPending] = useState<PendingCandidate | null>(null);
  const [compare, setCompare] = useState(0.5);
  const [tileScale, setTileScale] = useState<TileUpscaleFactor>(2);
  const [tileProgress, setTileProgress] = useState<TiledUpscaleProgress | null>(null);
  const [gatewayImageCapacity, setGatewayImageCapacity] = useState<TileUpscaleGatewayCapacity | null>(null);
  const [gatewayCapacityChecked, setGatewayCapacityChecked] = useState(false);
  const gatewayImageCapacityRef = useRef<TileUpscaleGatewayCapacity | null>(null);
  const [tileSourceState, setTileSourceState] = useState<EditorDocument | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [busy, setBusy] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyBranches, setHistoryBranches] = useState<EditorHistoryBranch[]>([]);
  const [historyNodes, setHistoryNodes] = useState<EditorHistoryNode[]>([]);
  const [activeHistoryBranchId, setActiveHistoryBranchId] = useState("");
  const [currentHistoryNodeId, setCurrentHistoryNodeId] = useState("");
  const activeHistoryBranchIdRef = useRef("");
  const currentHistoryNodeIdRef = useRef("");
  const historyClearedRef = useRef(false);
  const historySkipAutoRef = useRef(false);
  const historyFingerprintRef = useRef("");
  const historyCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const historyObjectIdentityRef = useRef(new WeakMap<object, number>());
  const nextHistoryObjectIdentityRef = useRef(1);
  const [imageHistoryMode, setImageHistoryMode] = useState<import("@/lib/local-image-history").ImageHistoryMode>("account");
  useEffect(() => {
    const syncMode = () => setImageHistoryMode(readImageHistoryMode());
    syncMode();
    window.addEventListener("lfn-image-history-mode", syncMode);
    return () => window.removeEventListener("lfn-image-history-mode", syncMode);
  }, []);
  const [viewportSize, setViewportSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [model, setModel] = useState("nai-v5-inpaint");
  const [modelPolicy, setModelPolicy] = useState<ModelPolicy>(DEFAULT_CLIENT_MODEL_POLICY);
  const [availableInpaintModels, setAvailableInpaintModels] = useState<readonly InpaintModelOption[]>(INPAINT_MODELS);
  const [tiledModelCatalog, setTiledModelCatalog] = useState<{ key: string; options: SelectOption[] } | null>(null);
  const [tiledModelCatalogError, setTiledModelCatalogError] = useState<{ key: string; message: string } | null>(null);
  const tiledRestoreRef = useRef<TiledUpscaleRestore | null>(null);
  const tileCacheRef = useRef<TiledUpscaleCache | null>(null);
  const tiledRunLockRef = useRef(false);
  const editorGenerationAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => editorGenerationAbortRef.current?.abort(), []);
  const [imageQuality, setImageQuality] = useState("auto");
  const [imageResolution, setImageResolution] = useState("1K");
  const [imageBackground, setImageBackground] = useState("auto");
  const imageProtocol = document?.generation?.imageProtocol;
  const imageProviderId = document?.generation?.providerId || "newapi";
  const tiledModelSourceReady = Boolean(document);
  const tiledModelSourceKey = `${imageProviderId}:${imageProtocol || "auto"}`;
  const tiledModelsLoading = tiledModelSourceReady && mode === "tiled-upscale" && tiledModelCatalog?.key !== tiledModelSourceKey && tiledModelCatalogError?.key !== tiledModelSourceKey;
  const tiledModelsError = tiledModelCatalogError?.key === tiledModelSourceKey ? tiledModelCatalogError.message : "";
  const modelCapabilities = resolveImageModelCapabilities(model, imageProtocol);
  const naturalImageModel = modelCapabilities.promptStyle === "natural";
  const generationModel = generationModelFor(model);
  const refreshGatewayImageCapacity = useCallback(async (signal?: AbortSignal): Promise<TileUpscaleGatewayCapacity | null> => {
    try {
      const response = await fetch("/api/image-capacity", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Gateway capacity unavailable");
      const result = await response.json() as { available?: boolean; capacity?: TileUpscaleGatewayCapacity };
      const capacity = result.available && result.capacity ? result.capacity : null;
      if (signal?.aborted) return null;
      gatewayImageCapacityRef.current = capacity;
      setGatewayImageCapacity(capacity);
      return capacity;
    } catch {
      if (!signal?.aborted) {
        gatewayImageCapacityRef.current = null;
        setGatewayImageCapacity(null);
      }
      return null;
    } finally {
      if (!signal?.aborted) setGatewayCapacityChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!authenticated || mode !== "tiled-upscale" || imageProviderId !== "newapi" || generating) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => refreshGatewayImageCapacity(controller.signal));
    const timer = window.setInterval(() => void refreshGatewayImageCapacity(controller.signal), 5_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [authenticated, generating, imageProviderId, mode, refreshGatewayImageCapacity]);
  const refreshModelPolicy = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/public/image-policy", { cache: "no-store", signal });
      if (!response.ok) return;
      const result = await response.json() as Partial<ModelPolicy>;
      if (typeof result.enableV5Models !== "boolean" || typeof result.enableV45Models !== "boolean") return;
      setModelPolicy({ enableV5Models: result.enableV5Models, enableV45Models: result.enableV45Models });
    } catch {
      // Keep the conservative client policy until the next refresh.
    }
  }, []);

  const refreshInpaintModels = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/public/catalog", { cache: "no-store", signal });
      const result = await response.json() as { models?: Array<{ id?: string; kind?: string }> };
      if (signal?.aborted) return;
      const ids = new Set((result.models || [])
        .filter((item) => item.kind === "image" && typeof item.id === "string")
        .map((item) => item.id as string));
      const catalogOptions = INPAINT_MODELS.filter(([id]) => ids.has(id));
      // A catalog outage must not erase the usable legacy list.
      if (catalogOptions.length) setAvailableInpaintModels(catalogOptions);
    } catch {
      // Keep the static list when the public catalog is unavailable.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refreshModelPolicy(controller.signal));
    void Promise.resolve().then(() => refreshInpaintModels(controller.signal));
    const refresh = () => {
      void refreshModelPolicy();
      void refreshInpaintModels();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [refreshInpaintModels, refreshModelPolicy]);

  useEffect(() => {
    const filtered = filterNaiModelOptions(
      availableInpaintModels.map(([value, label]) => ({ value, label })),
      modelPolicy,
    );
    if (mode !== "tiled-upscale" && filtered.length) {
      void Promise.resolve().then(() => setModel((current) => current.startsWith("nai-") && !filtered.some(({ value }) => value === current) ? filtered[0].value : current));
    }
  }, [availableInpaintModels, modelPolicy, mode]);

  useEffect(() => {
    if (!tiledModelSourceReady || mode !== "tiled-upscale") return;
    const controller = new AbortController();
    const load = async () => {
      try {
        if (imageProviderId === "novelai") {
          await Promise.resolve();
          if (!controller.signal.aborted) {
            setTiledModelCatalog({ key: tiledModelSourceKey, options: NAI_IMAGE_MODEL_OPTIONS.filter(({ value }) => !value.endsWith("-limit")) });
            setTiledModelCatalogError(null);
          }
          return;
        }
        const url = imageProviderId === "newapi"
          ? "/api/models"
          : `/api/providers/models?providerId=${encodeURIComponent(imageProviderId)}`;
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { items?: Array<{ id?: string; kind?: string }>; message?: string; warning?: string };
        if (!response.ok) throw new Error(result.message || "无法读取当前来源的图像模型");
        const options = (result.items || [])
          .filter((item) => (item.kind === "图像模型" || item.kind === "image") && typeof item.id === "string")
          .map((item) => ({ value: item.id as string, label: item.id as string }));
        if (controller.signal.aborted) return;
        setTiledModelCatalog({ key: tiledModelSourceKey, options });
        if (result.warning) setTiledModelCatalogError({ key: tiledModelSourceKey, message: result.warning });
        else if (!options.length) setTiledModelCatalogError({ key: tiledModelSourceKey, message: "当前来源没有返回图像模型；仍会保留当前模型。" });
        else setTiledModelCatalogError(null);
      } catch (error) {
        if (!controller.signal.aborted) setTiledModelCatalogError({ key: tiledModelSourceKey, message: error instanceof Error ? error.message : "无法读取当前来源的图像模型；仍会保留当前模型。" });
      }
    };
    void load();
    return () => controller.abort();
  }, [imageProviderId, imageProtocol, mode, tiledModelSourceKey, tiledModelSourceReady]);
  const outputSize = normalizeEditorOutputSize(model, viewportSize.width, viewportSize.height, imageProtocol);
  const outputStep = naturalImageModel ? modelCapabilities.sizeConstraints?.multipleOf || 16 : 64;
  const outputMaxEdge = modelCapabilities.sizeConstraints?.maxEdge || 4096;
  const effectiveImageQuality = modelCapabilities.qualityOptions.includes(imageQuality) ? imageQuality : "auto";
  const effectiveImageResolution = modelCapabilities.imageSizes.includes(imageResolution) ? imageResolution : "1K";
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [strength, setStrength] = useState(0.7);
  const [featherRadius, setFeatherRadius] = useState(0);
  const [sampler, setSampler] = useState("k_euler_ancestral");
  const [seed, setSeed] = useState("");
  const tileSourceDocument = tileSourceState || document;
  const tilePlanState = (() => {
    if (!tileSourceDocument) return { plan: null as ImageUpscalePlan | null, error: "" };
    try {
      return { plan: planImageTileUpscale(tileSourceDocument.image.width, tileSourceDocument.image.height, tileScale), error: "" };
    } catch (error) {
      return { plan: null as ImageUpscalePlan | null, error: error instanceof Error ? error.message : "当前尺寸无法分块" };
    }
  })();
  const usesGatewayImageCapacity = imageProviderId === "newapi" && /^nai-/i.test(generationModel);
  const liveTileConcurrency = usesGatewayImageCapacity && gatewayImageCapacity
    ? tileUpscaleConcurrencyLimit(generationModel, steps, gatewayImageCapacity)
    : 2;
  const tileCapacityDescription = usesGatewayImageCapacity
    ? gatewayImageCapacity
      ? `Gateway 实时可用 ${liveTileConcurrency} 路 · 启用 ${gatewayImageCapacity.total} 个账号 · V5 ${gatewayImageCapacity.v5} · V4.5 ${gatewayImageCapacity.v45} · 允许 Anlas ${gatewayImageCapacity.anlas}`
      : gatewayCapacityChecked ? "Gateway 实时容量暂不可用，按 LFN 默认 2 路调度" : "正在读取 Gateway 实时账号容量…"
    : "当前来源按 LFN 默认 2 路调度";
  const tileBillingDescription = usesGatewayImageCapacity && /^nai-v(?:5|4\.5)/i.test(generationModel)
    ? steps <= 28
      ? "每块都是 1 张、至多 28 步且不超过 1MP 的图生图请求，符合 Gateway Opus 免费档条件。"
      : "当前步数超过 28，每块可能消耗 Anlas；并发按 Gateway 允许 Anlas 的账号数实时调整。"
    : "每块会按所选来源的图生图规则计费；并发受当前来源的 LFN 限流控制。";
  const pendingPreviewUrl = useMemo(() => pending ? maskedPatchDataUrl(pending) : "", [pending]);
  const filteredInpaintModels = useMemo(
    () => filterNaiModelOptions(availableInpaintModels.map(([value, label]) => ({ value, label })), modelPolicy),
    [availableInpaintModels, modelPolicy],
  );
  const tiledModelOptions = useMemo(
    () => filterTiledUpscaleModelOptions(
      tiledModelCatalog?.key === tiledModelSourceKey ? tiledModelCatalog.options : [],
      generationModel,
      imageProtocol,
      modelPolicy,
    ),
    [tiledModelCatalog, tiledModelSourceKey, generationModel, imageProtocol, modelPolicy],
  );
  const v45InpaintAvailable = filteredInpaintModels.some(({ value }) => value.startsWith("nai-v4.5-"));

  const fitCamera = useCallback((nextDocument: EditorDocument, nextViewport: GenerationViewport) => {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = {
      x: Math.min(nextDocument.worldRect.x, nextViewport.x) - 120,
      y: Math.min(nextDocument.worldRect.y, nextViewport.y) - 120,
      width: Math.max(nextDocument.worldRect.x + nextDocument.worldRect.width, nextViewport.x + nextViewport.width) - Math.min(nextDocument.worldRect.x, nextViewport.x) + 240,
      height: Math.max(nextDocument.worldRect.y + nextDocument.worldRect.height, nextViewport.y + nextViewport.height) - Math.min(nextDocument.worldRect.y, nextViewport.y) + 240,
    };
    const zoom = Math.max(0.12, Math.min(2, Math.min(stage.clientWidth / bounds.width, stage.clientHeight / bounds.height)));
    setCamera({ x: bounds.x + (bounds.width - stage.clientWidth / zoom) / 2, y: bounds.y + (bounds.height - stage.clientHeight / zoom) / 2, zoom });
  }, [setCamera]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!draftId) {
        setBusy(false);
        setNotice("请从工作台导入图片，或先选择一个编辑草稿。");
        return;
      }
      try {
        const entry = new URLSearchParams(window.location.search);
        const entryNodeId = entry.get("nodeId");
        const entryNode = entryNodeId ? await loadEditorHistoryNode(entryNodeId) : null;
        if (entryNodeId && (!entryNode || entryNode.draftId !== draftId)) throw new Error("所选历史节点不存在或不属于这个作品");
        const loaded = entryNode ? editorHistoryNodeDraft(entryNode, entry.get("branchId") || entryNode.branchId) : await loadEditorDraft(draftId);
        if (cancelled) return;
        if (!loaded) throw new Error("编辑草稿不存在或已过期");
        const nextDocument = imageFromDraft(loaded);
        const generation = nextDocument.generation;
        const output = normalizeEditorOutputSize(generation?.model || "nai-v5-full", generation?.width || DEFAULT_WIDTH, generation?.height || DEFAULT_HEIGHT, generation?.imageProtocol);
        const outputWidth = output.width;
        const outputHeight = output.height;
        const nextViewport = fitViewport(nextDocument, outputWidth, outputHeight);
        setDraft(loaded);
        setHistoryReady(false);
        setTileScale(loaded.historyTileScale || 2);
        setDocument(nextDocument);
        setViewport(nextViewport);
        setViewportSize({ width: outputWidth, height: outputHeight });
        setPrompt(nextDocument.prompt || "");
        setNegative(nextDocument.negativePrompt || "");
        if (!nextDocument.characterReference) syncEditorPromptToStudioForm(loaded.id, nextDocument.prompt || "", nextDocument.negativePrompt || "");
        const nextModel = inpaintModelFor(generation?.model || "nai-v5-full", generation?.imageProtocol);
        if (!nextModel) throw new Error(`当前模型 ${generation?.model} 没有对应的重绘模型，请返回工作台选择支持重绘的模型。`);
        setModel(nextModel);
        setImageQuality(generation?.quality || "auto");
        setImageResolution(generation?.imageSize || "1K");
        setImageBackground(generation?.background || "auto");
        setSteps(generation?.steps || 28);
        setScale(generation?.scale ?? 5);
        setStrength(generation?.strength ?? 0.7);
        setSampler(generation?.sampler || "k_euler_ancestral");
        setSeed(nextDocument.seed == null || Number(nextDocument.seed) === 0 ? "" : String(nextDocument.seed));
        if (loaded.workspace) {
          setViewport({ ...loaded.workspace.viewport, height: loaded.workspace.viewport.width / (outputWidth / outputHeight) });
          setCamera({ ...loaded.workspace.camera });
          setStrokes(loaded.workspace.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })));
          setUndone(loaded.workspace.undone.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })));
          setTool(loaded.workspace.tool);
          setBrushSize(loaded.workspace.brushSize);
          setMaskColor(loaded.workspace.maskColor);
          setMaskOpacity(loaded.workspace.maskOpacity);
          setShowMaskPreview(loaded.workspace.showMaskPreview);
          setCanvasBackground(loaded.workspace.canvasBackground);
        }
        setReady(true);
        if (!loaded.workspace) setTimeout(() => fitCamera(nextDocument, nextViewport), 0);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "读取编辑草稿失败");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [draftId, fitCamera]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const screenViewport = useMemo(() => {
    if (!viewport) return null;
    return worldRectToScreen(viewport, camera);
  }, [viewport, camera]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || !document) return;
    const rect = stage.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = canvasBackground === "white" ? "#ffffff" : canvasBackground === "dark" ? "#202328" : "#d9d6ce";
    context.fillRect(0, 0, rect.width, rect.height);
    if (canvasBackground === "checker") {
      context.fillStyle = "#ece9e1";
      const size = 16;
      for (let y = 0; y < rect.height; y += size) for (let x = 0; x < rect.width; x += size) {
        if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) context.fillRect(x, y, size, size);
      }
    }
    const image = document.image;
    let cachedImageCanvas = imageCanvasCacheRef.current;
    if (!cachedImageCanvas || cachedImageCanvas.image !== image) {
      const imageCanvas = window.document.createElement("canvas");
      imageCanvas.width = image.width;
      imageCanvas.height = image.height;
      const imageContext = imageCanvas.getContext("2d");
      if (!imageContext) return;
      imageContext.putImageData(new ImageData(imageDataArray(image.data), image.width, image.height), 0, 0);
      cachedImageCanvas = { image, canvas: imageCanvas };
      imageCanvasCacheRef.current = cachedImageCanvas;
    }
    const imageRect = worldRectToScreen(document.worldRect, camera);
    context.imageSmoothingEnabled = true;
    context.drawImage(cachedImageCanvas.canvas, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    if (viewport && mode !== "tiled-upscale") {
      const frame = worldRectToScreen(viewport, camera);
      context.fillStyle = "rgba(0,0,0,.38)";
      context.fillRect(0, 0, rect.width, frame.y);
      context.fillRect(0, frame.y, frame.x, frame.height);
      context.fillRect(frame.x + frame.width, frame.y, rect.width - frame.x - frame.width, frame.height);
      context.fillRect(0, frame.y + frame.height, rect.width, rect.height - frame.y - frame.height);
      const maskWidth = Math.max(1, Math.round(viewport.width));
      const maskHeight = Math.max(1, Math.round(viewport.height));
      const previewMask = new Uint8ClampedArray(maskWidth * maskHeight);
      applyStrokes(previewMask, maskWidth, maskHeight, viewport, strokes);
      const maskCanvas = window.document.createElement("canvas");
      maskCanvas.width = maskWidth;
      maskCanvas.height = maskHeight;
      const maskContext = maskCanvas.getContext("2d");
      if (maskContext && showMaskPreview) {
        const [red, green, blue] = hexChannels(maskColor);
        const overlay = new Uint8ClampedArray(maskCanvas.width * maskCanvas.height * 4);
        for (let index = 0; index < previewMask.length; index += 1) {
          const offset = index * 4;
          overlay[offset] = red;
          overlay[offset + 1] = green;
          overlay[offset + 2] = blue;
          overlay[offset + 3] = Math.round(previewMask[index] * (maskOpacity / 100));
        }
        maskContext.putImageData(new ImageData(overlay, maskCanvas.width, maskCanvas.height), 0, 0);
        context.drawImage(maskCanvas, frame.x, frame.y, frame.width, frame.height);
      }
    }
  }, [camera, canvasBackground, document, maskColor, maskOpacity, mode, showMaskPreview, strokes, viewport]);

  useEffect(() => {
    render();
    const observer = new ResizeObserver(render);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    const initialViewport = viewportRef.current;
    if (!document || !initialViewport) return;
    let previousWidth = 0;
    let previousHeight = 0;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect || { width: 0, height: 0 };
      if (width < 1 || height < 1) return;
      const changed = previousWidth === 0 || previousHeight === 0 || Math.abs(width - previousWidth) >= 40 || Math.abs(height - previousHeight) >= 40;
      previousWidth = width;
      previousHeight = height;
      if (changed) requestAnimationFrame(() => fitCamera(document, viewportRef.current || initialViewport));
    });
    if (stageRef.current) observer.observe(stageRef.current);
    const frame = requestAnimationFrame(() => fitCamera(document, viewportRef.current || initialViewport));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [document, fitCamera]);

  const worldPoint = (event: React.PointerEvent): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, camera);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!document || !viewport || generating || pending) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      dragRef.current = {
        kind: "pinch",
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
        camera,
      };
      return;
    }
    const point = worldPoint(event);
    if (tool === "pan") {
      dragRef.current = { kind: "pan", screen: { x: event.clientX, y: event.clientY }, camera };
    } else {
      const stroke: EditorStroke = {
        points: [point],
        radius: brushSize,
        mode: tool === "eraser" ? "erase" : "add",
        shape: tool === "rectangle" ? "rectangle" : "freehand",
      };
      setStrokes((current) => [...current, stroke]);
      dragRef.current = { kind: "stroke", stroke };
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || generating || pending) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const point = worldPoint(event);
    if (drag.kind === "pinch" && pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const rect = stageRef.current?.getBoundingClientRect();
      const anchor = { x: midpoint.x - (rect?.left || 0), y: midpoint.y - (rect?.top || 0) };
      const zoomed = zoomCameraAt(drag.camera, distance / drag.distance, anchor);
      setCamera(panCamera(zoomed, { x: midpoint.x - drag.midpoint.x, y: midpoint.y - drag.midpoint.y }));
    } else if (drag.kind === "pan") {
      const delta = { x: event.clientX - drag.screen.x, y: event.clientY - drag.screen.y };
      setCamera(panCamera(drag.camera, delta));
    } else if (drag.kind === "viewport") {
      const delta = { x: point.x - drag.point.x, y: point.y - drag.point.y };
      setViewport(moveViewport(drag.viewport, delta));
      dragRef.current = { ...drag, point, viewport: moveViewport(drag.viewport, delta) };
    } else if (drag.kind === "resize") {
      const next = resizeViewport(drag.viewport, drag.corner, point, { aspect: outputSize.width / outputSize.height, minWidth: 128, minHeight: 128 });
      setViewport(next);
    } else if (drag.kind === "stroke") {
      const next = { ...drag.stroke, points: [...drag.stroke.points, point] };
      dragRef.current = { kind: "stroke", stroke: next };
      setStrokes((current) => [...current.slice(0, -1), next]);
    }
  };

  const finishPointer = (event?: React.PointerEvent) => {
    if (event) pointersRef.current.delete(event.pointerId);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "stroke") setUndone([]);
    dragRef.current = null;
  };

  const beginViewportDrag = (event: React.PointerEvent, next: DragState) => {
    event.stopPropagation();
    if (generating || pending) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = next;
  };

  const synchronizeDocument = (nextDocument: EditorDocument): EditorDocument => {
    const savedModel = mode === "tiled-upscale" ? generationModel : model;
    const savedWidth = mode === "tiled-upscale" ? nextDocument.image.width : outputSize.width;
    const savedHeight = mode === "tiled-upscale" ? nextDocument.image.height : outputSize.height;
    return {
      ...nextDocument,
      prompt,
      negativePrompt: negative,
      seed: modelCapabilities.seed ? seed.trim() || null : null,
      generation: { ...nextDocument.generation, model: savedModel, quality: effectiveImageQuality, imageSize: effectiveImageResolution, background: imageBackground, width: savedWidth, height: savedHeight, steps, scale, strength, sampler, noiseSchedule: nextDocument.generation?.noiseSchedule || "native" },
    };
  };

  const createDraftPayload = (nextDocument: EditorDocument, review?: EditorDraft["review"]): EditorDraft => {
    const synchronized = synchronizeDocument(nextDocument);
    return {
      ...createEditorDraft(draft?.id || createEditorId(), mode === "canvas" ? "canvas" : "inpaint", synchronized, review),
      createdAt: draft?.createdAt || Date.now(),
      historyNodeId: currentHistoryNodeIdRef.current || undefined,
      historyBranchId: activeHistoryBranchIdRef.current || undefined,
      historyTileScale: tileScale,
      workspace: {
        viewport: { ...(viewport || nextDocument.worldRect) },
        camera: { ...camera },
        strokes: strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })),
        undone: undone.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })),
        tool,
        brushSize,
        maskColor,
        maskOpacity,
        showMaskPreview,
        canvasBackground,
      },
    };
  };

  const createHistorySnapshot = (nextDocument: EditorDocument): EditorHistorySnapshot => {
    // History autosave runs whenever editor state changes. Keep immutable state references
    // here; the IndexedDB layer clones the snapshot only when a checkpoint is committed.
    return {
      document: synchronizeDocument(nextDocument),
      workspace: {
        viewport: viewport || nextDocument.worldRect,
        camera,
        strokes,
        undone,
        tool,
        brushSize,
        maskColor,
        maskOpacity,
        showMaskPreview,
        canvasBackground,
      },
      mode,
      tileScale,
    };
  };

  const historyFingerprint = (snapshot: EditorHistorySnapshot): string => {
    const objectIdentity = (value: object): number => {
      let identity = historyObjectIdentityRef.current.get(value);
      if (!identity) {
        identity = nextHistoryObjectIdentityRef.current++;
        historyObjectIdentityRef.current.set(value, identity);
      }
      return identity;
    };
    const { image, ...documentMetadata } = snapshot.document;
    return JSON.stringify({
      imageId: objectIdentity(image),
      mode: snapshot.mode,
      tileScale: snapshot.tileScale,
      revision: snapshot.document.revision,
      documentMetadata,
      workspace: {
        viewportId: objectIdentity(snapshot.workspace.viewport),
        cameraId: objectIdentity(snapshot.workspace.camera),
        strokesId: objectIdentity(snapshot.workspace.strokes),
        undoneId: objectIdentity(snapshot.workspace.undone),
        tool: snapshot.workspace.tool,
        brushSize: snapshot.workspace.brushSize,
        maskColor: snapshot.workspace.maskColor,
        maskOpacity: snapshot.workspace.maskOpacity,
        showMaskPreview: snapshot.workspace.showMaskPreview,
        canvasBackground: snapshot.workspace.canvasBackground,
      },
    });
  };

  const persistHistorySnapshot = (
    snapshot: EditorHistorySnapshot,
    label: string,
    fingerprint: string,
    force = false,
    resultOperation?: EditorHistoryOperation,
  ): Promise<boolean> => {
    const work = historyCommitQueueRef.current.catch(() => undefined).then(async (): Promise<boolean> => {
      if (!force && fingerprint && fingerprint === historyFingerprintRef.current) return true;
      if (historyClearedRef.current && !resultOperation) {
        historyFingerprintRef.current = fingerprint;
        return true;
      }
      if (resultOperation) historyClearedRef.current = false;
      if (!draft?.id) return false;
      setHistoryBusy(true);
      try {
        let branchId = activeHistoryBranchIdRef.current;
        let parentId = currentHistoryNodeIdRef.current || null;
        if (!branchId || !parentId) {
          const root = await createEditorHistoryRoot(draft.id, snapshot);
          branchId = root.branch.id;
          parentId = root.node.id;
          activeHistoryBranchIdRef.current = branchId;
          currentHistoryNodeIdRef.current = parentId;
          setActiveHistoryBranchId(branchId);
          setCurrentHistoryNodeId(parentId);
          setHistoryBranches((current) => current.some((item) => item.id === branchId) ? current : [...current, root.branch]);
          setHistoryNodes((current) => current.some((item) => item.id === parentId) ? current : [...current, root.node].sort((a, b) => a.createdAt - b.createdAt));
          historyFingerprintRef.current = fingerprint;
          editorHistoryChanged();
          if (!resultOperation) return true;
        }
        const node = await saveEditorHistoryCheckpoint(draft.id, branchId, parentId, snapshot, label, { resultOperation });
        if (node.branchId !== branchId) {
          const refreshed = await listEditorHistory(draft.id);
          setHistoryBranches(refreshed.branches);
          activeHistoryBranchIdRef.current = node.branchId;
          setActiveHistoryBranchId(node.branchId);
        }
        currentHistoryNodeIdRef.current = node.id;
        historyFingerprintRef.current = fingerprint;
        setCurrentHistoryNodeId(node.id);
        setHistoryNodes((current) => current.some((item) => item.id === node.id) ? current : [...current, node].sort((a, b) => a.createdAt - b.createdAt));
        setHistoryBranches((current) => current.map((branch) => branch.id === node.branchId ? { ...branch, headId: node.id, updatedAt: node.createdAt } : branch));
        editorHistoryChanged();
        return true;
      } catch (error) {
        historyFingerprintRef.current = "";
        setNotice(`历史节点保存失败：${error instanceof Error ? error.message : "浏览器存储空间不足"}`);
        return false;
      } finally {
        setHistoryBusy(false);
      }
    });
    historyCommitQueueRef.current = work.then(() => undefined, () => undefined);
    return work;
  };

  const recordGeneratedCandidate = async (
    base: EditorDocument,
    candidate: PendingCandidate,
    resultOperation: EditorHistoryOperation,
  ) => {
    const parentNodeId = currentHistoryNodeIdRef.current;
    const parentBranchId = activeHistoryBranchIdRef.current;
    if (!historyReady || !draft?.id || !parentNodeId || !parentBranchId) {
      return { candidate, saved: false, attempted: false };
    }
    const resultDocument = applyPendingCandidate(base, candidate);
    const snapshot = createHistorySnapshot(resultDocument);
    snapshot.workspace = { ...snapshot.workspace, viewport: { ...candidate.viewport } };
    const saved = await persistHistorySnapshot(
      snapshot,
      candidate.historyLabel || `${resultOperation} · ${model}`,
      historyFingerprint(snapshot),
      true,
      resultOperation,
    );
    if (!saved) return { candidate, saved: false, attempted: true };
    return {
      candidate: {
        ...candidate,
        editorHistoryNodeId: currentHistoryNodeIdRef.current,
        editorHistoryParentNodeId: parentNodeId,
        editorHistoryBranchId: activeHistoryBranchIdRef.current,
        editorHistoryParentBranchId: parentBranchId,
      },
      saved: true,
      attempted: true,
    };
  };

  useEffect(() => {
    if (!ready || !draft?.id || !document || !viewport || historyReady) return;
    let active = true;
    void (async () => {
      let history = await listEditorHistory(draft.id);
      if (!history.branches.length) {
        await createEditorHistoryRoot(draft.id, createHistorySnapshot(document));
        history = await listEditorHistory(draft.id);
      }
      if (!active) return;
      const branch = history.branches.find((item) => item.id === draft.historyBranchId)
        || [...history.branches].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!branch) throw new Error("无法建立编辑历史分支");
      setHistoryBranches(history.branches);
      setHistoryNodes(history.nodes);
      activeHistoryBranchIdRef.current = branch.id;
      const selectedNodeId = history.nodes.some((node) => node.id === draft.historyNodeId) ? draft.historyNodeId! : branch.headId;
      currentHistoryNodeIdRef.current = selectedNodeId;
      setActiveHistoryBranchId(branch.id);
      setCurrentHistoryNodeId(selectedNodeId);
      historyFingerprintRef.current = historyFingerprint(createHistorySnapshot(document));
      historySkipAutoRef.current = true;
      setHistoryReady(true);
    })().catch((error) => {
      if (active) setNotice(`无法初始化编辑历史：${error instanceof Error ? error.message : "浏览器存储不可用"}`);
    }).finally(() => { if (active) setHistoryBusy(false); });
    return () => { active = false; };
  // Initialize once per editor draft. The document and workspace are the loaded draft snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, ready]);

  useEffect(() => {
    if (!historyReady || !ready || !draft?.id || !document || !viewport || pending || !activeHistoryBranchIdRef.current) return;
    const snapshot = createHistorySnapshot(document);
    const fingerprint = historyFingerprint(snapshot);
    if (historySkipAutoRef.current) {
      historySkipAutoRef.current = false;
      historyFingerprintRef.current = fingerprint;
      return;
    }
    if (fingerprint === historyFingerprintRef.current) return;
    const timer = window.setTimeout(() => {
      const label = `自动保存 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      void persistHistorySnapshot(snapshot, label, fingerprint);
    }, 1100);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHistoryBranchId, brushSize, canvasBackground, document, draft?.id, historyReady, maskColor, maskOpacity, mode, model, negative, pending, prompt, ready, sampler, scale, seed, showMaskPreview, steps, strength, strokes, tileScale, tool, undone, viewport, outputSize.height, outputSize.width]);

  const checkoutHistoryNode = async (nodeId: string, branchOverride?: string) => {
    if (!nodeId || historyBusy) return;
    setHistoryBusy(true);
    try {
      const node = await loadEditorHistoryNode(nodeId);
      if (!node || node.draftId !== draft?.id) throw new Error("历史节点不存在或已损坏");
      const restoredDocument: EditorDocument = { ...node.document, image: node.image };
      const restoredGeneration = restoredDocument.generation;
      const nextModel = inpaintModelFor(restoredGeneration?.model || model, restoredGeneration?.imageProtocol) || restoredGeneration?.model || model;
      const normalizedSize = normalizeImageModelSize(nextModel, restoredGeneration?.width || restoredDocument.image.width, restoredGeneration?.height || restoredDocument.image.height, restoredGeneration?.imageProtocol);
      setDocument(restoredDocument);
      setTileScale(node.tileScale);
      if (mode !== node.mode) replaceEditorModeInAddress(node.mode, draft?.id);
      setViewport({ ...node.workspace.viewport });
      setViewportSize(normalizedSize);
      setCamera({ ...node.workspace.camera });
      setStrokes(node.workspace.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })));
      setUndone(node.workspace.undone.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })));
      setTool(node.workspace.tool);
      setBrushSize(node.workspace.brushSize);
      setMaskColor(node.workspace.maskColor);
      setMaskOpacity(node.workspace.maskOpacity);
      setShowMaskPreview(node.workspace.showMaskPreview);
      setCanvasBackground(node.workspace.canvasBackground);
      setPrompt(restoredDocument.prompt || "");
      setNegative(restoredDocument.negativePrompt || "");
      setModel(nextModel);
      setImageQuality(restoredGeneration?.quality || "auto");
      setImageResolution(restoredGeneration?.imageSize || "1K");
      setImageBackground(restoredGeneration?.background || "auto");
      setSteps(restoredGeneration?.steps || 28);
      setScale(restoredGeneration?.scale ?? 5);
      setStrength(restoredGeneration?.strength ?? 0.7);
      setSampler(restoredGeneration?.sampler || "k_euler_ancestral");
      setSeed(restoredDocument.seed == null ? "" : String(restoredDocument.seed));
      setPending(null);
      tiledRestoreRef.current = null;
      tileCacheRef.current = null;
      setTileSourceState(null);
      const branchId = branchOverride || node.branchId;
      activeHistoryBranchIdRef.current = branchId;
      currentHistoryNodeIdRef.current = node.id;
      setActiveHistoryBranchId(branchId);
      setCurrentHistoryNodeId(node.id);
      historyFingerprintRef.current = historyFingerprint({ document: restoredDocument, workspace: node.workspace, mode: node.mode, tileScale: node.tileScale });
      historySkipAutoRef.current = true;
      setNotice(`已切换到「${node.label}」，可以继续编辑或从此节点新建分支。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法切换历史节点");
    } finally {
      setHistoryBusy(false);
    }
  };

  const checkoutHistoryBranch = (branchId: string) => {
    const branch = historyBranches.find((item) => item.id === branchId);
    if (branch) void checkoutHistoryNode(branch.headId, branch.id);
  };

  const createHistoryBranch = async () => {
    if (!draft?.id || !currentHistoryNodeIdRef.current) return;
    const name = await lfnPrompt("输入新分支名称。新分支将从当前选中的历史节点开始。", `分支 ${historyBranches.length + 1}`, { title: "新建历史分支" });
    if (name === null || !name.trim()) return;
    setHistoryBusy(true);
    try {
      const branch = await createEditorHistoryBranch(draft.id, name, currentHistoryNodeIdRef.current);
      setHistoryBranches((current) => [...current, branch]);
      activeHistoryBranchIdRef.current = branch.id;
      setActiveHistoryBranchId(branch.id);
      setNotice(`已从当前历史节点创建分支「${branch.name}」。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建历史分支失败");
    } finally {
      setHistoryBusy(false);
    }
  };

  const saveManualHistoryPoint = async () => {
    if (!document || !draft?.id || !historyReady) return;
    const defaultName = `手动保存 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    const name = await lfnPrompt("为当前图像状态保存一个可命名的历史节点。", defaultName, { title: "保存历史节点" });
    if (name === null || !name.trim()) return;
    historyClearedRef.current = false;
    const snapshot = createHistorySnapshot(document);
    await persistHistorySnapshot(snapshot, name, historyFingerprint(snapshot), true);
    setNotice(`已保存历史节点「${name.trim()}」。`);
  };

  const removeHistoryNode = async (nodeId: string) => {
    const node = historyNodes.find((item) => item.id === nodeId);
    if (!node || !draft?.id) return;
    if (!await lfnConfirm(`删除节点「${node.label}」？其子节点会接到上一个版本，其他分支保留。`)) return;
    setHistoryBusy(true);
    try {
      await historyCommitQueueRef.current;
      await deleteEditorHistoryNode(nodeId);
      const refreshed = await listEditorHistory(draft.id);
      setHistoryNodes(refreshed.nodes);
      setHistoryBranches(refreshed.branches);
      const branch = refreshed.branches.find((item) => item.id === activeHistoryBranchIdRef.current)
        || [...refreshed.branches].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const currentNodeStillExists = refreshed.nodes.some((item) => item.id === currentHistoryNodeIdRef.current);
      const nextNodeId = nodeId === currentHistoryNodeIdRef.current || !currentNodeStillExists ? branch?.headId || "" : currentHistoryNodeIdRef.current;
      activeHistoryBranchIdRef.current = branch?.id || "";
      currentHistoryNodeIdRef.current = nextNodeId;
      setActiveHistoryBranchId(branch?.id || "");
      setCurrentHistoryNodeId(nextNodeId);
      if (document) historyFingerprintRef.current = historyFingerprint(createHistorySnapshot(document));
      setNotice("历史节点已删除；当前画布内容保留。可继续编辑或从现有分支保存新节点。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除历史节点失败");
    } finally { setHistoryBusy(false); }
  };

  const clearCurrentHistory = async () => {
    if (!draft?.id) return;
    if (!await lfnConfirm("删除这张图的全部本地历史节点与分支？当前画布和编辑草稿会保留，此操作无法撤销。")) return;
    setHistoryBusy(true);
    historyClearedRef.current = true;
    try {
      await historyCommitQueueRef.current;
      await deleteEditorHistoryProject(draft.id);
      historyCommitQueueRef.current = Promise.resolve();
      activeHistoryBranchIdRef.current = "";
      currentHistoryNodeIdRef.current = "";
      historyFingerprintRef.current = "";
      setHistoryBranches([]);
      setHistoryNodes([]);
      setActiveHistoryBranchId("");
      setCurrentHistoryNodeId("");
      setNotice("这张图的全部历史节点与分支已清空；当前图片和草稿仍保留。");
    } catch (error) {
      historyClearedRef.current = false;
      setNotice(error instanceof Error ? error.message : "清空本图历史失败");
    } finally { setHistoryBusy(false); }
  };

  useEffect(() => {
    if (!ready || !document || !viewport || pending || !draft) return;
    const timer = window.setTimeout(() => {
      void saveEditorDraft(createDraftPayload(document))
        .then((saved) => setDraft(saved))
        .catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  // createDraftPayload intentionally snapshots all listed editor state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushSize, camera, canvasBackground, document, draft?.id, effectiveImageQuality, effectiveImageResolution, imageBackground, imageQuality, imageResolution, maskColor, maskOpacity, mode, model, negative, pending, prompt, ready, sampler, scale, seed, showMaskPreview, steps, strength, strokes, tool, undone, viewport, outputSize.height, outputSize.width]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, button, [role='combobox']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          const next = [...undone];
          const restored = next.shift();
          if (restored) setStrokes((current) => [...current, restored]);
          setUndone(next);
        } else {
          const next = [...strokes];
          const removed = next.pop();
          if (removed) setUndone((current) => [removed, ...current]);
          setStrokes(next);
        }
        return;
      }
      if (event.key === "Escape" && pending) {
        setPending(null);
        setNotice("已丢弃本次生成，原图未改变。");
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "b") setTool("brush");
      if (key === "e") setTool("eraser");
      if (key === "r") setTool("rectangle");
      if (key === "h" || event.code === "Space") setTool("pan");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pending, strokes, undone]);

  const updatePrompt = (value: string) => {
    setPrompt(value);
    if (draftId && !document?.characterReference) syncEditorPromptToStudioForm(draftId, value, negative);
  };

  const updateNegative = (value: string) => {
    setNegative(value);
    if (draftId && !document?.characterReference) syncEditorPromptToStudioForm(draftId, prompt, value);
  };

  const updateOutputSize = (next: { width?: number; height?: number }) => {
    const width = next.width ?? outputSize.width;
    const height = next.height ?? outputSize.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const normalized = normalizeEditorOutputSize(model, width, height, imageProtocol);
    setViewportSize(normalized);
    setViewport((current) => current ? { ...current, height: current.width / (normalized.width / normalized.height) } : current);
  };

  const refreshMaskPreview = () => {
    if (!document || !viewport) return;
    const prepared = viewportImage(document, viewport, outputSize);
    applyStrokes(prepared.mask, prepared.image.width, prepared.image.height, viewport, strokes);
    setMaskPreviewUrl(maskToPngDataUrl(prepared.mask, prepared.image.width, prepared.image.height));
  };

  const generateTiledUpscale = async (requestedSource?: EditorDocument) => {
    if (tiledRunLockRef.current) return;
    const restore = tiledRestoreRef.current;
    const sourceDocument = requestedSource || restore?.document || document;
    const sourceViewport = restore?.viewport || viewport;
    const sourceCamera = restore?.camera || camera;
    if (!sourceDocument || !sourceViewport) return;
    if (sourceDocument.characterReference) { setNotice("角色参考草稿仅用于蒙版重绘。请返回工作台另行打开分块超分。"); return; }
    if (!authenticated) { setNotice("请先登录后使用编辑器。"); return; }

    const targetModel = generationModelFor(model);
    const targetCapabilities = resolveImageModelCapabilities(targetModel, sourceDocument.generation?.imageProtocol);
    if (!targetCapabilities.operations.includes("img2img")) {
      setNotice("当前模型不支持图生图，无法执行分块重绘。");
      return;
    }
    if (!isNaiModelEnabledForPolicy(targetModel, modelPolicy)) {
      setNotice("当前重绘模型已被管理员停用，请刷新后重新选择。");
      return;
    }
    if (targetCapabilities.seed && seed.trim() && (!/^[+-]?\d+$/.test(seed.trim()) || !Number.isSafeInteger(Number(seed)))) {
      setNotice("种子必须为空或有效整数。");
      return;
    }

    let plan: ImageUpscalePlan;
    try {
      plan = planImageTileUpscale(sourceDocument.image.width, sourceDocument.image.height, tileScale);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "当前图片无法分块");
      return;
    }

    if (!tiledRestoreRef.current) {
      tiledRestoreRef.current = { document: sourceDocument, viewport: sourceViewport, camera: sourceCamera };
      setTileSourceState(sourceDocument);
    }
    const signature = JSON.stringify({
      model: targetModel,
      scale: tileScale,
      steps,
      cfg: scale,
      strength,
      sampler,
      seed,
      prompt,
      negative,
      imageProtocol: sourceDocument.generation?.imageProtocol,
      providerId: sourceDocument.generation?.providerId,
      quality: effectiveImageQuality, imageSize: effectiveImageResolution, background: imageBackground,
    });
    if (!tileCacheRef.current || tileCacheRef.current.sourceImage !== sourceDocument.image || tileCacheRef.current.signature !== signature) {
      tileCacheRef.current = { sourceImage: sourceDocument.image, signature, tiles: new Map() };
    }
    const cache = tileCacheRef.current;
    tiledRunLockRef.current = true;
    const runController = new AbortController();
    editorGenerationAbortRef.current = runController;
    setGenerating(true);
    setNotice("");
    setTileProgress({ completed: cache.tiles.size, total: plan.tiles.length, active: 0, concurrency: 2, waiting: 0, source: "LFN" });
    try {
      const usesGateway = (sourceDocument.generation?.providerId || "newapi") === "newapi" && /^nai-/i.test(targetModel);
      let concurrency = 2;
      let concurrencySource: "Gateway" | "LFN" = "LFN";
      if (usesGateway) {
        const capacity = await waitWithAbort(refreshGatewayImageCapacity(), runController.signal);
        if (capacity) {
          concurrency = tileUpscaleConcurrencyLimit(targetModel, steps, capacity);
          concurrencySource = "Gateway";
          if (concurrency < 1) throw new Error("Gateway 当前没有启用符合该模型和计费条件的账号，请先在 Gateway 启用对应账号能力");
        }
      }
      setNotice(`正在按 ${concurrencySource} 当前 ${concurrency} 路并发重绘分块；失败的分块可保留后续跑。`);

      const requestTile = async (tile: ImageUpscaleTile, signal: AbortSignal): Promise<Blob> => {
        const crop = cropRgbaImage(sourceDocument.image, tile);
        const body = {
          operation: "img2img",
          // Each tile is an internal patch; only the stitched result belongs in history.
          editor_composite: true,
          providerId: sourceDocument.generation?.providerId || "newapi",
          imageProtocol: sourceDocument.generation?.imageProtocol,
          quality: effectiveImageQuality,
          imageSize: effectiveImageResolution,
          background: imageBackground,
          model: targetModel,
          prompt: `${prompt.trim() || "high quality, detailed image"}, preserve the source composition, subject identity, colors, and local geometry; continue details naturally across the crop edges`,
          negative_prompt: negative.trim(),
          width: tile.requestWidth,
          height: tile.requestHeight,
          steps,
          scale,
          n: 1,
          sampler,
          noise_schedule: sourceDocument.generation?.noiseSchedule || "native",
          strength,
          ...(targetCapabilities.seed && seed.trim() ? { seed: (Number(seed) + tile.index) % 2 ** 32 } : {}),
          image: rgbaToDataUrl(crop),
          response_format: "b64_json",
        };
        const response = await fetch("/api/images/operate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
        const resultUrl = await readGenerationResponse(response);
        return dataUrlToBlob(resultUrl);
      };

      runController.signal.throwIfAborted();
      const missingTiles = plan.tiles.filter((tile) => !cache.tiles.has(tile.index));
      await new Promise<void>((resolve, reject) => {
        let stopped = false;
        let cursor = 0;
        let active = 0;
        let failure: Error | null = null;
        let refreshing = false;
        let timer: number | null = null;
        const requests = new Map<number, { controller: AbortController; timeout: number }>();

        const publish = () => {
          if (stopped) return;
          const progress = {
            completed: cache.tiles.size,
            total: plan.tiles.length,
            active,
            concurrency,
            waiting: Math.max(0, missingTiles.length - cursor),
            source: concurrencySource,
          };
          setTileProgress(progress);
          setNotice(`分块重绘中：已完成 ${progress.completed}/${progress.total} · 正在请求 ${progress.active} 路 · 排队 ${progress.waiting} 块（${progress.source}）`);
        };
        const finish = (error?: Error) => {
          if (stopped) return;
          stopped = true;
          runController.signal.removeEventListener("abort", abortRun);
          if (timer !== null) window.clearInterval(timer);
          for (const { controller, timeout } of requests.values()) {
            window.clearTimeout(timeout);
            controller.abort();
          }
          requests.clear();
          if (error) reject(error);
          else resolve();
        };
        const abortRun = () => {
          if (stopped) return;
          failure = new DOMException("已取消分块重绘", "AbortError");
          cursor = missingTiles.length;
          if (timer !== null) window.clearInterval(timer);
          for (const request of requests.values()) request.controller.abort();
          setNotice("正在取消已发出的分块请求；已完成结果会保留。");
          settleIfReady();
        };
        const settleIfReady = () => {
          if (stopped) return;
          if (active > 0) return;
          if (failure) { finish(failure); return; }
          if (cursor >= missingTiles.length) { finish(); return; }
          if (concurrency < 1) finish(new Error("Gateway 当前没有可用并发账号；已完成分块已保存，恢复账号后可继续"));
        };
        const pump = () => {
          if (stopped) return;
          while (!failure && active < concurrency && cursor < missingTiles.length) {
            const tile = missingTiles[cursor++];
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(new DOMException("请求超过 180 秒没有响应", "TimeoutError")), 180_000);
            requests.set(tile.index, { controller, timeout });
            active += 1;
            publish();
            void requestTile(tile, controller.signal)
              .then((result) => { if (!stopped) cache.tiles.set(tile.index, result); })
              .catch((error) => {
                if (stopped) return;
                if (!failure) {
                  const timedOut = controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError";
                  const detail = timedOut ? "单块请求超过 180 秒未返回；其他已发出的分块会先结算，失败块可重试" : error instanceof Error ? error.message : "图像请求失败";
                  failure = new Error(`第 ${tile.index + 1}/${plan.tiles.length} 块失败：${detail}`);
                }
              })
              .finally(() => {
                if (stopped) return;
                const request = requests.get(tile.index);
                if (request) window.clearTimeout(request.timeout);
                requests.delete(tile.index);
                active -= 1;
                publish();
                if (failure) settleIfReady();
                else pump();
              });
          }
          publish();
          settleIfReady();
        };

        if (usesGateway) {
          timer = window.setInterval(() => {
            if (refreshing || failure) return;
            refreshing = true;
            void refreshGatewayImageCapacity()
              .then((capacity) => {
                if (capacity) {
                  const nextConcurrency = tileUpscaleConcurrencyLimit(targetModel, steps, capacity);
                  concurrency = nextConcurrency;
                  concurrencySource = "Gateway";
                  if (nextConcurrency < 1) failure = new Error("Gateway 已没有符合条件的账号；等待中的分块已暂停，恢复账号后可继续");
                } else {
                  concurrency = 2;
                  concurrencySource = "LFN";
                }
              })
              .finally(() => {
                refreshing = false;
                publish();
                pump();
              });
          }, 5_000);
        }
        runController.signal.addEventListener("abort", abortRun, { once: true });
        if (runController.signal.aborted) { abortRun(); return; }
        pump();
      });

      runController.signal.throwIfAborted();
      const upscaled = await stitchUpscaleTiles(plan, cache.tiles);
      runController.signal.throwIfAborted();
      const previewDocument: EditorDocument = {
        ...sourceDocument,
        image: sourceDocument.image,
        worldRect: { x: sourceDocument.worldRect.x, y: sourceDocument.worldRect.y, width: plan.outputWidth, height: plan.outputHeight },
        generation: { ...sourceDocument.generation, model: targetModel, width: plan.outputWidth, height: plan.outputHeight, steps, scale, strength, sampler },
      };
      const previewViewport = { ...previewDocument.worldRect };
      const promptSummary = prompt.trim().replace(/\s+/g, " ").slice(0, 42);
      const candidate: PendingCandidate = {
        id: createEditorId(),
        patch: upscaled,
        viewport: previewViewport,
        prompt,
        historyLabel: `分块超分 ${tileScale}× · ${targetModel}${promptSummary ? ` · ${promptSummary}` : ""}`,
        createdAt: Date.now(),
      };
      runController.signal.throwIfAborted();
      const recorded = await recordGeneratedCandidate(previewDocument, candidate, "tiled-upscale");
      runController.signal.throwIfAborted();
      setDocument(previewDocument);
      setViewport(previewViewport);
      setCamera({ ...sourceCamera });
      window.setTimeout(() => fitCamera(previewDocument, previewViewport), 0);
      setPending(recorded.candidate);
      setCompare(0.5);
      setNotice(`分块重绘完成（${plan.tiles.length} 次调用，峰值 ${concurrency} 路并发，${plan.outputWidth}×${plan.outputHeight}）。${recorded.saved ? "已记入重绘历史；" : recorded.attempted ? "历史暂未保存，应用时会重试；" : "应用后会记入重绘历史；"}可拖动中间分隔线对比，或下载 PNG。`);
    } catch (error) {
      setNotice(`${error instanceof Error ? error.message : "分块重绘失败"}；已完成的分块保留，重新点击可从失败处继续。`);
    } finally {
      if (editorGenerationAbortRef.current === runController) editorGenerationAbortRef.current = null;
      tiledRunLockRef.current = false;
      setGenerating(false);
    }
  };

  const generate = async () => {
    if (mode === "tiled-upscale") {
      await generateTiledUpscale();
      return;
    }
    if (!document || !viewport || editorGenerationAbortRef.current) return;
    if (!isNaiModelEnabledForPolicy(model, modelPolicy)) {
      setNotice("当前 NAI 模型已被管理员停用，请刷新后重新选择。");
      return;
    }
    if (!authenticated) { setNotice("请先登录后使用编辑器。"); return; }
    if (modelCapabilities.seed && seed.trim() && (!/^[+-]?\d+$/.test(seed.trim()) || !Number.isSafeInteger(Number(seed)))) {
      setNotice("种子必须为空或有效整数。");
      return;
    }
    const maxPixels = modelCapabilities.sizeConstraints?.maxPixels || 8_294_400;
    if (outputSize.width * outputSize.height > maxPixels) {
      setNotice(`输出像素不能超过 ${maxPixels}。`);
      return;
    }
    const runController = new AbortController(); editorGenerationAbortRef.current = runController;
    setGenerating(true); setNotice("");
    try {
      const reference = document.characterReference;
      if (reference && (mode !== "inpaint" || !supportsCharacterReferenceEdit(model, imageProtocol))) throw new Error("角色参考仅支持 NAI V4.5 / V5 非 Medium 模型的蒙版重绘，请恢复兼容的模型与模式。");
      if (reference && !strokes.some(stroke => stroke.mode !== "erase" && stroke.points.length)) throw new Error("请先涂选要重绘的角色区域。");
      const prepared = viewportImage(document, viewport, outputSize);
      // A role edit never auto-selects transparent or out-of-canvas pixels.
      if (reference) prepared.mask.fill(0);
      applyStrokes(prepared.mask, prepared.image.width, prepared.image.height, viewport, strokes);
      const { requestMask, compositeMask } = prepareInpaintMasks(prepared.mask, prepared.image.width, prepared.image.height, featherRadius);
      if (!prepared.mask.some((value) => value > 0))
        throw new Error("请先绘制重绘蒙版，或把生成框移动到原图外扩展画布。");
      const references = reference ? await characterReferencePayload(reference, userId, runController.signal) : undefined;
      const body = {
        ...(references ? { references } : {}),
        operation: mode === "canvas" ? "outpainting" : "inpainting",
        editor_composite: true,
        providerId: document.generation?.providerId || "newapi",
        imageProtocol,
        quality: effectiveImageQuality,
        imageSize: effectiveImageResolution,
        background: imageBackground,
        model,
        prompt: prompt.trim(),
        negative_prompt: negative.trim(),
        width: prepared.image.width,
        height: prepared.image.height,
        steps,
        scale,
        n: 1,
        sampler,
        noise_schedule: document.generation?.noiseSchedule || "native",
        strength,
        inpaintImg2ImgStrength: strength,
        ...(modelCapabilities.seed && seed.trim() ? { seed: Number(seed) } : {}),
        image: rgbaToDataUrl(prepared.image),
        mask: maskToPngDataUrl(requestMask, prepared.image.width, prepared.image.height),
        response_format: "b64_json",
      };
      const response = await fetch("/api/images/operate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: runController.signal });
      const resultUrl = await readGenerationResponse(response);
      runController.signal.throwIfAborted();
      const patch = await dataUrlToRgba(resultUrl, { width: prepared.image.width, height: prepared.image.height });
      const promptSummary = prompt.trim().replace(/\s+/g, " ").slice(0, 48);
      const operationLabel = mode === "canvas" ? "扩图" : "局部重绘";
      const candidate: PendingCandidate = {
        id: createEditorId(), patch, viewport: { ...viewport }, mask: compositeMask, prompt,
        historyLabel: `${operationLabel} · ${model}${promptSummary ? ` · ${promptSummary}` : ""}`,
        createdAt: Date.now(),
      };
      runController.signal.throwIfAborted();
      const recorded = await recordGeneratedCandidate(document, candidate, mode);
      runController.signal.throwIfAborted();
      setPending(recorded.candidate);
      setCompare(0.5);
      setNotice(`生成完成。${recorded.saved ? "已记入重绘历史；" : recorded.attempted ? "历史暂未保存，应用时会重试；" : "应用后会记入重绘历史；"}拖动中间分割线比较，确认后点击应用。`);
    } catch (error) {
      setNotice(runController.signal.aborted ? "已取消生成，原图保持不变。" : error instanceof Error ? error.message : "生成失败，请稍后重试");
    } finally { if (editorGenerationAbortRef.current === runController) editorGenerationAbortRef.current = null; setGenerating(false); }
  };

  const returnToStudio = () => {
    if (draftId && document && !document.characterReference) syncEditorPromptToStudioForm(draftId, prompt, negative);
    router.replace(returnHref);
  };

  const openHistoryLibrary = async () => {
    if (generating || pending) return;
    if (document && historyReady) {
      const snapshot = createHistorySnapshot(document);
      if (!await persistHistorySnapshot(snapshot, "离开编辑器前保存", historyFingerprint(snapshot))) return;
      await saveEditorDraft(createDraftPayload(document));
    }
    router.push("/image/editor/history");
  };

  const apply = async () => {
    if (!document || !pending) return;
    try {
      historyClearedRef.current = false;
      const resultModel = mode === "tiled-upscale" ? generationModel : model;
      if (draft?.id && (!activeHistoryBranchIdRef.current || !currentHistoryNodeIdRef.current)) {
        const root = await createEditorHistoryRoot(draft.id, createHistorySnapshot(document));
        activeHistoryBranchIdRef.current = root.branch.id;
        currentHistoryNodeIdRef.current = root.node.id;
        setActiveHistoryBranchId(root.branch.id);
        setCurrentHistoryNodeId(root.node.id);
        setHistoryBranches((current) => current.some((item) => item.id === root.branch.id) ? current : [...current, root.branch]);
        setHistoryNodes((current) => current.some((item) => item.id === root.node.id) ? current : [...current, root.node].sort((a, b) => a.createdAt - b.createdAt));
        historyFingerprintRef.current = historyFingerprint(createHistorySnapshot(document));
      }
      const applied = applyPendingCandidate(document, pending);
      const historySnapshot = createHistorySnapshot(applied);
      const historySaved = pending.editorHistoryNodeId === currentHistoryNodeIdRef.current || await persistHistorySnapshot(
        historySnapshot,
        pending.historyLabel || `${mode === "canvas" ? "扩图" : "重绘"} · ${resultModel}`,
        historyFingerprint(historySnapshot),
        true,
        mode,
      );
      if (!historySaved) throw new Error("无法保存重绘历史节点，请检查浏览器本地存储空间后重试。结果仍保留在当前预览中。");
      const nextDraft = await saveEditorDraft(createDraftPayload(applied));
      const finalImage = rgbaToDataUrl(applied.image);
      let historyId = "";
      if (imageHistoryMode === "local") {
        try {
          const localId = crypto.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await saveLocalImageHistory({ id: localId, ownerId: userId ?? 0, createdAt: Date.now(), image: await dataUrlToBlob(finalImage), prompt, negative, model: resultModel, operation: "editor-composite" });
        } catch (error) {
          setNotice(`${error instanceof Error ? error.message : "本地历史保存失败"}，结果仍会返回工作台。`);
        }
      } else if (imageHistoryMode === "account") {
        try {
          historyId = await saveEditorComposite({
            image: finalImage, model: resultModel, prompt, negative_prompt: negative,
            providerId: document.generation?.providerId || "newapi", imageProtocol,
            quality: effectiveImageQuality, imageSize: effectiveImageResolution, background: imageBackground,
            width: applied.image.width, height: applied.image.height,
            steps, scale, sampler, strength,
            ...(modelCapabilities.seed && seed.trim() ? { seed: Number(seed) } : {}),
          });
        } catch (error) {
          setNotice(`${error instanceof Error ? error.message : "完整合成图未写入历史"}，结果仍会返回工作台。`);
        }
      }
      const historyQuery = historyId ? `&editorHistory=${encodeURIComponent(historyId)}` : "";
      if (!nextDraft.document.characterReference) syncEditorPromptToStudioForm(nextDraft.id, prompt, negative);
      tiledRestoreRef.current = null;
      setTileSourceState(null);
      router.push(`/image?editorResult=${encodeURIComponent(nextDraft.id)}&editorNodeId=${encodeURIComponent(currentHistoryNodeIdRef.current)}&editorBranchId=${encodeURIComponent(activeHistoryBranchIdRef.current)}${historyQuery}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "应用结果失败"); }
  };

  const discard = () => {
    const restore = tiledRestoreRef.current;
    if (pending?.editorHistoryNodeId && pending.editorHistoryNodeId === currentHistoryNodeIdRef.current) {
      const parentId = pending.editorHistoryParentNodeId;
      if (parentId) {
        currentHistoryNodeIdRef.current = parentId;
        setCurrentHistoryNodeId(parentId);
      }
      if (pending.editorHistoryParentBranchId) {
        activeHistoryBranchIdRef.current = pending.editorHistoryParentBranchId;
        setActiveHistoryBranchId(pending.editorHistoryParentBranchId);
      }
      const restoredDocument = restore?.document || document;
      if (restoredDocument) {
        historyFingerprintRef.current = historyFingerprint(createHistorySnapshot(restoredDocument));
        historySkipAutoRef.current = true;
      }
    }
    if (mode === "tiled-upscale" && restore) {
      setDocument(restore.document);
      setViewport(restore.viewport);
      setCamera(restore.camera);
      tiledRestoreRef.current = null;
      setTileSourceState(null);
      setPending(null);
      setNotice("已丢弃分块超分结果，原图未改变。已完成的分块仍保留，可再次生成后续用。");
      return;
    }
    setPending(null);
    setNotice("已丢弃本次生成，原图未改变。");
  };

  const replaceSource = async (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice("仅支持 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setNotice("图片不能超过 15 MB。");
      return;
    }
    try {
      tiledRestoreRef.current = null;
      tileCacheRef.current = null;
      setTileSourceState(null);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("无法读取图片"));
        reader.readAsDataURL(file);
      });
      const image = await dataUrlToRgba(dataUrl);
      const nextDocument = createEditorDocument(image, { x: 0, y: 0, width: image.width, height: image.height }, {
        prompt,
        negativePrompt: negative,
        seed: modelCapabilities.seed ? seed || null : null,
        source: { name: file.name, mimeType: file.type },
        generation: { ...document?.generation, model, quality: effectiveImageQuality, imageSize: effectiveImageResolution, background: imageBackground, width: outputSize.width, height: outputSize.height, steps, scale, strength, sampler, noiseSchedule: document?.generation?.noiseSchedule },
      });
      const nextViewport = fitViewport(nextDocument, outputSize.width, outputSize.height);
      setDocument(nextDocument);
      setViewport(nextViewport);
      setStrokes([]);
      setUndone([]);
      setPending(null);
      fitCamera(nextDocument, nextViewport);
      setNotice(`已替换源图：${file.name}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "替换源图失败");
    } finally {
      if (sourceInputRef.current) sourceInputRef.current.value = "";
    }
  };

  if (busy) return <main className="image-editor-page"><div className="editor-loading">正在打开编辑器…</div></main>;
  if (!ready || !document || !viewport) return <main className="image-editor-page"><div className="editor-error"><p>{notice || "无法打开编辑器"}</p><button type="button" onClick={returnToStudio}>{returnLabel}</button></div></main>;

  const maskToolPanel = (
    <>
      <div className="editor-panel-heading"><span><WandSparkles size={15} />蒙版工具</span><small>{strokes.length} 笔</small></div>
      <div className="editor-tool-grid">
        {([
          ["pan", "移动", Move],
          ["brush", "绘制", WandSparkles],
          ["eraser", "擦除", Eraser],
          ["rectangle", "矩形选区", Maximize2],
        ] as const).map(([value, label, Icon]) => <button type="button" key={value} className={tool === value ? "is-active" : ""} onClick={() => setTool(value)}><Icon size={16} /><span>{label}</span></button>)}
      </div>
      <label className="editor-slider"><span>笔刷大小 <b>{brushSize}px</b></span><input type="range" min="8" max="240" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
      <label className="editor-slider"><span>蒙版透明度 <b>{maskOpacity}%</b></span><input type="range" min="10" max="90" value={maskOpacity} onChange={(event) => setMaskOpacity(Number(event.target.value))} /></label>
      <div className="editor-color-row"><span>蒙版颜色</span><div>{MASK_COLORS.map((color) => <button type="button" key={color} aria-label={`蒙版颜色 ${color}`} className={maskColor === color ? "is-active" : ""} style={{ background: color }} onClick={() => setMaskColor(color)} />)}</div></div>
      <div className="editor-compact-actions">
        <button type="button" aria-pressed={showMaskPreview} onClick={() => setShowMaskPreview((current) => !current)}>{showMaskPreview ? "隐藏蒙版" : "显示蒙版"}</button>
        <button type="button" onClick={refreshMaskPreview}>实际蒙版</button>
      </div>
      {maskPreviewUrl && <div className="editor-mask-preview"><NextImage src={maskPreviewUrl} alt="实际黑白蒙版预览" width={outputSize.width} height={outputSize.height} unoptimized /><button type="button" onClick={() => setMaskPreviewUrl("")}>关闭预览</button></div>}
      <div className="editor-history-actions"><button type="button" disabled={!strokes.length || Boolean(pending)} onClick={() => { const next = [...strokes]; const removed = next.pop(); if (removed) setUndone((current) => [removed, ...current]); setStrokes(next); }}><Undo2 size={15} />撤销</button><button type="button" disabled={!undone.length || Boolean(pending)} onClick={() => { const next = [...undone]; const restored = next.shift(); if (restored) setStrokes((current) => [...current, restored]); setUndone(next); }}><Redo2 size={15} />重做</button><button type="button" disabled={!strokes.length || Boolean(pending)} onClick={() => { setStrokes([]); setUndone([]); }}><Trash2 size={15} />清空</button></div>
    </>
  );

  const toolPanel = maskToolPanel;

  const standardGenerationPanel = (
    <>
      {document?.characterReference && <CharacterEditReferenceCard reference={document.characterReference} userId={userId} />}
      <div className="editor-panel-heading"><span><Settings2 size={15} />生成设置</span><small>{outputSize.width} × {outputSize.height}</small></div>
      <label className="editor-field"><span>模型</span><PopupSelect value={model} onChange={setModel} options={naturalImageModel ? [{ value: model, label: model }] : filteredInpaintModels} ariaLabel="重绘模型" /></label>
      {!naturalImageModel && !v45InpaintAvailable && <p className="editor-tip is-warning">V4.5 支持局部重绘；当前平台模型开关或上游公开目录未开放 V4.5 局部重绘模型。</p>}
      <div className="editor-size-row"><label><span>宽度</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器输出宽度" min={outputStep} max={outputMaxEdge} step={outputStep} value={outputSize.width} setValue={(value) => updateOutputSize({ width: value })} /></label><button type="button" aria-label="交换宽高" onClick={() => updateOutputSize({ width: outputSize.height, height: outputSize.width })}>×</button><label><span>高度</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器输出高度" min={outputStep} max={outputMaxEdge} step={outputStep} value={outputSize.height} setValue={(value) => updateOutputSize({ height: value })} /></label></div>
      <div className="editor-quality-actions"><button type="button" disabled={!viewport} onClick={() => {
        if (!viewport) return;
        const normalized = normalizeEditorOutputSize(model, Math.round(viewport.width), Math.round(viewport.height), imageProtocol);
        setViewportSize(normalized);
        setViewport((current) => current ? { ...current, x: Math.round(current.x), y: Math.round(current.y), width: normalized.width, height: normalized.height } : current);
        setNotice("已将取景框与输出对齐为 " + normalized.width + "×" + normalized.height + " 原像素；尺寸按模型规则对齐，请检查取景边界后生成。");
      }}>原像素取景</button>{!naturalImageModel && <button type="button" onClick={() => { setStrength(0.3); setFeatherRadius(2); setNotice("已设置低强度 0.3、向内羽化 2px。选区外保持原像素；选区内仍由模型重新生成。"); }}>低强度保真预设</button>}</div>
      {naturalImageModel ? <NaturalImageSettings model={model} imageProtocol={imageProtocol} width={outputSize.width} height={outputSize.height} setWidth={(width) => updateOutputSize({ width })} setHeight={(height) => updateOutputSize({ height })}
        setDimensions={updateOutputSize}
        quality={effectiveImageQuality} setQuality={setImageQuality} imageSize={effectiveImageResolution} setImageSize={setImageResolution} background={imageBackground} setBackground={setImageBackground} /> : <>
        <div className="editor-parameter-grid"><label><span>步数</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器采样步数" min={1} max={50} step={1} value={steps} setValue={setSteps} /></label><label><span>CFG</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器提示词相关性" min={0} max={10} step={0.1} value={scale} setValue={setScale} /></label><label><span>强度</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器重绘强度" min={0} max={1} step={0.05} value={strength} setValue={setStrength} /></label><label><span>向内羽化 (px)</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器向内羽化像素" min={0} max={32} step={1} value={featherRadius} setValue={setFeatherRadius} /></label><label><span>种子</span><input className="editor-text-input" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="随机" /></label></div>
          <p className="editor-tip editor-quality-hint">仅合成精确选区，选区外保留原像素；羽化向内过渡。连续重绘同一区域仍受模型影响，建议降低强度并保留原图。</p>
        <label className="editor-field"><span>采样器</span><PopupSelect value={sampler} onChange={setSampler} options={SAMPLERS.map(([value, label]) => ({ value, label }))} ariaLabel="编辑器采样器" /></label>
      </>}
      <label className="editor-field"><span>描述画面</span><textarea value={prompt} onChange={(event) => updatePrompt(event.target.value)} placeholder="描述要生成或补全的内容…" /></label>
      <label className="editor-field"><span>排除内容</span><textarea className="is-short" value={negative} onChange={(event) => updateNegative(event.target.value)} placeholder="不希望出现的内容…" /></label>
      <p className="editor-tip">{document?.characterReference ? "仅重绘手动涂选的角色区域。参考图不关联上游角色编号，区域隔离由本地蒙版合成保证。" : "生成框可越过原图边缘；透明部分会自动加入蒙版。结果只在点击“应用”后写入画布。"}</p>
    </>
  );

  const tileGenerationPanel = (
    <>
      <div className="editor-panel-heading"><span><Settings2 size={15} />分块超分设置</span><small>{tilePlanState.plan ? "自动切块" : "尺寸受限"}</small></div>
      {tilePlanState.plan && <div className="editor-upscale-summary">
        <div className="editor-upscale-summary-copy"><strong>{tilePlanState.plan.outputWidth} × {tilePlanState.plan.outputHeight}</strong><span>自动切分为 {tilePlanState.plan.tiles.length} 块</span></div>
        <label className="editor-tile-scale-control"><span>超分倍率</span><PopupSelect value={String(tileScale)} options={[2, 3, 4, 5, 6].map((value) => ({ value: String(value), label: `${value}×` }))} ariaLabel="分块超分倍率" onChange={(value) => setTileScale(Number(value) as TileUpscaleFactor)} /></label>
      </div>}
      {!tilePlanState.plan && tilePlanState.error && <p className="editor-tip is-warning">{tilePlanState.error}</p>}
      {tilePlanState.plan && <p className="editor-tip">最终画布按倍率放大：{tilePlanState.plan.sourceWidth}×{tilePlanState.plan.sourceHeight} → {tilePlanState.plan.outputWidth}×{tilePlanState.plan.outputHeight}。系统自动裁成带重叠的小块，每块按原比例放大至 1024² 免费请求范围内可用的最大尺寸，再进行图生图，最后按所选倍率和原位置拼接。此功能是分块图生图，不调用 V5 专用超分接口。</p>}
      <label className="editor-field"><span>重绘模型</span><PopupSelect
        value={generationModel}
        options={tiledModelOptions}
        ariaLabel="分块超分重绘模型"
        onChange={(value) => setModel(inpaintModelFor(value, imageProtocol) || value)}
      /></label>
      {tiledModelsLoading && <p className="editor-tip">正在读取当前来源可用的图像模型…</p>}
      {tiledModelsError && <p className="editor-tip is-warning">{tiledModelsError}</p>}
      {naturalImageModel ? <p className="editor-tip">当前模型按自身接口规格处理每块，输出边长最多 1024 像素；图像质量采用当前工作台设置。</p> : <>
        <div className="editor-parameter-grid"><label><span>步数</span><WheelNumberInput className="editor-number-input" ariaLabel="分块超分采样步数" min={1} max={50} step={1} value={steps} setValue={setSteps} /></label><label><span>CFG</span><WheelNumberInput className="editor-number-input" ariaLabel="分块超分提示词相关性" min={0} max={10} step={0.1} value={scale} setValue={setScale} /></label><label><span>重绘强度</span><WheelNumberInput className="editor-number-input" ariaLabel="分块超分重绘强度" min={0} max={1} step={0.05} value={strength} setValue={setStrength} /></label><label><span>种子</span><input className="editor-text-input" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="随机" /></label></div>
        <label className="editor-field"><span>采样器</span><PopupSelect value={sampler} onChange={setSampler} options={SAMPLERS.map(([value, label]) => ({ value, label }))} ariaLabel="分块超分采样器" /></label>
      </>}
      <label className="editor-field"><span>细节提示词</span><textarea value={prompt} onChange={(event) => updatePrompt(event.target.value)} placeholder="可补充希望重绘的细节；留空时沿用默认保真提示词。" /></label>
      <label className="editor-field"><span>排除内容</span><textarea className="is-short" value={negative} onChange={(event) => updateNegative(event.target.value)} placeholder="不希望出现的内容…" /></label>
      <p className="editor-tip">{tileCapacityDescription}{gatewayImageCapacity && usesGatewayImageCapacity ? ` · V5+Anlas ${gatewayImageCapacity.v5_and_anlas} · V4.5+Anlas ${gatewayImageCapacity.v45_and_anlas}` : ""}</p>
      {tileProgress && <p className="editor-tip">本次进度：完成 {tileProgress.completed}/{tileProgress.total} · 正在生成 {tileProgress.active}/{tileProgress.concurrency} · 等待 {tileProgress.waiting} 块。</p>}
      <p className="editor-tip is-warning">{tileBillingDescription} 分块会按 Gateway 实时可用账号并发处理；失败时保留已完成分块，修改参数则重新请求。</p>
    </>
  );
  const historyNodeDepth = (node: EditorHistoryNode) => {
    let depth = 0;
    let parentId = node.parentId;
    const visited = new Set<string>();
    while (parentId && depth < 8 && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = historyNodes.find((item) => item.id === parentId);
      if (!parent) break;
      depth += 1;
      parentId = parent.parentId;
    }
    return depth;
  };
  const historyPanel = (
    <>
      <div className="editor-panel-heading"><span><GitBranch size={15} />版本分支</span><small>{historyNodes.length} 个节点</small></div>
      <label className="editor-field"><span>当前分支</span><PopupSelect value={activeHistoryBranchId} onChange={checkoutHistoryBranch} options={historyBranches.map((branch) => ({ value: branch.id, label: branch.name }))} ariaLabel="编辑历史分支" /></label>
      <div className="editor-history-branch-actions"><button type="button" disabled={!historyReady || historyBusy || !currentHistoryNodeId} onClick={() => void createHistoryBranch()}><GitBranch size={13} />从当前节点新建分支</button><button type="button" disabled={!historyReady || historyBusy || !document} onClick={() => void saveManualHistoryPoint()}><Save size={13} />保存历史节点</button></div>
      <div className="editor-history-branch-actions"><button type="button" disabled={!currentHistoryNodeId || historyBusy} onClick={() => void removeHistoryNode(currentHistoryNodeId)}><Trash2 size={13} />删除选中节点</button><button type="button" className="is-danger" disabled={!draft?.id || historyBusy || historyNodes.length === 0} onClick={() => void clearCurrentHistory()}><Trash2 size={13} />清空本图历史</button></div>
      <div className="editor-history-tree" role="tree" aria-label="图像编辑历史树">
        {!historyReady ? <p className="editor-tip">正在载入历史记录…</p> : historyNodes.length === 0 ? <p className="editor-tip">还没有历史节点。</p> : [...historyNodes].reverse().map((node) => {
          const branch = historyBranches.find((item) => item.id === node.branchId);
          const isHead = historyBranches.some((item) => item.headId === node.id);
          return <div className="editor-history-node-row" key={node.id} style={{ "--history-depth": historyNodeDepth(node) } as React.CSSProperties}>
            <button type="button" role="treeitem" aria-selected={currentHistoryNodeId === node.id} className={`editor-history-node${currentHistoryNodeId === node.id ? " is-current" : ""}`} onClick={() => void checkoutHistoryNode(node.id)} disabled={historyBusy}>
              <NextImage src={node.thumbnail} alt="" width={36} height={44} unoptimized />
              <span className="editor-history-node-copy" title={node.document.prompt || node.label}><strong>{node.label}</strong><small>{branch?.name || "分支"} · {new Date(node.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></span>
              {isHead && <small className="editor-history-head">HEAD</small>}
            </button>
          </div>;
        })}
      </div>
      <p className="editor-tip">每次编辑状态稳定后会自动保存节点。切换到旧节点后可继续修改，或从该节点创建新分支。</p>
    </>
  );
  const generationPanel = mode === "tiled-upscale" ? tileGenerationPanel : standardGenerationPanel;

  const canvasPanel = (
    <>
      <div className="editor-panel-heading"><span><Palette size={15} />画布与文件</span><small>继承 LFN 外观</small></div>
      <div className="editor-option-group"><span>工作区背景（仅预览）</span><div className="editor-choice-grid">{([['checker','棋盘格'],['white','白色'],['dark','深色']] as const).map(([value,label]) => <button type="button" key={value} className={canvasBackground === value ? "is-active" : ""} onClick={() => setCanvasBackground(value)}>{label}</button>)}</div></div>
      <input ref={sourceInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden tabIndex={-1} aria-hidden="true" onChange={(event) => void replaceSource(event.target.files?.[0])} />
      <button type="button" className="editor-fit-button" onClick={() => sourceInputRef.current?.click()}><Maximize2 size={15} />替换源图片</button>
      <button type="button" className="editor-fit-button" onClick={() => fitCamera(document, viewport)}><RotateCcw size={15} />适配画布与生成框</button>
      <div className="editor-export-grid"><ImageDownloadMenu filename="lfn-canvas-transparent" getImage={() => document ? rgbaImageToBlob(document.image) : Promise.reject(new Error("画布尚未就绪"))} className="editor-image-download" label="透明 PNG" title="下载透明 PNG" /><ImageDownloadMenu filename="lfn-canvas-white" getImage={() => document ? rgbaImageToBlob(document.image, true) : Promise.reject(new Error("画布尚未就绪"))} className="editor-image-download" label="白底 PNG" title="下载白底 PNG" /></div>
      <p className="editor-tip">编辑器自动沿用 LFN 的主题、强调色、密度和动效设置。画布背景只用于预览，不会写入图片。</p>
    </>
  );

  const switchEditorMode = (next: EditorMode) => {
    if (generating || pending) return;
    if (mode === "tiled-upscale" && next !== "tiled-upscale") {
      tiledRestoreRef.current = null;
      setTileSourceState(null);
    }
    setNotice("");
    replaceEditorModeInAddress(next, draftId);
  };

  const regeneratePending = () => {
    if (mode === "tiled-upscale") {
      const restore = tiledRestoreRef.current;
      const source = restore?.document;
      setPending(null);
      tileCacheRef.current = null;
      if (source && restore) {
        setDocument(source);
        setViewport(restore.viewport);
        setCamera(restore.camera);
        void generateTiledUpscale(source);
      }
      return;
    }
    setPending(null);
    void generate();
  };

  return (
    <main className="image-editor-page">
      <header className="editor-topbar">
        <button type="button" className="editor-icon-button" aria-label={returnLabel} onClick={returnToStudio}><ArrowLeft size={18} /></button>
        <div className="editor-title"><strong>{mode === "canvas" ? "无限画布" : mode === "tiled-upscale" ? "分块超分" : "精细重绘"}</strong><span>LFN 图像编辑器 · {document.image.width} × {document.image.height}</span></div>
        <div className="editor-mode-tabs"><button type="button" disabled={generating || Boolean(pending)} className={mode === "inpaint" ? "is-active" : ""} onClick={() => switchEditorMode("inpaint")}>精细重绘</button><button type="button" disabled={generating || Boolean(pending)} className={mode === "canvas" ? "is-active" : ""} onClick={() => switchEditorMode("canvas")}>无限画布</button><button type="button" disabled={generating || Boolean(pending)} className={mode === "tiled-upscale" ? "is-active" : ""} onClick={() => switchEditorMode("tiled-upscale")}>分块超分</button></div>
        <div className="editor-top-actions"><button type="button" aria-label="打开重绘历史" title="打开重绘历史" disabled={generating || Boolean(pending) || historyBusy} onClick={() => void openHistoryLibrary().catch((error) => setNotice(error instanceof Error ? error.message : "无法打开重绘历史"))}><History size={16} />重绘历史</button><button type="button" className="editor-parameters-toggle" aria-label="展开生成参数" title="生成参数" onClick={() => setRightPanelOpen((current) => !current)}><Settings2 size={16} />参数</button><button type="button" className="editor-history-entry" aria-label="打开当前历史树" title="当前历史树" onClick={() => { setRightPanelOpen(true); setMobileSheet("history"); }}><GitBranch size={16} />当前历史树{historyNodes.length > 0 && <small>{historyNodes.length}</small>}</button><button type="button" className="editor-mobile-canvas-button" onClick={() => setMobileSheet("canvas")}><Palette size={16} />画布</button></div>
      </header>
      <section className={`editor-workspace${rightPanelOpen ? "" : " is-right-collapsed"}${mode === "tiled-upscale" ? " is-tiled-upscale" : ""}`}>
        {mode !== "tiled-upscale" && <aside className="editor-left-panel">{toolPanel}</aside>}
        <div className="editor-stage-wrap">
          <div className="editor-stage" ref={stageRef} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer}>
            <canvas ref={canvasRef} onPointerDown={handlePointerDown} />
            {screenViewport && mode !== "tiled-upscale" && <div className="generation-viewport" style={{ left: screenViewport.x, top: screenViewport.y, width: screenViewport.width, height: screenViewport.height }}>
              <button type="button" className="viewport-badge" onPointerDown={(event) => beginViewportDrag(event, { kind: "viewport", point: worldPoint(event), viewport })}><span>{outputSize.width} × {outputSize.height}</span><small>拖动取景</small></button>
              {(["nw", "ne", "sw", "se"] as const).map((corner) => <span key={corner} className={`viewport-corner ${corner}`} onPointerDown={(event) => beginViewportDrag(event, { kind: "resize", point: worldPoint(event), viewport, corner })} />)}
            </div>}
            {pending && screenViewport && <div className="review-overlay" style={{ left: screenViewport.x, top: screenViewport.y, width: screenViewport.width, height: screenViewport.height, ["--compare" as string]: compare }}>
              <div className="review-patch" style={{ backgroundImage: `url(${pendingPreviewUrl})` }} />
              <div className="review-divider" />
              <div className="review-label merged">已合并</div><div className="review-label original">原图</div>
              <div className="review-compare-handle" role="slider" tabIndex={0} aria-label="拖动比较原图与合成图" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(compare * 100)} aria-valuetext={`${Math.round(compare * 100)}% 合成图区域`}
                onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const bounds = event.currentTarget.parentElement?.getBoundingClientRect(); if (bounds?.width) setCompare(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))); }}
                onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.preventDefault(); event.stopPropagation(); const bounds = event.currentTarget.parentElement?.getBoundingClientRect(); if (bounds?.width) setCompare(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))); }}
                onPointerUp={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onKeyDown={(event) => { const next = event.key === "ArrowLeft" ? compare - 0.02 : event.key === "ArrowRight" ? compare + 0.02 : event.key === "Home" ? 0 : event.key === "End" ? 1 : null; if (next == null) return; event.preventDefault(); event.stopPropagation(); setCompare(Math.max(0, Math.min(1, next))); }}>
                <span className="review-compare-grip"><Move size={16} /></span>
              </div>
            </div>}
          </div>
          <div className="editor-canvas-meta"><span>{mode === "canvas" ? "越界补全" : mode === "tiled-upscale" ? "分块重绘预览" : "蒙版重绘"}</span><span>{mode === "tiled-upscale" ? `倍率 ${tileScale}×` : `世界坐标 ${Math.round(viewport.x)}, ${Math.round(viewport.y)}`}</span></div>
          <div className="editor-zoom"><button type="button" aria-label="缩小" onClick={() => setCamera((current) => zoomCameraAt(current, 0.85, { x: 400, y: 300 }))}><Minus size={16} /></button><span>{Math.round(camera.zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => setCamera((current) => zoomCameraAt(current, 1.18, { x: 400, y: 300 }))}><Plus size={16} /></button><button type="button" aria-label="重置视图" onClick={() => fitCamera(document, viewport)}><RotateCcw size={16} /></button></div>
        </div>
        {rightPanelOpen && <aside className="editor-right-panel"><details open><summary>历史树 <History size={14} /><small>{historyBusy ? "保存中…" : `${historyNodes.length} 个节点`}</small></summary><div>{historyPanel}</div></details><details open data-tutorial="editor-params"><summary>生成参数 <ChevronDown size={14} /></summary><div>{generationPanel}</div></details><details data-tutorial="editor-files"><summary>画布与文件 <ChevronDown size={14} /></summary><div>{canvasPanel}</div></details></aside>}
        <div className={`editor-mobile-sheet${mobileSheet ? " is-open" : ""}`}>
          <div className={`editor-mobile-tabs${mode === "tiled-upscale" ? " is-tiled-upscale" : ""}`}>
            {mode !== "tiled-upscale" && <button type="button" className={mobileSheet === "tools" ? "is-active" : ""} onClick={() => setMobileSheet("tools")}><WandSparkles size={15} />工具</button>}
            <button type="button" className={mobileSheet === "generate" || (mode === "tiled-upscale" && mobileSheet === "tools") ? "is-active" : ""} onClick={() => setMobileSheet("generate")}><Settings2 size={15} />生成</button>
            <button type="button" className={mobileSheet === "canvas" ? "is-active" : ""} onClick={() => setMobileSheet("canvas")}><Palette size={15} />画布</button>
            <button type="button" className={mobileSheet === "history" ? "is-active" : ""} onClick={() => setMobileSheet("history")}><History size={15} />历史</button>
            <button type="button" aria-label={mobileSheet ? "收起编辑面板" : "展开编辑面板"} aria-expanded={Boolean(mobileSheet)} onClick={() => setMobileSheet((current) => current ? null : mode === "tiled-upscale" ? "generate" : "tools")}><ChevronDown size={16} /></button>
          </div>
          {mobileSheet && <div className="editor-mobile-sheet-body">{mode === "tiled-upscale" ? mobileSheet === "history" ? historyPanel : mobileSheet === "canvas" ? canvasPanel : generationPanel : mobileSheet === "tools" ? toolPanel : mobileSheet === "generate" ? generationPanel : mobileSheet === "history" ? historyPanel : canvasPanel}</div>}
        </div>
      </section>
      <footer className="editor-bottombar">
        <div className="editor-status"><span className={generating ? "is-busy" : pending ? "is-review" : ""} />{notice || (generating ? mode === "tiled-upscale" && tileProgress ? `已完成 ${tileProgress.completed}/${tileProgress.total} 块 · 并发 ${tileProgress.active}/${tileProgress.concurrency} 路 · 排队 ${tileProgress.waiting} 块` : "正在生成候选结果…" : pending ? "拖动分隔线比较原图与合成图，可下载 PNG 或应用结果" : mode === "tiled-upscale" ? `自动分块重绘；已完成 ${tileProgress?.completed ?? 0}/${tileProgress?.total ?? tilePlanState.plan?.tiles.length ?? 0} 块` : "拖动生成框定位区域；双指缩放与平移画布")}</div>
        <div className={`editor-actions${mode === "tiled-upscale" ? " is-tiled-upscale" : ""}`}>{generating && <button type="button" className="discard-button" onClick={() => editorGenerationAbortRef.current?.abort()}>取消生成</button>}{pending ? <><ImageDownloadMenu className="download-result-button" label="下载合成图" title="选择合成图下载方式" filename={`lfn-${mode}-${document?.image.width || 0}x${document?.image.height || 0}`} disabled={generating} getImage={() => document && pending ? rgbaImageToBlob(applyPendingCandidate(document, pending).image) : Promise.reject(new Error("没有可下载的合成图"))} /><button type="button" className="regenerate-button" disabled={generating} onClick={regeneratePending}><Sparkles size={16} />重新生成</button><button type="button" className="discard-button" disabled={generating} onClick={discard}><X size={16} />丢弃</button><button type="button" className="apply-button" disabled={generating} onClick={() => void apply()}><Check size={16} />应用到工作台</button></> : <>
          <button type="button" className="generate-button" disabled={generating || (mode === "tiled-upscale" && (!tilePlanState.plan || (usesGatewayImageCapacity && Boolean(gatewayImageCapacity && liveTileConcurrency < 1))))} onClick={() => void generate()}><Sparkles size={17} />{generating ? "生成中…" : mode === "tiled-upscale" ? "分块重绘并拼接" : "生成并预览"}</button>
        </>}</div>
      </footer>
    </main>
  );
}
