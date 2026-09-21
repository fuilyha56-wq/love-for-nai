"use client";

import { inpaintModelFor } from "@/lib/inpaint-model";
import { saveEditorComposite } from "@/lib/editor-composite-history";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Eraser,
  Maximize2,
  Minus,
  Move,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import NextImage from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { PopupSelect } from "@/app/ui/popup-select";
import { WheelNumberInput } from "@/app/ui/wheel-number";
import { syncEditorPromptToStudioForm } from "@/lib/image-studio-form";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyReviewSession,
  createEditorDocument,
  createReviewSession,
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

type EditorClientProps = { authenticated: boolean };
type Tool = "pan" | "brush" | "eraser" | "rectangle";
type EditorStroke = MaskStroke & { shape?: "freehand" | "rectangle" };
type DragState =
  | { kind: "pan"; screen: Point; camera: CameraState }
  | { kind: "pinch"; distance: number; midpoint: Point; camera: CameraState }
  | { kind: "viewport"; point: Point; viewport: GenerationViewport }
  | { kind: "resize"; point: Point; viewport: GenerationViewport; corner: "nw" | "ne" | "sw" | "se" }
  | { kind: "stroke"; stroke: EditorStroke };

const DEFAULT_WIDTH = 832;
const DEFAULT_HEIGHT = 1216;
const MASK_COLORS = ["#a83a4c", "#2d7567", "#6c7fff", "#b47c2a", "#f783ac"];
const INPAINT_MODELS = [
  ["nai-v5-inpaint", "V5 局部重绘"],
  ["nai-v4.5-inpaint", "V4.5 局部重绘"],
  ["nai-v5-inpaint-limit", "V5 局部重绘 · 受限"],
  ["nai-v4.5-inpaint-limit", "V4.5 局部重绘 · 受限"],
  ["nai-v3-inpaint", "V3 动漫局部重绘"],
  ["nai-v3-furry-inpaint", "V3 兽人局部重绘"],
] as const;
const SAMPLERS = [
  ["k_euler_ancestral", "欧拉祖先"],
  ["k_euler", "欧拉"],
  ["k_dpmpp_2s_ancestral", "DPM++ 2S 祖先"],
  ["k_dpmpp_2m", "DPM++ 2M"],
] as const;

async function dataUrlToRgba(dataUrl: string): Promise<RgbaImage> {
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return createRgbaImage(canvas.width, canvas.height, pixels.data);
}

function rgbaToDataUrl(image: RgbaImage, white = false): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  const output = new Uint8ClampedArray(image.data);
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
  context.putImageData(new ImageData(output, image.width, image.height), 0, 0);
  return canvas.toDataURL("image/png");
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
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
  const patch = createRgbaImage(candidate.patch.width, candidate.patch.height, candidate.patch.data);
  const rawMask = candidate.mask && typeof candidate.mask === "object" && "data" in candidate.mask
    ? candidate.mask.data
    : candidate.mask;
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

function viewportImage(document: EditorDocument, viewport: GenerationViewport, output: { width: number; height: number }): { image: RgbaImage; mask: Uint8ClampedArray } {
  const width = Math.max(64, Math.min(1600, Math.round(output.width / 64) * 64));
  const height = Math.max(64, Math.min(1600, Math.round(output.height / 64) * 64));
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

function fitViewport(document: EditorDocument, width: number, height: number): GenerationViewport {
  const sourceWidth = Math.max(64, Math.min(1600, document.image.width));
  const sourceHeight = Math.max(64, Math.min(1600, document.image.height));
  const aspect = width / height;
  let viewportWidth = sourceWidth;
  let viewportHeight = Math.round(viewportWidth / aspect);
  if (viewportHeight > sourceHeight) {
    viewportHeight = sourceHeight;
    viewportWidth = Math.round(viewportHeight * aspect);
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

export default function EditorClient({ authenticated }: EditorClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draftId");
  const mode = searchParams.get("mode") === "canvas" ? "canvas" : "inpaint";
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const [mobileSheet, setMobileSheet] = useState<"tools" | "generate" | "canvas" | null>("tools");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState("");
  const [strokes, setStrokes] = useState<EditorStroke[]>([]);
  const [undone, setUndone] = useState<EditorStroke[]>([]);
  const [pending, setPending] = useState<PendingCandidate | null>(null);
  const [compare, setCompare] = useState(0.5);
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [busy, setBusy] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [model, setModel] = useState("nai-v5-inpaint");
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [strength, setStrength] = useState(0.7);
  const [sampler, setSampler] = useState("k_euler_ancestral");
  const [seed, setSeed] = useState("");

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
        const loaded = await loadEditorDraft(draftId);
        if (cancelled) return;
        if (!loaded) throw new Error("编辑草稿不存在或已过期");
        const nextDocument = imageFromDraft(loaded);
        const generation = nextDocument.generation;
        const outputWidth = generation?.width || DEFAULT_WIDTH;
        const outputHeight = generation?.height || DEFAULT_HEIGHT;
        const nextViewport = fitViewport(nextDocument, outputWidth, outputHeight);
        setDraft(loaded);
        setDocument(nextDocument);
        setViewport(nextViewport);
        setViewportSize({ width: outputWidth, height: outputHeight });
        setPrompt(nextDocument.prompt || "");
        setNegative(nextDocument.negativePrompt || "");
        syncEditorPromptToStudioForm(loaded.id, nextDocument.prompt || "", nextDocument.negativePrompt || "");
        const nextModel = inpaintModelFor(generation?.model || "nai-v5-full");
        if (!nextModel) throw new Error(`当前模型 ${generation?.model} 没有对应的重绘模型，请返回工作台选择支持重绘的模型。`);
        setModel(nextModel);
        setSteps(generation?.steps || 28);
        setScale(generation?.scale ?? 5);
        setStrength(generation?.strength ?? 0.7);
        setSampler(generation?.sampler || "k_euler_ancestral");
        setSeed(nextDocument.seed == null ? "" : String(nextDocument.seed));
        if (loaded.workspace) {
          setViewport({ ...loaded.workspace.viewport });
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
    const imageCanvas = window.document.createElement("canvas");
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const imageContext = imageCanvas.getContext("2d");
    if (!imageContext) return;
    imageContext.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    const imageRect = worldRectToScreen(document.worldRect, camera);
    context.imageSmoothingEnabled = true;
    context.drawImage(imageCanvas, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    if (viewport) {
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
  }, [camera, canvasBackground, document, maskColor, maskOpacity, showMaskPreview, strokes, viewport]);

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
      const next = resizeViewport(drag.viewport, drag.corner, point, { aspect: viewportSize.width / viewportSize.height, minWidth: 128, minHeight: 128 });
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

  const createDraftPayload = (nextDocument: EditorDocument, review?: EditorDraft["review"]): EditorDraft => {
    const synchronized: EditorDocument = {
      ...nextDocument,
      prompt,
      negativePrompt: negative,
      seed: seed.trim() || null,
      generation: { model, width: viewportSize.width, height: viewportSize.height, steps, scale, strength, sampler, noiseSchedule: nextDocument.generation?.noiseSchedule || "native" },
    };
    return {
      ...createEditorDraft(draft?.id || createEditorId(), mode, synchronized, review),
      createdAt: draft?.createdAt || Date.now(),
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
  }, [brushSize, camera, canvasBackground, document, draft?.id, maskColor, maskOpacity, mode, model, negative, pending, prompt, ready, sampler, scale, seed, showMaskPreview, steps, strength, strokes, tool, undone, viewport, viewportSize.height, viewportSize.width]);

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
    if (draftId) syncEditorPromptToStudioForm(draftId, value, negative);
  };

  const updateNegative = (value: string) => {
    setNegative(value);
    if (draftId) syncEditorPromptToStudioForm(draftId, prompt, value);
  };

  const updateOutputSize = (next: { width?: number; height?: number }) => {
    const width = next.width ?? viewportSize.width;
    const height = next.height ?? viewportSize.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setViewportSize({ width, height });
    setViewport((current) => current ? { ...current, height: current.width / (width / height) } : current);
  };

  const refreshMaskPreview = () => {
    if (!document || !viewport) return;
    const prepared = viewportImage(document, viewport, viewportSize);
    applyStrokes(prepared.mask, prepared.image.width, prepared.image.height, viewport, strokes);
    setMaskPreviewUrl(maskToPngDataUrl(prepared.mask, prepared.image.width, prepared.image.height));
  };

  const generate = async () => {
    if (!document || !viewport) return;
    if (!authenticated) { setNotice("请先登录后使用编辑器。"); return; }
    if (seed.trim() && (!/^[+-]?\d+$/.test(seed.trim()) || !Number.isSafeInteger(Number(seed)))) {
      setNotice("种子必须为空或有效整数。");
      return;
    }
    if (viewportSize.width * viewportSize.height > 2_560_000) {
      setNotice("输出像素不能超过 2560000。");
      return;
    }
    setGenerating(true); setNotice("");
    try {
      const prepared = viewportImage(document, viewport, viewportSize);
      applyStrokes(prepared.mask, prepared.image.width, prepared.image.height, viewport, strokes);
      if (!prepared.mask.some((value) => value > 0))
        throw new Error("请先绘制重绘蒙版，或把生成框移动到原图外扩展画布。");
      const body = {
        operation: mode === "canvas" ? "outpainting" : "inpainting",
        editor_composite: true,
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
        ...(seed.trim() ? { seed: Number(seed) } : {}),
        image: rgbaToDataUrl(prepared.image),
        mask: maskToPngDataUrl(prepared.mask, prepared.image.width, prepared.image.height),
        response_format: "b64_json",
      };
      const response = await fetch("/api/images/operate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const resultUrl = await readGenerationResponse(response);
      const patch = await dataUrlToRgba(resultUrl);
      const candidate: PendingCandidate = { id: createEditorId(), patch, viewport: { ...viewport }, mask: prepared.mask, prompt, createdAt: Date.now() };
      setPending(candidate);
      setCompare(0.5);
      setNotice("生成完成。拖动中间分割线比较，确认后点击应用。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生成失败，请稍后重试");
    } finally { setGenerating(false); }
  };

  const returnToStudio = () => {
    if (draftId && document) syncEditorPromptToStudioForm(draftId, prompt, negative);
    router.push("/image");
  };

  const apply = async () => {
    if (!document || !pending) return;
    try {
      const review = createReviewSession(document, pending);
      const applied = applyReviewSession(review).document;
      const nextDraft = await saveEditorDraft(createDraftPayload(applied));
      const finalImage = rgbaToDataUrl(applied.image);
      let historyId = "";
      try {
        historyId = await saveEditorComposite({
          image: finalImage, model, prompt, negative_prompt: negative,
          width: applied.image.width, height: applied.image.height,
          steps, scale, sampler, strength,
          ...(seed.trim() ? { seed: Number(seed) } : {}),
        });
      } catch (error) {
        setNotice(`${error instanceof Error ? error.message : "完整合成图未写入历史"}，结果仍会返回工作台。`);
      }
      const historyQuery = historyId ? `&editorHistory=${encodeURIComponent(historyId)}` : "";
      syncEditorPromptToStudioForm(nextDraft.id, prompt, negative);
      router.push(`/image?editorResult=${encodeURIComponent(nextDraft.id)}${historyQuery}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "应用结果失败"); }
  };

  const discard = () => { setPending(null); setNotice("已丢弃本次生成，原图未改变。"); };

  const download = (white: boolean) => {
    if (!document) return;
    downloadDataUrl(rgbaToDataUrl(document.image, white), white ? "lfn-canvas-white.png" : "lfn-canvas-transparent.png");
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
        seed: seed || null,
        source: { name: file.name, mimeType: file.type },
        generation: { model, width: viewportSize.width, height: viewportSize.height, steps, scale, strength, sampler, noiseSchedule: document?.generation?.noiseSchedule },
      });
      const nextViewport = fitViewport(nextDocument, viewportSize.width, viewportSize.height);
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
  if (!ready || !document || !viewport) return <main className="image-editor-page"><div className="editor-error"><p>{notice || "无法打开编辑器"}</p><button type="button" onClick={returnToStudio}>返回工作台</button></div></main>;

  const toolPanel = (
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
      {maskPreviewUrl && <div className="editor-mask-preview"><NextImage src={maskPreviewUrl} alt="实际黑白蒙版预览" width={viewportSize.width} height={viewportSize.height} unoptimized /><button type="button" onClick={() => setMaskPreviewUrl("")}>关闭预览</button></div>}
      <div className="editor-history-actions"><button type="button" disabled={!strokes.length || Boolean(pending)} onClick={() => { const next = [...strokes]; const removed = next.pop(); if (removed) setUndone((current) => [removed, ...current]); setStrokes(next); }}><Undo2 size={15} />撤销</button><button type="button" disabled={!undone.length || Boolean(pending)} onClick={() => { const next = [...undone]; const restored = next.shift(); if (restored) setStrokes((current) => [...current, restored]); setUndone(next); }}><Redo2 size={15} />重做</button><button type="button" disabled={!strokes.length || Boolean(pending)} onClick={() => { setStrokes([]); setUndone([]); }}><Trash2 size={15} />清空</button></div>
    </>
  );

  const generationPanel = (
    <>
      <div className="editor-panel-heading"><span><Settings2 size={15} />生成设置</span><small>{viewportSize.width} × {viewportSize.height}</small></div>
      <label className="editor-field"><span>模型</span><PopupSelect value={model} onChange={setModel} options={INPAINT_MODELS.map(([value, label]) => ({ value, label }))} ariaLabel="重绘模型" /></label>
      <div className="editor-size-row"><label><span>宽度</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器输出宽度" min={64} max={1600} step={64} value={viewportSize.width} setValue={(value) => updateOutputSize({ width: value })} /></label><button type="button" aria-label="交换宽高" onClick={() => updateOutputSize({ width: viewportSize.height, height: viewportSize.width })}>×</button><label><span>高度</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器输出高度" min={64} max={1600} step={64} value={viewportSize.height} setValue={(value) => updateOutputSize({ height: value })} /></label></div>
      <div className="editor-parameter-grid"><label><span>步数</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器采样步数" min={1} max={50} step={1} value={steps} setValue={setSteps} /></label><label><span>CFG</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器提示词相关性" min={0} max={10} step={0.1} value={scale} setValue={setScale} /></label><label><span>强度</span><WheelNumberInput className="editor-number-input" ariaLabel="编辑器重绘强度" min={0} max={1} step={0.05} value={strength} setValue={setStrength} /></label><label><span>种子</span><input className="editor-text-input" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="随机" /></label></div>
      <label className="editor-field"><span>采样器</span><PopupSelect value={sampler} onChange={setSampler} options={SAMPLERS.map(([value, label]) => ({ value, label }))} ariaLabel="编辑器采样器" /></label>
      <label className="editor-field"><span>描述画面</span><textarea value={prompt} onChange={(event) => updatePrompt(event.target.value)} placeholder="描述要生成或补全的内容…" /></label>
      <label className="editor-field"><span>排除内容</span><textarea className="is-short" value={negative} onChange={(event) => updateNegative(event.target.value)} placeholder="不希望出现的内容…" /></label>
      <p className="editor-tip">生成框可越过原图边缘；透明部分会自动加入蒙版。结果只在点击“应用”后写入画布。</p>
    </>
  );

  const canvasPanel = (
    <>
      <div className="editor-panel-heading"><span><Palette size={15} />画布与文件</span><small>继承 LFN 外观</small></div>
      <div className="editor-option-group"><span>工作区背景（仅预览）</span><div className="editor-choice-grid">{([['checker','棋盘格'],['white','白色'],['dark','深色']] as const).map(([value,label]) => <button type="button" key={value} className={canvasBackground === value ? "is-active" : ""} onClick={() => setCanvasBackground(value)}>{label}</button>)}</div></div>
      <input ref={sourceInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden tabIndex={-1} aria-hidden="true" onChange={(event) => void replaceSource(event.target.files?.[0])} />
      <button type="button" className="editor-fit-button" onClick={() => sourceInputRef.current?.click()}><Maximize2 size={15} />替换源图片</button>
      <button type="button" className="editor-fit-button" onClick={() => fitCamera(document, viewport)}><RotateCcw size={15} />适配画布与生成框</button>
      <div className="editor-export-grid"><button type="button" onClick={() => download(false)}><Download size={15} />透明 PNG</button><button type="button" onClick={() => download(true)}><Download size={15} />白底 PNG</button></div>
      <p className="editor-tip">编辑器自动沿用 LFN 的主题、强调色、密度和动效设置。画布背景只用于预览，不会写入图片。</p>
    </>
  );

  return (
    <main className="image-editor-page">
      <header className="editor-topbar">
        <button type="button" className="editor-icon-button" aria-label="返回工作台" onClick={returnToStudio}><ArrowLeft size={18} /></button>
        <div className="editor-title"><strong>{mode === "canvas" ? "无限画布" : "精细重绘"}</strong><span>LFN 图像编辑器 · {document.image.width} × {document.image.height}</span></div>
        <div className="editor-mode-tabs"><button type="button" className={mode === "inpaint" ? "is-active" : ""} onClick={() => router.replace(`/image/editor?draftId=${draftId}&mode=inpaint`)}>精细重绘</button><button type="button" className={mode === "canvas" ? "is-active" : ""} onClick={() => router.replace(`/image/editor?draftId=${draftId}&mode=canvas`)}>无限画布</button></div>
        <div className="editor-top-actions"><button type="button" onClick={() => setRightPanelOpen((current) => !current)}><Settings2 size={16} />参数</button><button type="button" className="editor-mobile-canvas-button" onClick={() => setMobileSheet("canvas")}><Palette size={16} />画布</button></div>
      </header>
      <section className={`editor-workspace${rightPanelOpen ? "" : " is-right-collapsed"}`}>
        <aside className="editor-left-panel">{toolPanel}</aside>
        <div className="editor-stage-wrap">
          <div className="editor-stage" ref={stageRef} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer}>
            <canvas ref={canvasRef} onPointerDown={handlePointerDown} />
            {screenViewport && <div className="generation-viewport" style={{ left: screenViewport.x, top: screenViewport.y, width: screenViewport.width, height: screenViewport.height }}>
              <button type="button" className="viewport-badge" onPointerDown={(event) => beginViewportDrag(event, { kind: "viewport", point: worldPoint(event), viewport })}><span>{viewportSize.width} × {viewportSize.height}</span><small>拖动取景</small></button>
              {(["nw", "ne", "sw", "se"] as const).map((corner) => <span key={corner} className={`viewport-corner ${corner}`} onPointerDown={(event) => beginViewportDrag(event, { kind: "resize", point: worldPoint(event), viewport, corner })} />)}
            </div>}
            {pending && screenViewport && <div className="review-overlay" style={{ left: screenViewport.x, top: screenViewport.y, width: screenViewport.width, height: screenViewport.height, ["--compare" as string]: compare }}><div className="review-patch" style={{ backgroundImage: `url(${maskedPatchDataUrl(pending)})` }} /><div className="review-divider" /><div className="review-label merged">已合并</div><div className="review-label original">原图</div><input aria-label="原图与合成图比较位置" type="range" min="0" max="1" step="0.01" value={compare} onChange={(event) => setCompare(Number(event.target.value))} /></div>}
          </div>
          <div className="editor-canvas-meta"><span>{mode === "canvas" ? "越界补全" : "蒙版重绘"}</span><span>世界坐标 {Math.round(viewport.x)}, {Math.round(viewport.y)}</span></div>
          <div className="editor-zoom"><button type="button" aria-label="缩小" onClick={() => setCamera((current) => zoomCameraAt(current, 0.85, { x: 400, y: 300 }))}><Minus size={16} /></button><span>{Math.round(camera.zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => setCamera((current) => zoomCameraAt(current, 1.18, { x: 400, y: 300 }))}><Plus size={16} /></button><button type="button" aria-label="重置视图" onClick={() => fitCamera(document, viewport)}><RotateCcw size={16} /></button></div>
        </div>
        {rightPanelOpen && <aside className="editor-right-panel"><details open><summary>生成参数 <ChevronDown size={14} /></summary><div>{generationPanel}</div></details><details open><summary>画布与文件 <ChevronDown size={14} /></summary><div>{canvasPanel}</div></details></aside>}
        <div className={`editor-mobile-sheet${mobileSheet ? " is-open" : ""}`}>
          <div className="editor-mobile-tabs"><button type="button" className={mobileSheet === "tools" ? "is-active" : ""} onClick={() => setMobileSheet("tools")}><WandSparkles size={15} />工具</button><button type="button" className={mobileSheet === "generate" ? "is-active" : ""} onClick={() => setMobileSheet("generate")}><Settings2 size={15} />生成</button><button type="button" className={mobileSheet === "canvas" ? "is-active" : ""} onClick={() => setMobileSheet("canvas")}><Palette size={15} />画布</button><button type="button" aria-label="收起编辑面板" onClick={() => setMobileSheet(null)}><ChevronDown size={16} /></button></div>
          {mobileSheet && <div className="editor-mobile-sheet-body">{mobileSheet === "tools" ? toolPanel : mobileSheet === "generate" ? generationPanel : canvasPanel}</div>}
        </div>
      </section>
      <footer className="editor-bottombar">
        <div className="editor-status"><span className={generating ? "is-busy" : pending ? "is-review" : ""} />{notice || (generating ? "正在生成候选结果…" : pending ? "拖动分割线比较，应用或丢弃结果" : "拖动生成框定位区域；双指缩放与平移画布")}</div>
        <div className="editor-actions">{pending ? <><button type="button" className="regenerate-button" onClick={() => { setPending(null); void generate(); }}><Sparkles size={16} />重新生成</button><button type="button" className="discard-button" onClick={discard}><X size={16} />丢弃</button><button type="button" className="apply-button" onClick={() => void apply()}><Check size={16} />应用到工作台</button></> : <button type="button" className="generate-button" disabled={generating} onClick={() => void generate()}><Sparkles size={17} />{generating ? "生成中…" : "生成并预览"}</button>}</div>
      </footer>
    </main>
  );
}
