"use client";

import {
  Aperture,
  Brush,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Download,
  Eraser,
  Eye,
  FileUp,
  ImagePlus,
  ImageIcon,
  Images,
  Megaphone,
  Menu,
  Maximize2,
  Paintbrush,
  PawPrint,
  Plus,
  Redo2,
  Search,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  UserRound,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PopupSelect, type SelectOption } from "@/app/ui/popup-select";
import { WheelNumberInput } from "@/app/ui/wheel-number";
import { useAppearance } from "@/app/appearance";
import { NaiImageSettings, MAX_NAI_IMAGE_COUNT } from "./nai-image-settings";
import { NaiBalanceMeter } from "./nai-balance-meter";
import { GalleryPicker } from "./gallery-picker";
import {
  clearEditorPromptHandoff,
  clearImageStudioForm,
  loadEditorPromptHandoff,
  loadImageStudioForm,
  saveImageStudioForm,
  syncEditorPromptToStudioForm,
  type ImageStudioFormSnapshot,
} from "@/lib/image-studio-form";
import {
  loadCustomLayout,
} from "@/lib/appearance-store";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  clampPoint,
  normalizeRect,
  selectionToPatch,
  type Rect,
} from "@/lib/image-roi";
import {
  createEditorDocument,
  createRgbaImage,
} from "@/lib/image-editor";
import {
  createEditorDraft,
  deleteEditorDraft,
  loadEditorDraft,
  saveEditorDraft,
} from "@/lib/image-editor-store";

type Props = { userName: string; authenticated: boolean };

function clampPanel(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

import {
  estimateNewApiCost,
  affCost as estimateAff,
  UPSCALE_MAX_PIXELS,
  upscaleAnlasCost,
  type ModelPricingSnapshot,
} from "@/lib/image-pricing";

type Me = { user?: { balance: number | null; group: string } };
type Aff = {
  balance: number;
  packageBalance: number;
  totalBalance: number;
  packageRateLimitRemaining: number;
};

type WalletState = {
  aff?: Aff & { enabled?: boolean };
  imagePackage?: {
    balance: number;
    totalBalance: number;
    priceUsd: number;
    affPerPackage: number;
    rateLimit: number;
    purchaseEnabled: boolean;
  };
  newApi?: { balance: number; used: number; group: string };
};
type Operation =
  | "generate"
  | "img2img"
  | "inpainting"
  | "edits"
  | "vibe-transfer"
  | "character-reference"
  | "precise-reference"
  | "annotate"
  | "upscale"
  | "director-declutter"
  | "director-bg-remover"
  | "director-lineart"
  | "director-sketch"
  | "director-colorize"
  | "director-emotion"
  | "suggest-tags";
type Upload = { data: string; name: string };
type SessionResult = {
  id: string;
  image: string;
  historyId?: string;
  operation: Operation;
  createdAt: number;
};

async function consumeImageStream(
  response: Response,
  options: {
    expected: number;
    onPreview: (images: string[]) => void;
    onProgress: (label: string) => void;
    onComplete?: (historyIds: string[]) => void;
  },
): Promise<string[]> {
  if (!response.body) throw new Error("上游未返回流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";
  const previews: string[] = Array.from({ length: options.expected }, () => "");
  const finals: string[] = Array.from({ length: options.expected }, () => "");
  let doneImages: string[] | null = null;
  let errorMessage = "";
  const applySlot = (target: string[], sampleIndex: number, image: string) => {
    const index = Math.max(0, sampleIndex);
    while (target.length <= index) target.push("");
    target[index] = image;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      leftover += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = leftover.split("\n\n");
      leftover = done ? "" : blocks.pop() || "";
      for (const block of blocks) {
        const eventMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*(.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        const event = eventMatch[1].trim();
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(dataMatch[1]) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event === "error") {
          errorMessage = String(payload.message || "流式生成失败");
          continue;
        }
        if (event === "preview" || event === "final") {
          const image = typeof payload.image === "string" ? payload.image : "";
          const sampleIndex =
            typeof payload.sampleIndex === "number" ? payload.sampleIndex : 0;
          if (!image) continue;
          if (event === "final") applySlot(finals, sampleIndex, image);
          else applySlot(previews, sampleIndex, image);
          const visible = (event === "final" ? finals : previews).filter(Boolean);
          options.onPreview(visible.length ? visible : [image]);
          const currentStep =
            typeof payload.currentStep === "number" ? payload.currentStep : 0;
          const totalSteps =
            typeof payload.totalSteps === "number" ? payload.totalSteps : 0;
          if (totalSteps)
            options.onProgress(
              `${Math.min(currentStep, totalSteps)}/${totalSteps} 步`,
            );
        }
        if (event === "done") {
          const images = Array.isArray(payload.images)
            ? payload.images.filter((item): item is string => typeof item === "string")
            : [];
          const historyIds = Array.isArray(payload.historyIds)
            ? payload.historyIds.filter((item): item is string => typeof item === "string")
            : [];
          options.onComplete?.(historyIds);
          if (images.length) doneImages = images;
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (errorMessage) throw new Error(errorMessage);
  const completed = finals.filter(Boolean);
  return doneImages?.length ? doneImages : completed;
}
// 多角色：每角色独立 prompt + 画面中心坐标（对齐 NAI Character Prompts）。
type CharacterPromptUi = {
  id: string;
  prompt: string;
  centerX: number;
  centerY: number;
};
type DanbooruTag = {
  name: string;
  displayName: string;
  categoryName: string;
  postCount: number;
};
type AssistantSuggestion = {
  message?: string;
  englishDescription?: string;
  prompt: string;
  negativePrompt: string;
  tags: DanbooruTag[];
  characters?: Array<{
    prompt: string;
    centerX: number;
    centerY: number;
  }>;
  parameters: {
    width?: number;
    height?: number;
    steps?: number;
    scale?: number;
    sampler?: string;
    noiseSchedule?: string;
    seed?: number;
  };
};
type AgentStep = { tool: string; query: string; ok: boolean; summary?: string };

// 持久化对话：历史轮次（新→旧）与跨轮次累积的标签池。
type ConversationTurnUi = {
  id: string;
  request: string;
  createdAt: string;
  message?: string;
  englishDescription?: string;
  prompt: string;
  negativePrompt: string;
  parameters: Record<string, unknown>;
  tags: DanbooruTag[];
  rejectedTags: string[];
  unverifiedTags: string[];
  steps: AgentStep[];
};
type ConversationUi = {
  turns: ConversationTurnUi[];
  tagPool: DanbooruTag[];
};

// 检索过程里展示用的工具中文名。
const agentToolLabels: Record<string, string> = {
  search_danbooru_tags: "检索 Danbooru",
  verify_danbooru_tag: "校验标签",
  read_danbooru_wiki: "读取词条",
  web_search: "概念检索",
};

const models: SelectOption[] = [
  { value: "nai-v5-full", label: "V5 完整版" },
  { value: "nai-v5-curated", label: "V5 精选版" },
  { value: "nai-v5-inpaint", label: "V5 局部重绘" },
  { value: "nai-v5-full-limit", label: "V5 完整版（受限）" },
  { value: "nai-v5-curated-limit", label: "V5 精选版（受限）" },
  { value: "nai-v5-inpaint-limit", label: "V5 局部重绘（受限）" },
  { value: "nai-v4.5-full", label: "V4.5 完整版" },
  { value: "nai-v4.5-curated", label: "V4.5 精选版" },
  { value: "nai-v4.5-inpaint", label: "V4.5 局部重绘" },
  { value: "nai-v4.5-full-limit", label: "V4.5 完整版（受限）" },
  { value: "nai-v4.5-curated-limit", label: "V4.5 精选版（受限）" },
  { value: "nai-v4.5-inpaint-limit", label: "V4.5 局部重绘（受限）" },
  { value: "nai-v4-curated", label: "V4 精选版" },
  { value: "nai-v3", label: "V3 动漫" },
  { value: "nai-v3-furry", label: "V3 兽人" },
  { value: "nai-v3-inpaint", label: "V3 动漫局部重绘" },
  { value: "nai-v3-furry-inpaint", label: "V3 兽人局部重绘" },
];
const samplers: SelectOption[] = [
  { value: "k_euler", label: "欧拉" },
  { value: "k_euler_ancestral", label: "欧拉祖先" },
  { value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S 祖先" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M" },
  { value: "k_dpmpp_2m_sde", label: "DPM++ 2M SDE" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE" },
  { value: "ddim_v3", label: "DDIM V3" },
];
const schedules: SelectOption[] = [
  { value: "native", label: "原生" },
  { value: "karras", label: "Karras" },
  { value: "exponential", label: "指数" },
  { value: "polyexponential", label: "多项式指数" },
];
const modes: Array<{ id: Operation; label: string }> = [
  { id: "generate", label: "生成" },
  { id: "img2img", label: "图生图" },
  { id: "inpainting", label: "局部重绘" },
  { id: "edits", label: "蒙版编辑" },
  { id: "vibe-transfer", label: "Vibe" },
  { id: "character-reference", label: "角色参考" },
  { id: "precise-reference", label: "精准参考" },
  { id: "annotate", label: "控制图" },
  { id: "upscale", label: "放大" },
  { id: "director-declutter", label: "去杂物" },
  { id: "director-bg-remover", label: "移除背景" },
  { id: "director-lineart", label: "提取线稿" },
  { id: "director-sketch", label: "草图化" },
  { id: "director-colorize", label: "线稿上色" },
  { id: "director-emotion", label: "情感迁移" },
  { id: "suggest-tags", label: "标签建议" },
];
const modeOptions: SelectOption[] = modes.map(({ id, label }) => ({
  value: id,
  label,
}));
const referenceOperations: Array<{
  id: Operation;
  label: string;
  detail: string;
}> = [
  { id: "img2img", label: "图生图", detail: "根据已有图片重新创作。" },
  { id: "inpainting", label: "局部重绘", detail: "重新绘制蒙版覆盖区域。" },
  {
    id: "vibe-transfer",
    label: "氛围迁移",
    detail: "借用参考图的视觉概念。",
  },
  {
    id: "character-reference",
    label: "角色参考",
    detail: "保持角色的身份特征。",
  },
  {
    id: "precise-reference",
    label: "精准参考",
    detail: "精确参考角色或画面风格。",
  },
];
const toolOperations = modeOptions.filter(
  ({ value }) =>
    !["generate", ...referenceOperations.map(({ id }) => id)].includes(value),
);
const imageInputModes = new Set<Operation>(
  modes.map((item) => item.id).filter((id) => id !== "generate"),
);
const promptModes = new Set<Operation>([
  "generate",
  "img2img",
  "inpainting",
  "edits",
  "vibe-transfer",
  "character-reference",
  "precise-reference",
  "director-colorize",
  "director-emotion",
]);
const generationModes = new Set<Operation>([
  "generate",
  "img2img",
  "inpainting",
  "edits",
  "vibe-transfer",
  "character-reference",
  "precise-reference",
]);

const unsupportedOperations = new Set<Operation>(["annotate"]);
const acceptedUploadTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_UPLOAD_SIZE = 15 * 1024 * 1024;
const ASSISTANT_POLL_INTERVAL_MS = 2_000;
const ASSISTANT_MAX_POLLS = 60;
const ASSISTANT_TIMEOUT_MS = 2 * 60 * 1_000;
const ASSISTANT_MESSAGE_MAX = 500;
const defaultPrompt =
  "masterpiece, best quality, 1girl, white hair, crimson eyes, intricate kimono, soft window light";
const defaultNegative = "lowres, bad anatomy, blurry, text, watermark";

type GenerationValidationInput = {
  operation: Operation;
  width: number;
  height: number;
  steps: number;
  scale: number;
  count: number;
  cfgRescale: number;
  seed: string;
  strength: number;
  source: Upload | null;
  mask: Upload | null;
};

export function validateGenerationParameters({
  operation,
  width,
  height,
  steps,
  scale,
  count,
  cfgRescale,
  seed,
  strength,
  source,
  mask,
}: GenerationValidationInput): string | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > 1600 ||
    height > 1600 ||
    width % 64 !== 0 ||
    height % 64 !== 0
  )
    return "宽高必须是 64–1600 之间的整数，并且是 64 的倍数。";
  if (!Number.isInteger(steps) || steps < 1 || steps > 50)
    return "采样步数必须是 1–50 之间的整数。";
  if (!Number.isFinite(scale) || scale < 0 || scale > 10)
    return "提示词相关性必须是 0–10 之间的有效数字。";
  if (!Number.isInteger(count) || count < 1 || count > MAX_NAI_IMAGE_COUNT)
    return `生成张数必须是 1-${MAX_NAI_IMAGE_COUNT} 之间的整数。`;
  if (!Number.isFinite(cfgRescale) || cfgRescale < 0 || cfgRescale > 1)
    return "CFG 重缩放必须是 0–1 之间的有效数字。";
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    return "变化强度必须是 0–1 之间的有效数字。";
  const seedValue = seed.trim();
  if (
    seedValue &&
    (!/^[+-]?\d+$/.test(seedValue) || !Number.isSafeInteger(Number(seedValue)))
  )
    return "种子必须为空或有效的整数。";
  if (unsupportedOperations.has(operation))
    return `${modes.find((item) => item.id === operation)?.label || "该操作"}当前暂不支持提交，暂无可审计的计费映射。`;
  if (imageInputModes.has(operation) && operation !== "suggest-tags" && !source)
    return "请先上传操作所需的图片。";
  if (["inpainting", "edits"].includes(operation) && !mask)
    return "该模式需要源图片和蒙版图片。";
  return null;
}

export function validateUploadFile(
  file?: { type?: string; size?: number } | null,
): string | null {
  if (!file || !acceptedUploadTypes.has(file.type || ""))
    return "仅支持 PNG、JPEG 或 WEBP 图片。";
  if (file.size == null || !Number.isFinite(file.size) || file.size > MAX_UPLOAD_SIZE)
    return "图片不能超过 15 MB。";
  return null;
}

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  const image = new window.Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片解码失败，请重新上传"));
    image.src = dataUrl;
  });
  return image;
}

function editorImageDataUrl(image: { width: number; height: number; data: Uint8ClampedArray }): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas.toDataURL("image/png");
}

// 超分只收 PNG：把任意受支持格式按原始尺寸重编码为 PNG data URL。
async function toPngDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImageElement(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas，无法转换图片");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function createAbortError(): Error {
  const error = new Error("智能助手任务已取消");
  error.name = "AbortError";
  return error;
}

function waitForAssistantPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default function ImageStudio({ userName, authenticated }: Props) {
  const { preferences } = useAppearance();
  const naiLayout = preferences.theme === "nai";
  const nlwLayout = !naiLayout && (preferences.workspaceLayout === "nlw" || preferences.workspaceLayout === "custom");
  const sidebarPromptLayout = naiLayout || nlwLayout;
  const [operation, setOperation] = useState<Operation>("generate");
  const [contentMode, setContentMode] = useState<"anime" | "furry">("anime");
  const [model, setModel] = useState(models[0].value);
  const [width, setWidth] = useState(832);
  const [height, setHeight] = useState(1216);
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [count, setCount] = useState(1);
  // 生成张数提交方式：分批次（默认，每 0.5s 发一张 n=1）或一次性（单请求 n 张）。
  const [batchMode, setBatchMode] = useState<"once" | "sequential">("sequential");
  const [batchProgress, setBatchProgress] = useState("");
  const [sampler, setSampler] = useState("k_euler_ancestral");
  const [schedule, setSchedule] = useState("native");
  // 0 表示关闭重缩放；非 0 会被 NovelAI 部分模型拒绝，因此默认不启用。
  const [cfgRescale, setCfgRescale] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const [strength, setStrength] = useState(0.7);
  const [vibeStrength, setVibeStrength] = useState(0.6);
  const [vibeInformationExtracted, setVibeInformationExtracted] = useState(1);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [negative, setNegative] = useState(defaultNegative);
  const [source, setSource] = useState<Upload | null>(null);
  const [mask, setMask] = useState<Upload | null>(null);
  const [charactersEnabled, setCharactersEnabled] = useState(false);
  const [characters, setCharacters] = useState<CharacterPromptUi[]>([
    { id: "char-1", prompt: "", centerX: 0.5, centerY: 0.5 },
  ]);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  // 全屏拖放遮罩：dragenter/dragleave 计数，离开窗口才收起。
  const [dropActive, setDropActive] = useState(false);
  // 底部生成参数组折叠状态（采样步数/相关性/种子/采样器）。
  const [paramsOpen, setParamsOpen] = useState(false);
  // 站内菜单抽屉（账号、创作入口与外链）。
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDirectorOpen, setMenuDirectorOpen] = useState(false);
  const [referenceType, setReferenceType] = useState("character&style");
  const [controlModel, setControlModel] = useState("hed");
  // 超分（V5 扩散超分）：模型二选一 + 源图真实尺寸（决定档位费用与 2x 输出）。
  const [upscaleModel, setUpscaleModel] = useState("nai-diffusion-5-curated");
  const [upscaleSource, setUpscaleSource] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [aff, setAff] = useState<Aff | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [previewDrafts, setPreviewDrafts] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<SessionResult[]>([]);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadCustomLayout().rightCollapsed;
  });
  const rightPanelCloseTimer = useRef<number | null>(null);
  const [streamProgress, setStreamProgress] = useState("");
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);

  const [tagResults, setTagResults] = useState<DanbooruTag[]>([]);
  const [tagSearching, setTagSearching] = useState(false);
  const [assistantModels, setAssistantModels] = useState<SelectOption[]>([]);
  const [assistantModel, setAssistantModel] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  // 随需求发给视觉模型的参考图（data URL）。
  const [agentImage, setAgentImage] = useState<string | null>(null);
  const [agentImageZoom, setAgentImageZoom] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantSuggestion, setAssistantSuggestion] =
    useState<AssistantSuggestion | null>(null);
  const [conversation, setConversation] = useState<ConversationUi>({
    turns: [],
    tagPool: [],
  });
  const [conversationOpen, setConversationOpen] = useState(false);
  const [modelPricing, setModelPricing] = useState<ModelPricingSnapshot | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantTimeoutRef = useRef<number | null>(null);
  const mobilePanelRef = useRef<HTMLElement>(null);
  const mobileToolsRef = useRef<HTMLElement>(null);
  const mobilePanelTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const previousMobilePanelRef = useRef(false);
  const previousMobileToolsRef = useRef(false);
  const router = useRouter();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const [classicLeftWidth, setClassicLeftWidth] = useState(310);
  const [naiLeftWidth, setNaiLeftWidth] = useState(400);
  const leftWidth = naiLayout ? naiLeftWidth : classicLeftWidth;
  const setLeftWidth = naiLayout ? setNaiLeftWidth : setClassicLeftWidth;
  const [rightWidth, setRightWidth] = useState(230);
  const [, setCustomLayout] = useState(() => loadCustomLayout());
  const [formCacheReady, setFormCacheReady] = useState(false);

  function addSessionResults(nextImages: string[], historyIds: string[] = [], sourceOperation = operation) {
    if (!nextImages.length || sourceOperation === "suggest-tags") return;
    const now = Date.now();
    setSessionHistory((current) => [
      ...nextImages.map((image, index) => ({
        id: `${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        image,
        historyId: historyIds[index],
        operation: sourceOperation,
        createdAt: now + index,
      })),
      ...current,
    ]);
  }

  async function openImageEditor(mode: "inpaint" | "canvas", image = source?.data) {
    if (!image) {
      setNotice("请先导入或生成一张图片。");
      return;
    }
    try {
      const decoded = await loadImageElement(image);
      const canvas = document.createElement("canvas");
      canvas.width = decoded.naturalWidth;
      canvas.height = decoded.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("当前浏览器不支持 Canvas");
      context.drawImage(decoded, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const editorDocument = createEditorDocument(
        createRgbaImage(canvas.width, canvas.height, pixels.data),
        { x: 0, y: 0, width: canvas.width, height: canvas.height },
        {
          prompt,
          negativePrompt: negative,
          seed: seed || null,
          source: { name: source?.name || "工作区图片.png", mimeType: "image/png" },
          generation: { model, width, height, steps, scale, strength, sampler, noiseSchedule: schedule },
        },
      );
      const random = new Uint32Array(2);
      crypto.getRandomValues(random);
      const draftId = `editor-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
      syncEditorPromptToStudioForm(draftId, prompt, negative);
      await saveEditorDraft(createEditorDraft(draftId, mode, editorDocument));
      router.push(`/image/editor?draftId=${encodeURIComponent(draftId)}&mode=${mode}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法打开图像编辑器");
    }
  }

  function applyImageAsSource(image: string, nextOperation: Operation = "img2img") {
    setSource({ data: image, name: "工作区图片.png" });
    setMask(null);
    setUpscaleSource(null);
    if (nextOperation === "inpainting" || nextOperation === "edits") {
      const inpaintModel = models.find(({ value }) =>
        value.includes("inpaint") &&
        (model.includes("v4.5") ? value.includes("v4.5") : model.includes("v3") ? value.includes("v3") : value.includes("v5")),
      )?.value || models.find(({ value }) => value.includes("inpaint"))?.value;
      if (inpaintModel) setModel(inpaintModel);
    }
    setOperation(nextOperation);
    setSelectedImageIndex(0);
    if (window.matchMedia("(max-width: 1023px)").matches) setMobilePanel(true);
    setNotice("已将当前图片载入工作台。");
  }

  function selectOperation(nextOperation: Operation) {
    if (nextOperation !== "generate" && !source && images[0]) {
      applyImageAsSource(images[0], nextOperation);
      return;
    }
    if (nextOperation === "inpainting" || nextOperation === "edits") {
      const inpaintModel = models.find(({ value }) =>
        value.includes("inpaint") &&
        (model.includes("v4.5") ? value.includes("v4.5") : model.includes("v3") ? value.includes("v3") : value.includes("v5")),
      )?.value || models.find(({ value }) => value.includes("inpaint"))?.value;
      if (inpaintModel) setModel(inpaintModel);
    }
    setOperation(nextOperation);
    setNotice("");
  }

  async function preciseRedraw(selection: Rect) {
    if (!source) return;
    if (!signedIn) {
      setNotice("请先登录后再进行精确重绘。");
      return;
    }
    setGenerating(true);
    setNotice("正在裁切选区并提交精确重绘…");
    try {
      const original = await loadImageElement(source.data);
      const imageSize = { width: original.naturalWidth, height: original.naturalHeight };
      const patch = selectionToPatch({ selectionRect: selection, imageSize, context: 64 });
      const patchCanvas = document.createElement("canvas");
      patchCanvas.width = patch.width;
      patchCanvas.height = patch.height;
      const patchContext = patchCanvas.getContext("2d");
      if (!patchContext) throw new Error("当前浏览器不支持 Canvas");
      patchContext.drawImage(
        original,
        patch.cropRect.x,
        patch.cropRect.y,
        patch.cropRect.width,
        patch.cropRect.height,
        0,
        0,
        patch.width,
        patch.height,
      );
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = patch.width;
      maskCanvas.height = patch.height;
      const maskContext = maskCanvas.getContext("2d");
      if (!maskContext) throw new Error("当前浏览器不支持 Canvas");
      maskContext.fillStyle = "#000";
      maskContext.fillRect(0, 0, patch.width, patch.height);
      maskContext.fillStyle = "#fff";
      maskContext.fillRect(
        patch.selectionInPatch.x,
        patch.selectionInPatch.y,
        patch.selectionInPatch.width,
        patch.selectionInPatch.height,
      );
      const inpaintModel = models.find(({ value }) => value === model.replace(/-limit$/, "-inpaint"))?.value
        || models.find(({ value }) => value.includes("inpaint") && value.includes("v5"))?.value
        || "nai-v5-inpaint";
      const response = await fetch("/api/images/operate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "inpainting",
          model: inpaintModel,
          prompt,
          negative_prompt: negative,
          width: patch.width,
          height: patch.height,
          steps,
          scale,
          n: 1,
          sampler,
          noise_schedule: schedule,
          strength,
          image: patchCanvas.toDataURL("image/png"),
          mask: maskCanvas.toDataURL("image/png"),
          response_format: "b64_json",
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      let patchImage = "";
      let patchHistoryIds: string[] = [];
      if (contentType.includes("text/event-stream") && response.body) {
        const streamed = await consumeImageStream(response, {
          expected: 1,
          onPreview: (next) => setPreviewDrafts(next),
          onProgress: setStreamProgress,
          onComplete: (ids) => { patchHistoryIds = ids; },
        });
        patchImage = streamed[0] || "";
      } else {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "精确重绘失败");
        patchImage = result.images?.[0] || result.image || "";
        patchHistoryIds = Array.isArray(result.historyIds) ? result.historyIds : [];
      }
      if (!patchImage) throw new Error("上游未返回重绘结果");
      const generated = await loadImageElement(patchImage);
      const composite = document.createElement("canvas");
      composite.width = imageSize.width;
      composite.height = imageSize.height;
      const compositeContext = composite.getContext("2d");
      if (!compositeContext) throw new Error("当前浏览器不支持 Canvas");
      compositeContext.drawImage(original, 0, 0);
      compositeContext.save();
      compositeContext.beginPath();
      compositeContext.rect(
        patch.selectionInPatch.x + patch.cropRect.x,
        patch.selectionInPatch.y + patch.cropRect.y,
        patch.selectionInPatch.width,
        patch.selectionInPatch.height,
      );
      compositeContext.clip();
      compositeContext.drawImage(
        generated,
        0,
        0,
        generated.naturalWidth,
        generated.naturalHeight,
        patch.cropRect.x,
        patch.cropRect.y,
        patch.cropRect.width,
        patch.cropRect.height,
      );
      compositeContext.restore();
      const finalImage = composite.toDataURL("image/png");
      setImages([finalImage]);
      setPreviewDrafts([]);
      setSelectedImageIndex(0);
      addSessionResults(
        [finalImage],
        patchHistoryIds,
        "inpainting",
      );
      setSource({ data: finalImage, name: "精确重绘结果.png" });
      setMask(null);
      setMaskEditorOpen(false);
      setNotice("精确重绘完成，已将修改区域合成回原图。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "精确重绘失败");
    } finally {
      setGenerating(false);
    }
  }
  function openRightPanel() {
    if (rightPanelCloseTimer.current !== null) {
      window.clearTimeout(rightPanelCloseTimer.current);
      rightPanelCloseTimer.current = null;
    }
    setRightPanelCollapsed(false);
  }

  function scheduleRightPanelClose() {
    if (rightPanelCloseTimer.current !== null) window.clearTimeout(rightPanelCloseTimer.current);
    rightPanelCloseTimer.current = window.setTimeout(() => setRightPanelCollapsed(true), 220);
  }

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoff = loadEditorPromptHandoff(params.get("editorResult"));
    if (!handoff) return;
    void Promise.resolve().then(() => {
      setPrompt(handoff.prompt);
      setNegative(handoff.negative);
      clearEditorPromptHandoff();
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadImageStudioForm();
      setOperation(saved.operation as Operation);
      setContentMode(saved.contentMode);
      setModel(saved.model);
      setWidth(saved.width);
      setHeight(saved.height);
      setSteps(saved.steps);
      setScale(saved.scale);
      setCount(saved.count);
      setBatchMode(saved.batchMode);
      setSampler(saved.sampler);
      setSchedule(saved.schedule);
      setCfgRescale(saved.cfgRescale);
      setSeed(saved.seed);
      setStrength(saved.strength);
      setVibeStrength(saved.vibeStrength);
      setVibeInformationExtracted(saved.vibeInformationExtracted);
      setPrompt(saved.prompt);
      setNegative(saved.negative);
      setReferenceType(saved.referenceType);
      setControlModel(saved.controlModel);
      setUpscaleModel(saved.upscaleModel);
      setCharactersEnabled(saved.charactersEnabled);
      setCharacters(saved.characters.map((character, index) => ({
        id: `char-${index}-${Date.now()}`,
        ...character,
      })));
      setFormCacheReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!formCacheReady) return;
    const timer = window.setTimeout(() => {
      const snapshot: ImageStudioFormSnapshot = {
        version: 1,
        operation,
        contentMode,
        model,
        prompt,
        negative,
        width,
        height,
        steps,
        scale,
        count,
        batchMode,
        sampler,
        schedule,
        cfgRescale,
        seed,
        strength,
        vibeStrength,
        vibeInformationExtracted,
        referenceType,
        controlModel,
        upscaleModel,
        charactersEnabled,
        characters: characters.map(({ prompt: characterPrompt, centerX, centerY }) => ({
          prompt: characterPrompt,
          centerX,
          centerY,
        })),
      };
      saveImageStudioForm(snapshot);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    formCacheReady, operation, contentMode, model, prompt, negative, width, height,
    steps, scale, count, batchMode, sampler, schedule, cfgRescale, seed, strength,
    vibeStrength, vibeInformationExtracted, referenceType, controlModel, upscaleModel, charactersEnabled, characters,
  ]);

  useEffect(() => {
    return () => {
      const controller = assistantAbortRef.current;
      assistantAbortRef.current = null;
      controller?.abort("unmount");
      if (assistantTimeoutRef.current !== null)
        window.clearTimeout(assistantTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!mobilePanel && !mobileToolsOpen && !menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMobilePanel(false);
      setMobileToolsOpen(false);
      setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobilePanel, mobileToolsOpen, menuOpen]);

  useEffect(() => {
    if (mobilePanel) mobilePanelRef.current?.focus();
    else if (previousMobilePanelRef.current) mobilePanelTriggerRef.current?.focus();
    previousMobilePanelRef.current = mobilePanel;
  }, [mobilePanel]);

  useEffect(() => {
    if (mobileToolsOpen) mobileToolsRef.current?.focus();
    else if (previousMobileToolsRef.current) mobileToolsTriggerRef.current?.focus();
    previousMobileToolsRef.current = mobileToolsOpen;
  }, [mobileToolsOpen]);

  useEffect(() => {
    const saved = window.localStorage.getItem("lfn-layout");
    if (!saved) return;
    let parsed: { left?: number; right?: number };
    try {
      parsed = JSON.parse(saved) as { left?: number; right?: number };
    } catch {
      window.localStorage.removeItem("lfn-layout");
      return;
    }
    // 异步应用，避免在 effect 内同步 setState 触发级联渲染。
    const timer = window.setTimeout(() => {
      if (parsed.left) setClassicLeftWidth(clampPanel(parsed.left, 240, 520));
      if (parsed.right) setRightWidth(clampPanel(parsed.right, 200, 460));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (naiLayout || preferences.workspaceLayout !== "custom") return;
    const saved = loadCustomLayout();
    const timer = window.setTimeout(() => {
      setCustomLayout(saved);
      setClassicLeftWidth(clampPanel(saved.leftWidth, 240, 520));
      setRightWidth(clampPanel(saved.rightWidth, 200, 460));
      setRightPanelCollapsed(saved.rightCollapsed);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [naiLayout, preferences.workspaceLayout]);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem("lfn-nai-left-width"));
    if (!saved) return;
    const timer = window.setTimeout(() => setNaiLeftWidth(clampPanel(saved, 240, 520)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 超分：读取源图真实尺寸，用于档位费用展示、超限拦截与 2x 输出尺寸提示。
  useEffect(() => {
    if (operation !== "upscale" || !source) {
      void Promise.resolve().then(() => setUpscaleSource(null));
      return;
    }
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (!cancelled)
        setUpscaleSource({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      if (!cancelled) setUpscaleSource(null);
    };
    image.src = source.data;
    return () => {
      cancelled = true;
    };
  }, [operation, source]);

  function savePanelWidths(left: number, right: number) {
    if (naiLayout) window.localStorage.setItem("lfn-nai-left-width", String(left));
    window.localStorage.setItem("lfn-layout", JSON.stringify({ left: naiLayout ? classicLeftWidth : left, right }));
  }

  function startResize(side: "left" | "right", event: React.PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;

    let latestLeft = startLeft;
    let latestRight = startRight;

    function move(pointer: PointerEvent) {
      const delta = pointer.clientX - startX;
      if (side === "left") {
        latestLeft = clampPanel(startLeft + delta, 240, 520);
        setLeftWidth(latestLeft);
      } else {
        latestRight = clampPanel(startRight - delta, 200, 460);
        setRightWidth(latestRight);
      }
    }
    function end() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      savePanelWidths(latestLeft, latestRight);
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
  }

  function resizePanelWithKeyboard(
    side: "left" | "right",
    event: React.KeyboardEvent<HTMLDivElement>,
  ) {
    const current = side === "left" ? leftWidth : rightWidth;
    const min = side === "left" ? 240 : 200;
    const max = side === "left" ? 520 : 460;
    let next = current;
    if (event.key === "ArrowLeft") next = current - 16;
    if (event.key === "ArrowRight") next = current + 16;
    if (event.key === "Home") next = min;
    if (event.key === "End") next = max;
    if (next === current) return;
    event.preventDefault();
    next = clampPanel(next, min, max);
    if (side === "left") setLeftWidth(next);
    else setRightWidth(next);
    savePanelWidths(side === "left" ? next : leftWidth, side === "right" ? next : rightWidth);
  }

  // 服务端 prop 只是初值，会话可能在页面存活期间失效。
  const [sessionValid, setSessionValid] = useState(authenticated);
  const signedIn = authenticated && sessionValid;

  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/me")
      .then((response) => response.json())
      .then((result: Me & { authenticated?: boolean }) => {
        if (result?.authenticated === false) {
          setSessionValid(false);
          setMe(null);
          return;
        }
        setSessionValid(true);
        setMe(result);
      })
      .catch(() => setMe(null));
    fetch("/api/admin")
      .then((response) => response.json())
      .then((result: { admin?: boolean }) => setIsAdmin(Boolean(result.admin)))
      .catch(() => setIsAdmin(false));
  }, [authenticated]);

  const refreshWallet = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      if (!response.ok) return null;
      const result = (await response.json()) as WalletState;
      setWallet(result);
      if (result.aff) setAff(result.aff);
      if (result.newApi) {
        setMe((current) =>
          current
            ? { ...current, user: { ...current.user, balance: result.newApi?.balance ?? current.user?.balance ?? null, group: result.newApi?.group ?? current.user?.group ?? "" } }
            : current,
        );
      }
      return result;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void Promise.resolve().then(() => refreshWallet());
  }, [refreshWallet, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/assistant/models")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        const options = (result.models || []).map((item: string) => ({
          value: item,
          label: item,
        }));
        setAssistantModels(options);
        setAssistantModel((current) => current || options[0]?.value || "");
      })
      .catch((error) =>
        setNotice(error instanceof Error ? error.message : "无法读取助手模型"),
      );
  }, [signedIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reuse") !== "1") return;
    const timer = window.setTimeout(() => {
      const reusedOperation = params.get("operation") as Operation | null;
      if (reusedOperation && modes.some(({ id }) => id === reusedOperation))
        setOperation(reusedOperation);
      const reusedModel = params.get("model");
      if (reusedModel && models.some(({ value }) => value === reusedModel))
        setModel(reusedModel);
      const numericValues = [
        ["width", setWidth, 64, 1600],
        ["height", setHeight, 64, 1600],
        ["steps", setSteps, 1, 50],
        ["scale", setScale, 0, 10],
        ["n", setCount, 1, 6],
        ["cfg_rescale", setCfgRescale, 0, 1],
      ] as const;
      numericValues.forEach(([key, setter, min, max]) => {
        const value = Number(params.get(key));
        if (Number.isFinite(value) && value >= min && value <= max)
          setter(value);
      });
      const reusedSampler = params.get("sampler");
      if (
        reusedSampler &&
        samplers.some(({ value }) => value === reusedSampler)
      )
        setSampler(reusedSampler);
      const reusedSchedule = params.get("noise_schedule");
      if (
        reusedSchedule &&
        schedules.some(({ value }) => value === reusedSchedule)
      )
        setSchedule(reusedSchedule);
      if (params.has("prompt")) setPrompt(params.get("prompt") || "");
      if (params.has("negative_prompt"))
        setNegative(params.get("negative_prompt") || "");
      if (params.has("seed")) setSeed(params.get("seed") || "");
      setNotice("已载入历史参数，请确认后再生成。");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultId = params.get("editorResult");
    const editorHistory = params.get("editorHistory") || "";
    if (!resultId || !/^editor-[a-z0-9-]+$/i.test(resultId)) return;
    let active = true;
    void loadEditorDraft(resultId)
      .then(async (resultDraft) => {
        if (!active || !resultDraft) throw new Error("编辑器结果已过期，请重新打开编辑器。");
        const result = editorImageDataUrl(resultDraft.document.image);
        setPrompt(resultDraft.document.prompt || "");
        setNegative(resultDraft.document.negativePrompt || "");
        applyImageAsSource(result, "inpainting");
        setImages([result]);
        addSessionResults([result], /^[a-f0-9-]{36}$/i.test(editorHistory) ? [editorHistory] : [], "inpainting");
        await deleteEditorDraft(resultId);
        window.history.replaceState(null, "", "/image");
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "无法读取编辑器结果");
      });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // galleryId/historyId 只作为一次性入口参数，图片加载后交给统一导入流程。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const galleryId = params.get("galleryId");
    const historyId = params.get("historyId");
    const id = galleryId || historyId;
    if (!id || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) return;
    const endpoint = galleryId
      ? `/api/gallery/${encodeURIComponent(id)}/image`
      : `/api/history/${encodeURIComponent(id)}/image`;
    let active = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取要导入的图片");
        const blob = await response.blob();
        if (!active) return;
        const type = blob.type === "image/jpeg" || blob.type === "image/webp" ? blob.type : "image/png";
        await importImageAndParameters(new File([blob], `工作台导入.${type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png"}`, { type }));
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "导入图片失败");
      });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function appendTag(tag: string) {
    setPrompt((value) => `${value}${value.trim() ? ", " : ""}${tag}`);
  }

  async function searchDanbooru(keyword: string) {
    const query = keyword.trim();
    if (query.length < 2) {
      setNotice("请输入至少 2 个字符的标签关键词。");
      return;
    }
    setTagSearching(true);
    try {
      const response = await fetch(`/api/tags?q=${encodeURIComponent(query)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "标签检索失败");
      setTagResults(result.tags || []);
      if (!result.tags?.length) setNotice("没有找到匹配的 Danbooru 标签。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "标签检索失败");
    } finally {
      setTagSearching(false);
    }
  }

  // 压缩为最长边 1024px 的 JPEG：控制请求体积与视觉 token 消耗。
  async function compressAgentImage(file: File): Promise<string> {
    if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20 MB。");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取这张图片"));
      reader.readAsDataURL(file);
    });
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法解析这张图片"));
      element.src = dataUrl;
    });
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale >= 1 && dataUrl.length < 900_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function handleAgentImageFile(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("请选择图片文件。");
      return;
    }
    try {
      setAgentImage(await compressAgentImage(file));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "图片处理失败");
    }
  }

  useEffect(() => {
    // 登出态清空对话交给微任务，避免 effect 内同步 setState。
    if (!signedIn) {
      void Promise.resolve().then(() =>
        setConversation({ turns: [], tagPool: [] }),
      );
      return;
    }
    // 恢复服务端持久化的对话：历史轮次 + 跨轮次标签池。
    fetch("/api/assistant/tags", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setConversation({
          turns: Array.isArray(result.turns) ? result.turns : [],
          tagPool: Array.isArray(result.tagPool) ? result.tagPool : [],
        });
      })
      .catch(() => undefined);
  }, [signedIn]);

  async function refreshConversation() {
    try {
      const response = await fetch("/api/assistant/tags", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) return;
      setConversation({
        turns: Array.isArray(result.turns) ? result.turns : [],
        tagPool: Array.isArray(result.tagPool) ? result.tagPool : [],
      });
    } catch {
      // 刷新失败保留现有会话。
    }
  }

  // 模型或登录态变化时拉取实时计价（ratio/price/分组倍率），
  // 供预计消耗按 NewAPI 实际公式计算。
  useEffect(() => {
    let cancelled = false;
    // 登出态清空计价交给微任务，避免 effect 内同步 setState。
    if (!signedIn) {
      void Promise.resolve().then(() => {
        if (!cancelled) setModelPricing(null);
      });
      return () => {
        cancelled = true;
      };
    }
    fetch(`/api/pricing?model=${encodeURIComponent(model)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        if (!cancelled) setModelPricing(result);
      })
      .catch(() => {
        if (!cancelled) setModelPricing(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, model]);

  async function clearConversationHistory() {
    const response = await fetch("/api/assistant/tags", { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.message || "对话记录清空失败");
      return;
    }
    setConversation({ turns: [], tagPool: [] });
    setAssistantSuggestion(null);
    setAgentSteps([]);
    setNotice("助手对话记录已清空。");
  }

  function cancelAssistantTask() {
    const controller = assistantAbortRef.current;
    if (!controller) return;
    controller.abort("cancel");
  }

  function inputImagesForAgent(): string[] {
    const selected = sessionHistory.slice(0, agentImage ? 3 : 4).map((item) => item.image);
    return agentImage ? [...selected, agentImage] : selected;
  }
  async function askTagAssistant(request: string) {
    if (!assistantModel) {
      setNotice("当前账户没有可用的文本模型，请改用直接检索。");
      return;
    }
    assistantAbortRef.current?.abort("cancel");
    const controller = new AbortController();
    assistantAbortRef.current = controller;
    const timeoutId = window.setTimeout(
      () => controller.abort("timeout"),
      ASSISTANT_TIMEOUT_MS,
    );
    assistantTimeoutRef.current = timeoutId;
    setAssistantLoading(true);
    setAssistantSuggestion(null);
    setAgentSteps([]);
    try {
      // 任务化轮询：避免长连接被移动端 WebView 掐断，同时让检索步骤实时可见。
      const response = await fetch("/api/assistant/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: assistantModel,
          request,
          currentPrompt: prompt,
          currentNegativePrompt: negative,
          images: inputImagesForAgent(),
          image: undefined,
        }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "智能助手调用失败");
      const jobId = String(result.jobId || "");
      if (!jobId) throw new Error("智能助手未返回任务编号");
      for (let pollCount = 0; pollCount < ASSISTANT_MAX_POLLS; pollCount += 1) {
        await waitForAssistantPoll(ASSISTANT_POLL_INTERVAL_MS, controller.signal);
        const poll = await fetch(
          `/api/assistant/tags?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const progress = await poll.json();
        if (!poll.ok) throw new Error(progress.message || "智能助手调用失败");
        if (Array.isArray(progress.steps) && progress.steps.length)
          setAgentSteps(progress.steps);
        if (progress.status === "done") {
          setAssistantSuggestion(progress.suggestion);
          // 本轮已落盘，刷新历史与标签池。
          void refreshConversation();
          return;
        }
        if (progress.status === "error")
          throw new Error(progress.message || "智能助手调用失败");
      }
      throw new Error("助手任务轮询已达到 60 次上限，任务仍可能在后台运行，请重试。");
    } catch (error) {
      if (assistantAbortRef.current !== controller) return;
      if (controller.signal.aborted) {
        setNotice(
          controller.signal.reason === "timeout"
            ? "助手任务超时，任务仍可能在后台运行，请稍后重试。"
            : "已取消助手任务。",
        );
      } else {
        setNotice(error instanceof Error ? error.message : "智能助手调用失败");
      }
    } finally {
      if (assistantTimeoutRef.current === timeoutId) {
        window.clearTimeout(timeoutId);
        assistantTimeoutRef.current = null;
      }
      if (assistantAbortRef.current === controller) {
        assistantAbortRef.current = null;
        setAssistantLoading(false);
      }
    }
  }

  // “让助手处理”是明确的 Agent 入口。仅在无可用模型时降级到直接检索。
  async function runAgent() {
    const input = agentInput.trim();
    if (!input) {
      setNotice("请描述画面，或输入要查询的标签关键词。");
      return;
    }
    setTagResults([]);
    setAssistantSuggestion(null);
    if (signedIn && assistantModel) await askTagAssistant(input);
    else await searchDanbooru(input);
  }

  // 拖入/选入 NAI 图片：解析元数据并回填参数；图片本体同时进入图生图源图。
  async function importImageAndParameters(file?: File) {
    if (!file) return;
    const invalid = validateUploadFile(file);
    if (invalid) {
      setNotice(invalid);
      return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const { parseNaiImageMetadata } = await import("@/lib/nai-metadata");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const metadata = parseNaiImageMetadata(bytes);
      setSource({ data, name: file.name });
      setMask(null);
      setUpscaleSource(null);
      if (operation === "generate" || operation === "suggest-tags")
        setOperation("img2img");
      if (!metadata) {
        setNotice(`已导入 ${file.name}，未检测到 NAI 参数（仅作为源图）。`);
        return;
      }
      const { mapNaiParameters } = await import("@/lib/nai-import");
      const imported = mapNaiParameters(
        metadata.parameters,
        models.map(({ value }) => value),
      );
      if (imported.prompt) setPrompt(imported.prompt);
      if (imported.negativePrompt) setNegative(imported.negativePrompt);
      if (imported.model) setModel(imported.model);
      if (imported.width) setWidth(imported.width);
      if (imported.height) setHeight(imported.height);
      if (imported.steps != null) setSteps(imported.steps);
      if (imported.scale != null) setScale(imported.scale);
      if (imported.cfgRescale != null) setCfgRescale(imported.cfgRescale);
      if (imported.sampler) setSampler(imported.sampler);
      if (imported.noiseSchedule) setSchedule(imported.noiseSchedule);
      if (imported.seed != null) setSeed(imported.seed);
      if (imported.count != null) setCount(imported.count);
      if (imported.strength != null) setStrength(imported.strength);
      setNotice(`已从 ${file.name} 导入图片与生成参数。`);
    } catch {
      setNotice("读取图片失败，请重试。");
    }
  }

  // window 级拖放：遮罩期间计数 enter/leave，避免子元素触发闪烁。
  useEffect(() => {
    let depth = 0;
    function hasFiles(event: DragEvent): boolean {
      return Array.from(event.dataTransfer?.types || []).includes("Files");
    }
    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDropActive(true);
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropActive(false);
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropActive(false);
      if (maskEditorOpen) return;
      const file = event.dataTransfer?.files?.[0];
      if (file) void importImageAndParameters(file);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskEditorOpen, operation]);

  function applySuggestedParameters(
    parameters: AssistantSuggestion["parameters"],
  ) {
    if (parameters.width && parameters.width >= 64 && parameters.width <= 1600)
      setWidth(parameters.width);
    if (
      parameters.height &&
      parameters.height >= 64 &&
      parameters.height <= 1600
    )
      setHeight(parameters.height);
    if (parameters.steps && parameters.steps >= 1 && parameters.steps <= 50)
      setSteps(parameters.steps);
    if (
      parameters.scale != null &&
      parameters.scale >= 0 &&
      parameters.scale <= 10
    )
      setScale(parameters.scale);
    // seed 0 = 随机，不填入种子框（保持为空即随机）。
    if (parameters.seed != null && parameters.seed > 0)
      setSeed(String(parameters.seed));
    if (
      parameters.sampler &&
      samplers.some(({ value }) => value === parameters.sampler)
    )
      setSampler(parameters.sampler);
    if (
      parameters.noiseSchedule &&
      schedules.some(({ value }) => value === parameters.noiseSchedule)
    )
      setSchedule(parameters.noiseSchedule);
  }

  // 应用全部：替换为建议提示词并补齐缺失标签。
  // 不用 window.confirm——部分内置浏览器会静默吞掉确认框导致无法应用。
  function applyAllSuggestions() {
    if (!assistantSuggestion) return;
    const tagNames = assistantSuggestion.tags.map((tag) => tag.name);
    setPrompt((value) => {
      const base = (assistantSuggestion.prompt || value).trim();
      const present = new Set(
        base
          .split(",")
          .map((part) => part.trim().toLowerCase().replaceAll(" ", "_"))
          .filter(Boolean),
      );
      const missing = tagNames.filter(
        (name) => !present.has(name.trim().toLowerCase()),
      );
      return missing.length
        ? `${base}${base ? ", " : ""}${missing.join(", ")}`
        : base;
    });
    if (assistantSuggestion.negativePrompt)
      setNegative(assistantSuggestion.negativePrompt);
    applySuggestedParameters(assistantSuggestion.parameters);
    // 多角色建议：切换到文生图并启用多角色，填入各角色提示词与坐标。
    const suggestedCharacters = assistantSuggestion.characters ?? [];
    if (suggestedCharacters.length) {
      setOperation("generate");
      setCharactersEnabled(true);
      setCharacters(
        suggestedCharacters.map((character, index) => ({
          id: `char-${index}-${Date.now()}`,
          prompt: character.prompt,
          centerX: character.centerX,
          centerY: character.centerY,
        })),
      );
    }
    setAssistantSuggestion(null);
    setNotice(
      suggestedCharacters.length
        ? `已应用建议，并填充 ${suggestedCharacters.length} 个角色提示词。`
        : "已应用助手的全部建议。",
    );
  }

  const promptFields = (promptModes.has(operation) ||
    operation === "suggest-tags") && (
    <div className="nai-prompts grid gap-3">
      <Prompt
        label={
          operation.startsWith("director-")
            ? "工具提示"
            : naiLayout
              ? "提示词"
              : "描述画面"
        }
        value={prompt}
        onChange={setPrompt}
        accent
      />
      {operation !== "suggest-tags" && (
        <Prompt
          label={naiLayout ? "负面内容" : "排除内容"}
          value={negative}
          onChange={setNegative}
        />
      )}
    </div>
  );

  const characterControls = operation === "generate" && (
    <section className="nai-characters rounded-md border border-[var(--line)] bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-[var(--rose)]" />
          <div><b className="text-xs">{naiLayout ? "角色提示词" : "多角色"}</b>{naiLayout && <p className="nai-character-hint">为画面中的角色编写独立提示词。</p>}</div>
        </div>
        {naiLayout ? (
          <button type="button" className="nai-square-button" aria-label={charactersEnabled ? "收起角色提示词" : "添加角色提示词"} aria-expanded={charactersEnabled} onClick={() => setCharactersEnabled(!charactersEnabled)}>
            {charactersEnabled ? <X size={22} /> : <Plus size={22} />}
          </button>
        ) : <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)]">
          <input
            type="checkbox"
            checked={charactersEnabled}
            onChange={(event) => setCharactersEnabled(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--rose)]"
          />
          启用
        </label>}
      </div>
      {charactersEnabled && (
        <div className="mt-3 space-y-3">
          <p className="text-[10px] leading-4 text-[var(--muted)]">
            为画面中的每个角色编写独立提示词，并用滑块摆放角色位置（0–1
            归一化坐标）。主提示词描述整体场景。
          </p>
          {characters.map((character, index) => (
            <div
              key={character.id}
              className="rounded border border-[var(--line)] bg-[#faf9f5] p-2.5"
            >
              <div className="flex items-center justify-between">
                <b className="text-[11px] text-[var(--rose)]">
                  角色 {index + 1}
                </b>
                {characters.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCharacters((current) =>
                        current.filter((item) => item.id !== character.id),
                      )
                    }
                    className="grid h-6 w-6 place-items-center rounded border border-[var(--line)] bg-white text-[var(--muted)] hover:text-[var(--rose)]"
                    aria-label={`删除角色 ${index + 1}`}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <textarea
                className="field mt-2 min-h-16 w-full p-2 text-xs"
                placeholder="该角色的提示词，如 1girl, white hair, blue eyes"
                value={character.prompt}
                onChange={(event) =>
                  setCharacters((current) =>
                    current.map((item) =>
                      item.id === character.id
                        ? { ...item, prompt: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <div className="mt-2 space-y-1.5">
                {(
                  [
                    ["水平位置", "centerX"],
                    ["垂直位置", "centerY"],
                  ] as const
                ).map(([label, axis]) => (
                  <label
                    key={axis}
                    className="block text-[10px] text-[var(--muted)]"
                  >
                    <span className="flex items-center justify-between">
                      <span>{label}</span>
                      <output className="font-mono text-[var(--rose)]">
                        {character[axis].toFixed(2)}
                      </output>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={character[axis]}
                      onChange={(event) =>
                        setCharacters((current) =>
                          current.map((item) =>
                            item.id === character.id
                              ? { ...item, [axis]: Number(event.target.value) }
                              : item,
                          ),
                        )
                      }
                      className="range mt-1 w-full"
                      aria-label={`角色 ${index + 1} ${label}`}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          {characters.length < 6 && (
            <button
              type="button"
              onClick={() =>
                setCharacters((current) => [
                  ...current,
                  {
                    id: `char-${Date.now()}`,
                    prompt: "",
                    centerX: 0.5,
                    centerY: 0.5,
                  },
                ])
              }
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--line)] bg-white text-[11px] font-semibold text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]"
            >
              <Plus size={13} /> 添加角色
            </button>
          )}
        </div>
      )}
    </section>
  );

  const generationParameters = generationModes.has(operation) && (
    <div
      className={
        naiLayout
          ? "nai-ai-settings nai-parameter-dock"
          : "nai-ai-settings"
      }
    >
      {naiLayout && (
        <div className="nai-parameter-summary">
          <label>
            <small>步数</small>
            <WheelNumberInput
              ariaLabel="采样步数"
              min={1}
              max={50}
              step={1}
              value={steps}
              setValue={setSteps}
            />
          </label>
          <label>
            <small>引导强度</small>
            <WheelNumberInput
              ariaLabel="提示词相关性"
              min={0}
              max={10}
              step={0.1}
              value={scale}
              setValue={setScale}
            />
          </label>
          <span>
            <small>种子</small>
            <b>{seed || "随机"}</b>
          </span>
          <span>
            <small>采样器</small>
            <b>{samplers.find((item) => item.value === sampler)?.label}</b>
          </span>
          <button
            type="button"
            className="nai-parameter-more"
            aria-label="生成参数"
            aria-expanded={paramsOpen}
            onClick={() => setParamsOpen((current) => !current)}
          >
            <ChevronRight size={12} className={paramsOpen ? "is-open" : ""} />
          </button>
        </div>
      )}
      {(!naiLayout || paramsOpen) && (
        <div className={naiLayout ? "nai-parameter-details" : "contents"}>
          <NumericSlider
            label="采样步数"
            value={steps}
            setValue={setSteps}
            min={1}
            max={50}
            step={1}
          />
          <NumericSlider
            label="提示词相关性"
            value={scale}
            setValue={setScale}
            min={0}
            max={10}
            step={0.1}
          />
          <div className="nai-seed-sampler-row">
            <Control label="种子">
              <input
                className="field h-10 px-3"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                placeholder="输入种子"
                inputMode="numeric"
              />
            </Control>
            <Control label="采样器">
              <PopupSelect
                value={sampler}
                options={samplers}
                onChange={setSampler}
                ariaLabel="采样器"
              />
            </Control>
          </div>
          <button
            type="button"
            className="advanced-settings-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            <span>高级设置</span>
            <span aria-hidden="true">{advancedOpen ? "▾" : "▸"}</span>
          </button>
          {advancedOpen && (
            <div className="space-y-4 pt-1">
              <NumericSlider
                label="提示词相关性重缩放"
                value={cfgRescale}
                setValue={setCfgRescale}
                min={0}
                max={1}
                step={0.02}
              />
              <Control label="噪声调度">
                <PopupSelect
                  value={schedule}
                  options={schedules}
                  onChange={setSchedule}
                  ariaLabel="噪声调度"
                />
              </Control>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const modelModeControls = (
    <div className="nai-model-mode-row">
      <Control label="模型">
        <PopupSelect
          value={model}
          options={models}
          onChange={setModel}
          ariaLabel="模型"
          searchable
        />
      </Control>
      <Control label="模式">
        <button
          type="button"
          className="nai-mode-button"
          aria-label={`当前为 ${contentMode === "anime" ? "动漫" : "兽人"} 模式，点击切换`}
          onClick={() => {
            const next = contentMode === "anime" ? "furry" : "anime";
            setContentMode(next);
            if (model === "nai-v3") setModel("nai-v3-furry");
            if (model === "nai-v3-furry") setModel("nai-v3");
          }}
        >
          <PawPrint size={14} />
          <span>{contentMode === "anime" ? "动漫" : "兽人"}</span>
        </button>
      </Control>
    </div>
  );

  const controls = (
    <>
      <div
        className={
          naiLayout
            ? "nai-toolbar flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5"
            : "flex items-center justify-between border-b border-[var(--line)] px-4 py-3"
        }
      >
        {!naiLayout && (
          <b className="flex items-center gap-2 text-sm">
            <SlidersHorizontal size={16} /> 图像设置
          </b>
        )}
        <button
          type="button"
          title="重置参数"
          aria-label="重置所有生成参数"
          disabled={generating}
          className={
            naiLayout
              ? "grid h-9 w-9 shrink-0 place-items-center rounded border border-[var(--line)] bg-white disabled:cursor-not-allowed disabled:opacity-50"
              : "disabled:cursor-not-allowed disabled:opacity-50"
          }
          onClick={() => {
            setWidth(832);
            setHeight(1216);
            setSteps(28);
            setScale(5);
            setCount(1);
            setBatchMode("sequential");
            setBatchProgress("");
            setSampler("k_euler_ancestral");
            setSchedule("native");
            setModel(models[0].value);
            setCfgRescale(0);
            setSeed("");
            setStrength(0.7);
            setVibeStrength(0.6);
            setVibeInformationExtracted(1);
            setPrompt(defaultPrompt);
            setNegative(defaultNegative);
            setOperation("generate");
            setContentMode("anime");
            setSource(null);
            setMask(null);
            setMaskEditorOpen(false);
            setCharactersEnabled(false);
            setCharacters([
              { id: "char-1", prompt: "", centerX: 0.5, centerY: 0.5 },
            ]);
            setReferenceType("character&style");
            setControlModel("hed");
            setUpscaleModel("nai-diffusion-5-curated");
            clearImageStudioForm();
            setFormCacheReady(true);
            setAdvancedOpen(false);
            setSuggestedTags([]);
            setImages([]);
            setNotice("");
          }}
        >
          <RotateCcw size={16} />
        </button>
        {naiLayout && (
          <>
            <div className="nai-wallet flex min-w-0 flex-1 items-center justify-center gap-1.5">
              <div
                className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs"
                title="创作额度余额，签到/邀请/管理员发放都会进入这里"
              >
                <span className="shrink-0 text-[var(--muted)]">AFF</span>
                <b className="truncate tabular-nums">
                  {!signedIn
                    ? "体验"
                    : wallet?.aff
                      ? wallet.aff.balance + wallet.aff.packageBalance
                      : "…"}
                </b>
              </div>
              <Link
                href="/account"
                title="钱包、签到与图包"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-white text-[var(--rose)] hover:border-[var(--rose)]"
              >
                <Plus size={15} />
              </Link>
            </div>
            <button
              type="button"
              aria-label="打开站内菜单"
              onClick={() => setMenuOpen(true)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded border border-[var(--line)] bg-white"
            >
              <Menu size={16} />
            </button>
          </>
        )}
      </div>
      <div className={`settings-scroll ${!naiLayout ? `workspace-panel-layout-${preferences.workspaceLayout}` : "nai-panel-layout"} space-y-5 p-4`}>
        {naiLayout ? (
          <section className="nai-model-mode-persistent" aria-label="模型与模式">
            <div className="nai-section-heading">模型与模式</div>
            {modelModeControls}
          </section>
        ) : (
          <PanelSection title="模型与模式" icon={<SlidersHorizontal size={16} />}>
            {modelModeControls}
          </PanelSection>
        )}
        {sidebarPromptLayout && (
          <PanelSection title="提示词" icon={<Paintbrush size={16} />}>
            {promptFields}
            {characterControls}
          </PanelSection>
        )}

        {naiLayout ? (
          <PanelSection title="图像设置" icon={<Images size={16} />}>
            <NaiImageSettings width={width} height={height} count={count} setWidth={setWidth} setHeight={setHeight} setCount={setCount} />
          </PanelSection>
        ) : (
        <Control label="自定义分辨率 · 64–1600">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <NumberField
              value={width}
              setValue={setWidth}
              min={64}
              max={1600}
              step={64}
            />
            {naiLayout ? (
              <button
                type="button"
                aria-label="交换宽高"
                title="交换宽高"
                onClick={() => {
                  setWidth(height);
                  setHeight(width);
                }}
                className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]"
              >
                ×
              </button>
            ) : (
              <span>×</span>
            )}
            <NumberField
              value={height}
              setValue={setHeight}
              min={64}
              max={1600}
              step={64}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              [832, 1216],
              [1024, 1024],
              [1216, 832],
            ].map(([w, h]) => (
              <button
                key={`${w}x${h}`}
                className="rounded border border-[var(--line)] bg-white py-2 text-[10px]"
                onClick={() => {
                  setWidth(w);
                  setHeight(h);
                }}
              >
                {w}×{h}
              </button>
            ))}
          </div>
        </Control>
        )}
        {!sidebarPromptLayout && generationParameters}
        {naiLayout && <div className="nai-inline-generation-parameters">{generationParameters}</div>}
        {nlwLayout && <div className="nlw-inline-generation-parameters">{generationParameters}</div>}
        {generationModes.has(operation) && (
          <div>
            <Control label={naiLayout ? "提交方式" : `生成张数 · 1–${MAX_NAI_IMAGE_COUNT}`}>
              {!naiLayout && <NumberField
                value={count}
                setValue={setCount}
                min={1}
                max={MAX_NAI_IMAGE_COUNT}
                step={1}
              />}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={batchMode === "once"}
                  onClick={() => setBatchMode("once")}
                  className={`rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                    batchMode === "once"
                      ? "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_8%,transparent)] text-[var(--rose)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--rose)]"
                  }`}
                >
                  一次性
                </button>
                <button
                  type="button"
                  aria-pressed={batchMode === "sequential"}
                  onClick={() => setBatchMode("sequential")}
                  className={`rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                    batchMode === "sequential"
                      ? "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_8%,transparent)] text-[var(--rose)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--rose)]"
                  }`}
                >
                  分批次
                </button>
              </div>
              {batchMode === "sequential" && (
                <p className="mt-1.5 text-[10px] leading-4 text-[var(--muted)]">
                  最多 3 路并发、每路 4 张，先出先显示；上限 {MAX_NAI_IMAGE_COUNT} 张。
                </p>
              )}
            </Control>
          </div>
        )}

        {!naiLayout && !nlwLayout && characterControls}
        {["img2img", "inpainting", "edits"].includes(operation) && (
          <Control label={`变化强度 · ${strength}`}>
            <input
              className="range w-full"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={strength}
              onChange={(event) => setStrength(Number(event.target.value))}
            />
          </Control>
        )}
        {operation === "precise-reference" && (
          <Control label="精准参考类型">
            <PopupSelect
              value={referenceType}
              options={[
                { value: "character", label: "角色" },
                { value: "style", label: "风格" },
                { value: "character&style", label: "角色与风格" },
              ]}
              onChange={setReferenceType}
              ariaLabel="精准参考类型"
            />
          </Control>
        )}
        {operation === "annotate" && (
          <Control label="ControlNet 模型">
            <PopupSelect
              value={controlModel}
              options={[
                { value: "canny", label: "Canny" },
                { value: "hed", label: "HED" },
                { value: "midas", label: "MiDaS Depth" },
                { value: "mlsd", label: "MLSD Lines" },
                { value: "openpose", label: "OpenPose" },
                { value: "uniformer", label: "Uniformer" },
                { value: "fake_scribble", label: "Scribble" },
              ]}
              onChange={setControlModel}
              ariaLabel="ControlNet 模型"
            />
          </Control>
        )}
        {imageInputModes.has(operation) && operation !== "suggest-tags" && (
          <UploadField
            label={
              operation === "vibe-transfer" || operation.includes("reference")
                ? "参考图片"
                : "源图片"
            }
            value={source}
            onChange={(nextSource) => {
              setSource(nextSource);
              setMask(null);
              setUpscaleSource(null);
            }}
            onError={setNotice}
          />
        )}
        {operation === "vibe-transfer" && (
          <div className="reference-parameter-card">
            <b>Vibe 参考强度</b>
            <NumericSlider label="参考强度" value={vibeStrength} setValue={setVibeStrength} min={0} max={1} step={0.05} />
            <NumericSlider label="信息提取" value={vibeInformationExtracted} setValue={setVibeInformationExtracted} min={0} max={1} step={0.05} />
          </div>
        )}
        {["inpainting", "edits"].includes(operation) && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex h-11 w-full items-center justify-center gap-2 rounded bg-[#17191f] px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!source}
                onClick={() => void openImageEditor("inpaint")}
              >
                <Brush size={15} />
                {mask ? "继续重绘" : "独立重绘编辑器"}
              </button>
              <button
                type="button"
                className="flex h-11 w-full items-center justify-center gap-2 rounded border border-[var(--rose)] bg-white px-3 text-xs font-semibold text-[var(--rose)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!source}
                onClick={() => void openImageEditor("canvas")}
              >
                <Maximize2 size={15} />
                无限画布
              </button>
            </div>
            <button
              type="button"
              className="flex h-10 w-full items-center justify-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!source}
              onClick={() => setMaskEditorOpen(true)}
            >
              <Brush size={15} />
              旧版蒙版编辑器
            </button>
            <UploadField
              label={mask ? "蒙版已绘制，也可重新上传" : "或上传蒙版图片"}
              value={mask}
              onChange={setMask}
              onError={setNotice}
            />
          </div>
        )}
        {operation === "upscale" && (
          <>
            <Control label="超分模型">
              <PopupSelect
                value={upscaleModel}
                options={[
                  { value: "nai-diffusion-5-curated", label: "V5 Curated（推荐）" },
                  { value: "nai-diffusion-5-full", label: "V5 Full" },
                ]}
                onChange={setUpscaleModel}
                ariaLabel="超分模型"
              />
            </Control>
            <p className="rounded border border-[var(--line)] bg-[var(--bg2)] p-3 text-xs leading-5 text-[var(--muted)]">
              V5 扩散超分：输出固定为源图的 2 倍，仅接受 PNG。
              {upscaleSource
                ? `当前源图 ${upscaleSource.width}×${upscaleSource.height}，输出 ${upscaleSource.width * 2}×${upscaleSource.height * 2}，消耗 ${upscaleAnlasCost(upscaleSource.width, upscaleSource.height)} AFF。`
                : "请先上传源图以确认费用档位。"}
              {upscaleSource &&
                upscaleSource.width * upscaleSource.height > UPSCALE_MAX_PIXELS && (
                  <span className="mt-1 block text-amber-500">
                    源图超过超分上限 1536×2048（3145728 像素），请缩小后再试。
                  </span>
                )}
            </p>
          </>
        )}
        {operation === "annotate" && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            Gateway 端点存在，但尚无可审计的 usage
            计费映射，当前只展示完整入口并阻止零费用提交。
          </p>
        )}
        <PanelSection title="参考图片" icon={<ImagePlus size={16} />} defaultOpen={false}>
            <div className="nai-reference-grid">
              <button
                type="button"
                className={`nai-reference-card ${operation === "generate" ? "is-active" : ""}`}
                onClick={() => {
                  setOperation("generate");
                  setNotice("");
                }}
              >
                <ImagePlus size={18} />
                <span><b>文生图</b><small>根据提示词生成图片。</small></span>
              </button>
              {referenceOperations.map((item) => (
                <button
                  type="button"
                  className={`nai-reference-card ${operation === item.id ? "is-active" : ""}`}
                  key={item.id}
                  onClick={() => {
                    selectOperation(item.id);
                    setNotice("");
                  }}
                >
                  <ImagePlus size={18} />
                  <span><b>{item.label}</b><small>{item.detail}</small></span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className="nai-inline-tool-button" onClick={() => setGalleryPickerOpen(true)}><Images size={15} /> 从图库选择</button>
              <button type="button" className="nai-inline-tool-button" disabled={!source} onClick={() => void openImageEditor("canvas")}><Maximize2 size={15} /> 无限画布</button>
              <label className="nai-inline-tool-button"><FileUp size={15} /> 导入图片<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { void importImageAndParameters(event.target.files?.[0]); event.target.value = ""; }} /></label>
            </div>
            <div className="mt-3">
              <Control label="图片工具">
                <PopupSelect
                  value={toolOperations.some(({ value }) => value === operation) ? operation : "generate"}
                  options={[{ value: "generate", label: "不使用工具" }, ...toolOperations]}
                  onChange={(value) => {
                    selectOperation(value as Operation);
                    setNotice("");
                  }}
                  ariaLabel="图片工具"
                />
              </Control>
            </div>
            <div className="mt-3">
              <div className="nai-section-heading">导演工具</div>
              <div className="nai-director-grid">
                {modes.filter((item) => item.id.startsWith("director-")).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`nai-director-button${operation === item.id ? " is-active" : ""}`}
                    aria-pressed={operation === item.id}
                    onClick={() => selectOperation(item.id)}
                  >
                    <WandSparkles size={14} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </PanelSection>
      </div>
    </>
  );

  async function runOperation() {
    if (!signedIn) {
      setNotice(
        authenticated
          ? "登录状态已过期，请重新登录后再提交。"
          : "体验模式不会发送真实请求。登录后可通过你的 NewAPI 钱包调用。",
      );
      return;
    }
    const validationError = validateGenerationParameters({
      operation,
      width,
      height,
      steps,
      scale,
      count,
      cfgRescale,
      seed,
      strength,
      source,
      mask,
    });
    if (validationError) {
      setNotice(validationError);
      return;
    }
    // 一次性提交走单请求，网关侧单请求上限 8 张；更多张数请用分批次并发。
    if (batchMode === "once" && count > 8) {
      setNotice("一次性提交最多 8 张；更多张数请改用分批次并发。");
      return;
    }
    setGenerating(true);
    setImages([]);
    setPreviewDrafts([]);
    setStreamProgress("");
    setSuggestedTags([]);
    setNotice("");
    const base: Record<string, unknown> = {
      operation,
      model,
      prompt,
      negative_prompt: negative,
      width,
      height,
      steps,
      scale,
      n: count,
      sampler,
      noise_schedule: schedule,
      response_format: "b64_json",
    };
    if (cfgRescale > 0) base.cfg_rescale = cfgRescale;
    if (seed) base.seed = Number(seed);
    // 多角色（仅文生图）：映射为 NAI characterPrompts，网关自动构造 v4_prompt.char_captions。
    if (
      operation === "generate" &&
      charactersEnabled &&
      characters.some((character) => character.prompt.trim())
    ) {
      base.characterPrompts = characters
        .filter((character) => character.prompt.trim())
        .map((character) => ({
          prompt: character.prompt.trim(),
          center: { x: character.centerX, y: character.centerY },
        }));
    }
    if (["img2img", "inpainting", "edits"].includes(operation)) {
      base.image = source?.data;
      base.strength = strength;
    }
    if (["inpainting", "edits"].includes(operation)) base.mask = mask?.data;
    if (operation === "vibe-transfer") {
      base.reference_image = source?.data;
      base.reference_strength = vibeStrength;
      base.reference_information_extracted = vibeInformationExtracted;
    }
    if (operation === "character-reference")
      base.characters = [
        {
          reference_image: source?.data,
          prompt,
          center: { x: 0.5, y: 0.5 },
          reference_strength: 0.6,
          reference_information_extracted: 1,
        },
      ];
    if (operation === "precise-reference")
      base.references = [
        {
          reference_image: source?.data,
          reference_type: referenceType,
          strength: 1,
          fidelity: 1,
        },
      ];
    if (operation === "annotate") {
      base.image = source?.data;
      base.model = controlModel;
    }
    if (operation === "upscale") {
      if (!source) throw new Error("请先上传要超分的图片");
      if (!upscaleSource) throw new Error("无法读取源图尺寸，请重新上传");
      if (upscaleSource.width * upscaleSource.height > UPSCALE_MAX_PIXELS)
        throw new Error("源图超过超分上限 1536×2048（3145728 像素），请缩小后再试");
      // 上游只收 PNG；JPEG/WEBP 源图在此统一重编码为 PNG。
      base.image = await toPngDataUrl(source.data);
      base.upscale_model = upscaleModel;
      base.n = 1;
    }
    if (operation.startsWith("director-")) {
      base.image = source?.data;
      base.defry = 1;
    }
    try {
      // 分批次：并发分片请求（每片 ≤4 张、最多 3 路在途、错峰 0.5s 启动），
      // 网关会把并发请求分摊到多个启用账号；一次性保持单请求 n 张（≤8）。
      // 超分单次固定 1 张，避免重复扣费。
      const sequential = batchMode === "sequential" && count > 1 && operation !== "upscale";
      const collected: string[] = [];
      const collectedHistoryIds: string[] = [];
      const chunkImagesByIndex: string[][] = [];
      const chunkHistoryByIndex: string[][] = [];
      let usedNewApi = false;
      let failures = 0;
      let lastError = "";
      let partialMessage = "";
      if (sequential) {
        const BATCH_CHUNK = 4;
        const BATCH_PARALLEL = 3;
        const chunkSizes: number[] = [];
        const chunkStarts: number[] = [];
        for (let rest = count; rest > 0; ) {
          chunkStarts.push(count - rest);
          const size = Math.min(BATCH_CHUNK, rest);
          chunkSizes.push(size);
          rest -= size;
        }
        // 各分片携带“基础种子 + 片内起始偏移”，与 NAI 单请求多张的种子序列
        // 语义一致；不填种子时客户端随机一个基础种子，避免分片间重复出图。
        const baseSeed = seed.trim()
          ? Number(seed.trim())
          : Math.floor(Math.random() * 2 ** 32);
        const previewMap = new Map<string, string>();
        let doneImages = 0;
        let nextChunk = 0;
        const runChunk = async (chunkIndex: number) => {
          const size = chunkSizes[chunkIndex];
          const response = await fetch("/api/images/operate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...base,
              n: size,
              n_samples: size,
              seed: (baseSeed + chunkStarts[chunkIndex]) % 2 ** 32,
            }),
          });
          const contentType = response.headers.get("content-type") || "";
          let chunkImages: string[] = [];
          let chunkHistoryIds: string[] = [];
          if (contentType.includes("text/event-stream") && response.body) {
            if (response.headers.get("x-lfn-payment-source") === "newapi")
              usedNewApi = true;
            chunkImages = await consumeImageStream(response, {
              expected: size,
              onPreview(next) {
                next.forEach((image, index) =>
                  previewMap.set(`${chunkIndex}:${index}`, image),
                );
                setPreviewDrafts([...collected, ...previewMap.values()]);
              },
              onProgress(label) {
                setStreamProgress(label);
              },
              onComplete(historyIds) {
                chunkHistoryIds = historyIds;
              },
            });
          } else {
            const result = await response.json();
            if (!response.ok && !result.images)
              throw new Error(result.message || "操作失败");
            chunkImages = result.images || (result.image ? [result.image] : []);
            if (result.payment === "newapi") usedNewApi = true;
            chunkHistoryIds = Array.isArray(result.historyIds)
              ? result.historyIds.filter((item: unknown): item is string => typeof item === "string")
              : [];
            if (result.partial)
              partialMessage = result.message || "部分批次生成失败。";
          }
          chunkImagesByIndex[chunkIndex] = chunkImages;
          chunkHistoryByIndex[chunkIndex] = chunkHistoryIds;
          collected.splice(0, collected.length, ...chunkImagesByIndex.flat());
          collectedHistoryIds.splice(0, collectedHistoryIds.length, ...chunkHistoryByIndex.flat());
          for (let index = 0; index < size; index += 1)
            previewMap.delete(`${chunkIndex}:${index}`);
          doneImages += chunkImages.length;
          setPreviewDrafts([...previewMap.values()]);
          setImages([...collected]);
          setSelectedImageIndex(0);
          setBatchProgress(`${Math.min(doneImages, count)}/${count}`);
          if (!chunkImages.length) throw new Error("上游未返回最终图片");
        };
        await Promise.all(
          Array.from(
            { length: Math.min(BATCH_PARALLEL, chunkSizes.length) },
            async () => {
              while (nextChunk < chunkSizes.length) {
                const chunkIndex = nextChunk;
                nextChunk += 1;
                // 按片序号错峰启动，避免瞬时并发挤满网关队列。
                await new Promise((resolve) =>
                  setTimeout(resolve, 500 * chunkIndex),
                );
                try {
                  await runChunk(chunkIndex);
                } catch (error) {
                  failures += 1;
                  lastError =
                    error instanceof Error ? error.message : "生成失败";
                }
              }
            },
          ),
        );
        setPreviewDrafts([]);
        if (failures) {
          if (!collected.length)
            throw new Error(lastError || "分批生成全部失败");
          setNotice(
            `分批生成完成 ${collected.length}/${count} 张${lastError ? `：${lastError}` : ""}。`,
          );
        }
        addSessionResults(collected, collectedHistoryIds, operation);
      } else {
        const response = await fetch("/api/images/operate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        });
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream") && response.body) {
          let batchHistoryIds: string[] = [];
          const batchImages = await consumeImageStream(response, {
            expected: count,
            onPreview(next) {
              setPreviewDrafts(next);
            },
            onComplete(historyIds) {
              batchHistoryIds = historyIds;
            },
            onProgress(label) {
              setStreamProgress(label);
            },
          });
          if (response.headers.get("x-lfn-payment-source") === "newapi")
            usedNewApi = true;
          if (!batchImages.length) throw new Error("上游未返回最终图片");
          collected.push(...batchImages);
          setImages(batchImages);
          setSelectedImageIndex(0);
          setPreviewDrafts([]);
          addSessionResults(batchImages, batchHistoryIds, operation);
        } else {
          const result = await response.json();
          if (!response.ok && !result.images)
            throw new Error(result.message || "操作失败");
          if (operation === "suggest-tags") {
            const tags = Array.isArray(result.tags) ? result.tags : [];
            setSuggestedTags(
              tags
                .map((item: unknown) =>
                  typeof item === "string"
                    ? item
                    : (item as { tag?: string }).tag || "",
                )
                .filter(Boolean),
            );
            return;
          }
          const newImages: string[] =
            result.images || (result.image ? [result.image] : []);
          setImages(newImages);
          setSelectedImageIndex(0);
          addSessionResults(
            newImages,
            Array.isArray(result.historyIds)
              ? result.historyIds.filter((item: unknown): item is string => typeof item === "string")
              : [],
            operation,
          );
          if (result.payment === "newapi") usedNewApi = true;
          if (result.partial)
            partialMessage = result.message || "部分批次生成失败。";
        }
      }
      await refreshWallet();
      if (!(sequential && failures)) {
        if (partialMessage) {
          setNotice(partialMessage);
        } else if (usedNewApi) {
          setNotice("AFF 余额不足，本次已使用 NewAPI 余额支付。");
          // NewAPI 余额已变动，拉取最新数值让底部余额区立即更新。
          fetch("/api/me")
            .then((response) => response.json())
            .then((latest: Me & { authenticated?: boolean }) => {
              if (latest?.authenticated !== false) setMe(latest);
            })
            .catch(() => undefined);
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "操作失败，请稍后重试",
      );
    } finally {
      setBatchProgress("");
      setStreamProgress("");
      setGenerating(false);
    }
  }

  const activeCharacterCount =
    operation === "generate" && charactersEnabled
      ? characters.filter((character) => character.prompt.trim()).length
      : 0;
  // 超分费用按源图真实尺寸（1-4 AFF 档位）；其余操作按生成尺寸估算。
  // 管理员配置了固定 AFF 单价的模型优先按固定价 × 张数。
  const upscaleDims = operation === "upscale" ? upscaleSource : null;
  const affFixedCost =
    typeof (modelPricing as unknown as { affFixedCost?: unknown } | null)?.affFixedCost === "number"
      ? ((modelPricing as unknown as { affFixedCost: number }).affFixedCost)
      : null;
  const estimatedAffCost =
    affFixedCost != null
      ? Math.ceil(affFixedCost) * (operation === "upscale" ? 1 : count)
      : estimateAff({
          model,
          operation,
          width: upscaleDims ? upscaleDims.width : width,
          height: upscaleDims ? upscaleDims.height : height,
          steps,
          samples: operation === "upscale" ? 1 : count,
          characterPromptCount: activeCharacterCount,
        });
  const estimatedNewApiCost = ["annotate", "suggest-tags", "upscale"].includes(operation) ? null : estimateNewApiCost(modelPricing, {
    model, operation, sequential: batchMode === "sequential", maxSamplesPerRequest: 4, width: upscaleDims?.width ?? width,
    height: upscaleDims?.height ?? height, steps,
    samples: operation === "upscale" ? 1 : count,
    strength: ["img2img", "inpainting", "edits"].includes(operation) ? strength : undefined,
    referenceImageCount: ["vibe-transfer", "character-reference", "precise-reference"].includes(operation) && source ? 1 : 0,
  });
  const packageRateImages = Math.min(
    operation === "upscale" ? 1 : count,
    wallet?.aff?.packageBalance && wallet.aff.packageRateLimitRemaining > 0
      ? wallet.aff.packageRateLimitRemaining
      : 0,
  );
  const estimatedPackageCost = wallet?.aff?.enabled
    ? Math.min(
        wallet.aff.packageBalance,
        Math.ceil(
          (estimatedAffCost * packageRateImages) /
            Math.max(1, operation === "upscale" ? 1 : count),
        ),
      )
    : 0;
  const estimatedPersonalCost = estimatedAffCost - estimatedPackageCost;
  const canUseAffEstimate = Boolean(
    wallet?.aff?.enabled &&
      wallet.aff.balance >= estimatedPersonalCost &&
      wallet.aff.packageBalance >= estimatedPackageCost,
  );

  // 右侧功能区：标签助手 + 会话状态（桌面侧栏与移动抽屉共用）。
  // NAI 主题下创作入口移入左上角「站内菜单」，其他主题保留创作中心。
  const sessionHistoryPanel = (
    <section className="session-history-panel" aria-label="本次会话历史">
      <div className="flex items-center justify-between gap-2">
        <b className="text-xs">本次历史</b>
        <span className="text-[10px] text-[var(--muted)]">{sessionHistory.length} 张</span>
      </div>
      <div className="session-history-list">
        {sessionHistory.length ? sessionHistory.map((item) => (
            <div key={item.id} className="session-history-entry">
              <button
                type="button"
                className="session-history-thumb"
                aria-label="使用本次历史图片"
                onClick={() => applyImageAsSource(item.image, "img2img")}
              >
                <Image src={item.image} alt="本次生成图片" width={96} height={96} unoptimized />
              </button>
              <div className="session-history-actions">
                <button type="button" onClick={() => applyImageAsSource(item.image, "img2img")} aria-label="历史图片用于图生图" title="图生图"><ImagePlus size={13} /></button>
                <button type="button" onClick={() => applyImageAsSource(item.image, "inpainting")} aria-label="历史图片用于局部重绘" title="局部重绘"><Brush size={13} /></button>
                <button type="button" onClick={() => applyImageAsSource(item.image, "director-lineart")} aria-label="历史图片用于导演工具" title="导演工具"><WandSparkles size={13} /></button>
                <button type="button" onClick={() => applyImageAsSource(item.image, "vibe-transfer")} aria-label="历史图片用于氛围迁移" title="氛围迁移"><Eye size={13} /></button>
                <button type="button" onClick={() => applyImageAsSource(item.image, "upscale")} aria-label="历史图片用于超分" title="超分"><Aperture size={13} /></button>
              </div>
            </div>
        )) : <span className="text-[10px] text-[var(--muted)]">生成后的图片会出现在这里</span>}
      </div>
    </section>
  );

  const toolsPanel = (
    <>
          {sessionHistoryPanel}
          {!naiLayout && (
            <div className="border-b border-[var(--line)] p-4">
              <b className="text-sm">创作中心</b>
              <nav className="mt-3 grid grid-cols-2 gap-2">
                <FeatureLink
                  href="/history"
                  label="图片历史"
                  icon={<Images size={15} />}
                />
                <FeatureLink
                  href="/gallery"
                  label="图片广场"
                  icon={<Images size={15} />}
                />
                <FeatureLink
                  href="/usage"
                  label="使用记录"
                  icon={<SlidersHorizontal size={15} />}
                />
                <FeatureLink
                  href="/account"
                  label="我的账号"
                  icon={<UserRound size={15} />}
                />
                <FeatureLink
                  href="/resources"
                  label="模型密钥"
                  icon={<Sparkles size={15} />}
                />
                <FeatureLink
                  href="/announcements"
                  label="公告"
                  icon={<Megaphone size={15} />}
                />
                <FeatureLink
                  href="/settings"
                  label="外观设置"
                  icon={<Paintbrush size={15} />}
                />
                {isAdmin && (
                  <FeatureLink
                    href="/admin"
                    label="管理"
                    icon={<ShieldCheck size={15} />}
                  />
                )}
              </nav>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto border-b border-[var(--line)] p-4">
            <div className="flex items-center gap-2">
              <WandSparkles size={15} className="text-[var(--rose)]" />
              <b className="text-sm">标签助手</b>
              {signedIn && (conversation.turns.length > 0 || conversation.tagPool.length > 0) && (
                <span className="ml-auto flex items-center gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setConversationOpen((open) => !open)}
                    className="font-semibold text-[var(--muted)] hover:text-[var(--rose)]"
                  >
                    {conversationOpen ? "收起对话" : `对话 ${conversation.turns.length} 轮`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "确定清空助手对话记录？历史轮次与累积标签都会删除。",
                        )
                      )
                        void clearConversationHistory();
                    }}
                    className="font-semibold text-[var(--muted)] hover:text-red-600"
                    title="删除全部对话记录"
                  >
                    清空
                  </button>
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              模型会检索 Danbooru 与相关概念，并整理、校验生成标签。
              {signedIn && " 多轮对话共享上下文，已校验标签会持续保留。"}
            </p>
            {signedIn && assistantModels.length > 0 && (
              <div className="mt-3">
                <PopupSelect
                  value={assistantModel}
                  options={assistantModels}
                  onChange={setAssistantModel}
                  ariaLabel="智能助手模型"
                  searchable
                />
              </div>
            )}
            {conversationOpen && (conversation.turns.length > 0 || conversation.tagPool.length > 0) && (
              <div className="mt-3 space-y-3">
                {!!conversation.tagPool.length && (
                  <div className="rounded border border-[var(--line)] bg-white p-2.5">
                    <b className="text-[11px]">已保留标签 · {conversation.tagPool.length}</b>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {conversation.tagPool.map((tag) => (
                        <button
                          key={tag.name}
                          type="button"
                          onClick={() => appendTag(tag.name)}
                          className="rounded bg-[#f1eee7] px-2 py-1 text-[10px] hover:bg-[#e8ddda]"
                          title={`${tag.categoryName} · ${tag.postCount.toLocaleString("zh-CN")} 张 · 点击追加到提示词`}
                        >
                          {tag.displayName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {conversation.turns.map((turn) => (
                    <div
                      key={turn.id}
                      className="rounded border border-[var(--line)] bg-[#faf9f5] p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-[11px] font-semibold">
                          {turn.request}
                        </p>
                        <time className="shrink-0 text-[10px] text-[var(--muted)]">
                          {new Date(turn.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      {!!turn.tags.length && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {turn.tags.map((tag) => (
                            <button
                              key={tag.name}
                              type="button"
                              onClick={() => appendTag(tag.name)}
                              className="rounded bg-white px-1.5 py-0.5 text-[10px] hover:bg-[#f1eee7]"
                              title="点击追加到提示词"
                            >
                              {tag.displayName}
                            </button>
                          ))}
                        </div>
                      )}
                      {turn.message && (
                        <p className="assistant-speech-turn">
                          {turn.message.slice(0, ASSISTANT_MESSAGE_MAX)}
                        </p>
                      )}
                      {turn.prompt && (
                        <p className="mt-1.5 line-clamp-2 break-words text-[10px] leading-4 text-[var(--muted)]">
                          {turn.prompt}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <form
              className="mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                runAgent();
              }}
            >
              <textarea
                className="field min-h-20 w-full resize-y p-2 text-xs"
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  runAgent();
                }}
                onPaste={(event) => {
                  const file = [...event.clipboardData.items]
                    .find((item) => item.type.startsWith("image/"))
                    ?.getAsFile();
                  if (!file) return;
                  event.preventDefault();
                  void handleAgentImageFile(file);
                }}
                placeholder="白发　或　雨夜里的白发少女…（可粘贴/上传图片让助手识图）"
                aria-label="标签助手输入"
              />
              <div className="flex items-center gap-2">
                <label
                  className="key-action shrink-0 cursor-pointer"
                  title="上传图片让助手识图"
                >
                  <ImagePlus size={15} />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="上传识图图片"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void handleAgentImageFile(file);
                    }}
                  />
                </label>
                <p className="min-w-0 flex-1 text-[10px] leading-4 text-[var(--muted)]">
                  可粘贴（Ctrl+V）或上传图片，助手按图检索 Danbooru 标签
                </p>
              </div>
              {agentImage && (
                <div className="flex items-center gap-2 rounded border border-[var(--line)] bg-white p-2">
                  <button
                    type="button"
                    onClick={() => setAgentImageZoom(true)}
                    className="shrink-0"
                    title="点击放大查看"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={agentImage}
                      alt="待识图图片缩略图"
                      className="h-16 w-16 rounded border border-[var(--line)] object-cover"
                    />
                  </button>
                  <p className="min-w-0 flex-1 text-[10px] leading-4 text-[var(--muted)]">
                    已附图，提交后随需求一起发给模型。
                    <button
                      type="button"
                      onClick={() => setAgentImage(null)}
                      className="ml-1 font-semibold text-[var(--rose)]"
                    >
                      移除
                    </button>
                  </p>
                </div>
              )}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={tagSearching || assistantLoading}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white disabled:opacity-50"
              >
                <Search size={15} />
                {tagSearching
                  ? "检索中…"
                  : assistantLoading
                    ? "模型分析中…"
                    : "让助手处理"}
              </button>
              {assistantLoading && (
                <button
                  type="button"
                  onClick={cancelAssistantTask}
                  className="h-10 shrink-0 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]"
                >
                  取消
                </button>
              )}
            </div>
          </form>
            {(assistantLoading || agentSteps.length > 0) && (
              <div className="mt-3 rounded border border-[var(--line)] bg-white p-2.5">
                <b className="text-[11px]">
                  检索过程
                  {assistantLoading && ` · 已 ${agentSteps.length} 步`}
                </b>
                <ul className="mt-1.5 space-y-1">
                  {agentSteps.map((step, index) => (
                    <li
                      key={`${step.tool}-${index}`}
                      className="flex items-start gap-1.5 text-[11px] leading-4"
                    >
                      <span
                        className={
                          step.ok
                            ? "font-semibold text-emerald-600"
                            : "font-semibold text-red-600"
                        }
                      >
                        {step.ok ? "✓" : "✕"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <b>{agentToolLabels[step.tool] || step.tool}</b>
                        {step.query && (
                          <span className="text-[var(--muted)]">
                            {" "}
                            · {step.query}
                          </span>
                        )}
                        {step.summary && (
                          <span className="block text-[10px] text-[var(--muted)]">
                            {step.summary}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                  {assistantLoading && (
                    <li className="text-[11px] text-[var(--muted)]">
                      模型思考中…
                    </li>
                  )}
                </ul>
              </div>
            )}
            <div className="mt-3 space-y-1.5">
              {tagResults.map((tag) => (
                <button
                  type="button"
                  key={tag.name}
                  onClick={() => appendTag(tag.name)}
                  className="danbooru-result"
                  title="追加到提示词"
                >
                  <span>
                    <b>{tag.displayName}</b>
                    <small>{tag.categoryName}</small>
                  </span>
                  <small>{tag.postCount.toLocaleString("zh-CN")}</small>
                </button>
              ))}
            </div>
            <div className="mt-4">
              {!signedIn && (
                <p className="rounded border border-[var(--line)] bg-white p-2 text-[11px] leading-5 text-[var(--muted)]">
                  登录后助手可调用你的 NewAPI 文本模型整理提示词，按原规则计费。
                </p>
              )}
              {assistantSuggestion && (
                <div className="assistant-preview">
                  <b>建议差异预览</b>
                  {assistantSuggestion.message && (
                    <div className="assistant-speech">
                      <Sparkles size={13} className="mt-0.5 shrink-0 text-[var(--rose)]" />
                      <p>{assistantSuggestion.message.slice(0, ASSISTANT_MESSAGE_MAX)}</p>
                    </div>
                  )}
                  {assistantSuggestion.englishDescription && (
                    <PreviewRow
                      label="英文画面描述"
                      value={assistantSuggestion.englishDescription}
                    />
                  )}
                  {assistantSuggestion.prompt && (
                    <PreviewRow
                      label="正向提示词"
                      value={assistantSuggestion.prompt}
                    />
                  )}
                  {assistantSuggestion.negativePrompt && (
                    <PreviewRow
                      label="负向提示词"
                      value={assistantSuggestion.negativePrompt}
                    />
                  )}
                  {!!assistantSuggestion.tags.length && (
                    <PreviewRow
                      label="已校验标签"
                      value={assistantSuggestion.tags
                        .map((tag) => tag.name)
                        .join(", ")}
                    />
                  )}
                  {!!assistantSuggestion.characters?.length && (
                    <PreviewRow
                      label={`多角色 · ${assistantSuggestion.characters.length} 个`}
                      value={assistantSuggestion.characters
                        .map(
                          (character, index) =>
                            `角色${index + 1}: ${character.prompt}（x ${character.centerX.toFixed(2)} / y ${character.centerY.toFixed(2)}）`,
                        )
                        .join("\n")}
                    />
                  )}
                  {!!Object.keys(assistantSuggestion.parameters).length && (
                    <PreviewRow
                      label="推荐参数"
                      value={JSON.stringify(assistantSuggestion.parameters)}
                    />
                  )}
                  <div className="assistant-actions">
                    <button
                      type="button"
                      onClick={() =>
                        assistantSuggestion.tags.forEach((tag) =>
                          appendTag(tag.name),
                        )
                      }
                    >
                      追加标签
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrompt(assistantSuggestion.prompt)}
                    >
                      替换提示词
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNegative(assistantSuggestion.negativePrompt)
                      }
                    >
                      替换负向词
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        applySuggestedParameters(assistantSuggestion.parameters)
                      }
                    >
                      应用参数
                    </button>
                    <button type="button" onClick={applyAllSuggestions}>
                      应用全部
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssistantSuggestion(null)}
                    >
                      放弃建议
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="p-4">
            <b className="text-sm">会话状态</b>
            <div className="mt-3 space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">NewAPI 余额</span>
                <b>
                  {!authenticated
                    ? "体验模式"
                    : !signedIn
                      ? "登录已过期"
                      : me?.user?.balance == null
                        ? "读取中"
                        : me.user.balance.toFixed(2)}
                </b>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">分组</span>
                <b>{me?.user?.group || "-"}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">LFN AFF</span>
                <b>
                  {signedIn
                    ? aff
                      ? `${aff.balance} + ${aff.packageBalance}`
                      : "读取中"
                    : "-"}
                </b>
              </div>
              {signedIn && aff && (
                <div className="text-right text-[10px] text-[var(--muted)]">
                  个人 AFF + 图包额度
                </div>
              )}
            </div>
            <Link
              href="/sign-in"
              className="mt-2 flex h-9 items-center justify-center rounded bg-[#292d2c] text-xs font-semibold text-white"
            >
              {signedIn
                ? "切换账户"
                : authenticated
                  ? "重新登录"
                  : "登录使用真实余额"}
            </Link>
            {signedIn && (
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/sign-in");
                  router.refresh();
                }}
                className="mt-2 flex h-9 w-full items-center justify-center rounded border border-[var(--line)] bg-white text-xs font-semibold"
              >
                退出登录
              </button>
            )}
          </div>
    </>
  );

  const naiGenerationFooter = (
    <div className="nai-generation-footer">
      {!sidebarPromptLayout && generationParameters}
      {operation !== "suggest-tags" && (
        <NaiBalanceMeter
          signedIn={signedIn}
          unit={canUseAffEstimate ? "AFF" : "USD"}
          balance={canUseAffEstimate ? wallet?.aff?.totalBalance : me?.user?.balance}
          cost={canUseAffEstimate ? estimatedAffCost : estimatedNewApiCost}
        />
      )}
      <div className="nai-generation-action">
        <button
          onClick={runOperation}
          disabled={generating}
          title={
            canUseAffEstimate
              ? `图包 -${estimatedPackageCost} / 个人 -${estimatedPersonalCost} · 余量 ${wallet?.aff?.packageBalance ?? 0} / ${wallet?.aff?.balance ?? 0}`
              : modelPricing
                ? `$上游 {modelPricing.effectiveGroup} × ${modelPricing.groupRatio} 倍率；实际以账单为准 · 按 NewAPI 余额计费`
                : undefined
          }
          className="nai-generate-button"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={18} />
            {generating
              ? streamProgress
                ? `生成中 ${streamProgress}`
                : batchProgress
                  ? `生成中 ${batchProgress}…`
                  : "处理中，请稍候..."
              : generationModes.has(operation)
                ? `生成 ${count} 张图像`
                : `执行${modes.find((item) => item.id === operation)?.label}`}
          </span>
          {!generating && (canUseAffEstimate || estimatedNewApiCost != null) && (
            <span className="nai-cost-badge" title={canUseAffEstimate ? "预计创作额度" : "标准美元预估，实际扣费以 NewAPI 配置为准"}>
              {canUseAffEstimate
                ? `${estimatedAffCost} AFF`
                : estimatedNewApiCost != null
                  ? `预计 $${estimatedNewApiCost.toFixed(2)}`
                  : null}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  const displayedImages = images.length ? images : previewDrafts;

  return (
    <main
      data-studio-layout={naiLayout ? "nai" : "classic"}
      data-workspace-layout={!naiLayout ? preferences.workspaceLayout : undefined}
      className="flex h-[100dvh] min-h-[560px] flex-col overflow-hidden bg-[var(--paper)]"
    >
      {!naiLayout && (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[#fffefa]/95 px-4">
          <div className="flex items-center gap-3">
            <Aperture className="text-[var(--rose)]" size={23} />
            <span className="font-[var(--font-display)] text-lg font-bold">
              Love for NAI
            </span>
            <span className="hidden text-[10px] text-[var(--muted)] sm:inline">
              IMAGE STUDIO
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              title="源代码与 AGPL-3.0"
              href="https://github.com/fuilyha56-wq/love-for-nai"
              target="_blank"
              rel="noreferrer"
              className="hidden h-9 w-9 place-items-center rounded border border-[var(--line)] bg-white sm:grid"
            >
              <Code2 size={16} />
            </a>
            <a
              title="打开 NewAPI 控制台"
              href="http://47.108.250.118:3000/"
              target="_blank"
              rel="noreferrer"
              className="hidden h-9 w-9 place-items-center rounded border border-[var(--line)] bg-white sm:grid"
            >
              <ExternalLink size={16} />
            </a>
            <span
              className={`hidden px-2 py-1 text-xs sm:inline ${signedIn ? "text-emerald-700" : authenticated ? "text-red-700" : "text-amber-700"}`}
            >
              {signedIn
                ? "NewAPI 已连接"
                : authenticated
                  ? "登录已过期"
                  : "体验模式"}
            </span>
            {signedIn || !authenticated ? (
              <Link
                href="/account"
                title="我的账号：资料、钱包、签到与邀请"
                className="flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm hover:border-[var(--rose)]"
              >
                <UserRound size={16} />
                {userName}
              </Link>
            ) : (
              <Link
                href="/sign-in"
                className="flex h-9 items-center gap-2 rounded border border-[var(--rose)] bg-white px-3 text-sm font-semibold text-[var(--rose)]"
              >
                <UserRound size={16} />
                重新登录
              </Link>
            )}
          </div>
        </header>
      )}
      <div className={`studio-layout grid min-h-0 flex-1${preferences.workspaceLayout === "custom" && !naiLayout ? " is-custom-layout" : ""}`}
        style={
          {
            "--lfn-left": `${leftWidth}px`,
            "--lfn-right": `${rightWidth}px`,
          } as React.CSSProperties
        }
      >
        <aside className="studio-controls-panel panel hidden min-h-0 border-y-0 border-l-0 lg:flex lg:flex-col">
          {controls}
          {sidebarPromptLayout && naiGenerationFooter}
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左侧面板宽度"
          aria-valuenow={leftWidth}
          aria-valuemin={240}
          aria-valuemax={520}
          tabIndex={0}
          className="panel-resizer hidden lg:block"
          onPointerDown={(event) => startResize("left", event)}
          onKeyDown={(event) => resizePanelWithKeyboard("left", event)}
          onDoubleClick={() => { setLeftWidth(naiLayout ? 400 : 310); savePanelWidths(naiLayout ? 400 : 310, rightWidth); }}
        />
        <section className="studio-canvas flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3 lg:hidden">
            <button
              ref={mobilePanelTriggerRef}
              onClick={() => setMobilePanel(true)}
              className="flex items-center gap-2 text-sm"
            >
              <Menu size={18} />
              图像设置
            </button>
            <span className="text-xs text-[var(--muted)]">
              {width}×{height}
            </span>
            <button
              ref={mobileToolsTriggerRef}
              onClick={() => setMobileToolsOpen(true)}
              className="flex items-center gap-2 text-sm"
            >
              <Images size={18} />
              功能区
            </button>
          </div>
          {!sidebarPromptLayout &&
            (promptModes.has(operation) || operation === "suggest-tags") && (
              <div className="grid shrink-0 gap-3 border-b border-[var(--line)] bg-[#f2f0ea] p-3 xl:grid-cols-2">
                <Prompt
                  label={
                    operation.startsWith("director-") ? "工具提示" : "描述画面"
                  }
                  value={prompt}
                  onChange={setPrompt}
                  accent
                />
                {operation !== "suggest-tags" && (
                  <Prompt
                    label="排除内容"
                    value={negative}
                    onChange={setNegative}
                  />
                )}
              </div>
            )}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-5">
            <div className="pointer-events-none absolute left-4 top-3 z-10 rounded bg-[var(--paper)]/85 px-1.5 py-0.5 text-xs text-[var(--muted)]">
              {modes.find((item) => item.id === operation)?.label} · {width}×
              {height} · {count} 张
            </div>
            {operation === "suggest-tags" && suggestedTags.length ? (
              <div className="flex max-w-3xl flex-wrap justify-center gap-2">
                {suggestedTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() =>
                      setPrompt(
                        (value) => `${value}${value.trim() ? ", " : ""}${tag}`,
                      )
                    }
                    className="rounded border border-[var(--line)] bg-white px-3 py-2 text-xs"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : displayedImages.length ? (
              <div className="workspace-results-scroll">
                <div className="workspace-result-hero">
                  <button type="button" onClick={() => setLightboxIndex(0)} title="点击放大查看" className="workspace-result-image">
                    <Image src={displayedImages[0]} alt="NAI 主结果" width={width} height={height} unoptimized />
                  </button>
                  {generating && !images.length && <div className="workspace-result-progress">{streamProgress || "正在生成预览…"}</div>}
                  {images.length > 0 && <div className="workspace-result-actions">
                    <button type="button" onClick={() => applyImageAsSource(displayedImages[0], "img2img")} aria-label="将主图用于图生图" title="用于图生图"><ImagePlus size={15} /></button>
                    <button type="button" onClick={() => applyImageAsSource(displayedImages[0], "inpainting")} aria-label="将主图用于局部重绘" title="用于局部重绘"><Brush size={15} /></button>
                    <button type="button" onClick={() => applyImageAsSource(displayedImages[0], "director-lineart")} aria-label="将主图用于导演工具" title="用于导演工具"><WandSparkles size={15} /></button>
                    <a href={displayedImages[0]} download="lfn-1.png" title="下载主图"><Download size={15} /></a>
                  </div>}
                </div>
                {displayedImages.length > 1 && <div className="workspace-result-list">
                  {displayedImages.slice(1).map((image, index) => (
                    <div key={`${image.slice(-24)}-${index}`} className={`workspace-result-item${selectedImageIndex === index + 1 ? " is-selected" : ""}`}>
                      <button type="button" onClick={() => { setSelectedImageIndex(index + 1); setLightboxIndex(index + 1); }} title={`查看第 ${index + 2} 张`}>
                        <Image src={image} alt={`NAI 结果 ${index + 2}`} width={width} height={height} unoptimized />
                      </button>
                      {images.length > 0 && <button type="button" onClick={() => applyImageAsSource(image, "img2img")} aria-label={`第 ${index + 2} 张用于图生图`} title="用于图生图"><ImagePlus size={14} /></button>}
                    </div>
                  ))}
                </div>}
              </div>
            ) : (
              <div className="pointer-events-none flex max-w-md flex-col items-center px-5 text-center">
                <WandSparkles
                  className="mb-4 text-[var(--rose)]"
                  size={36}
                  strokeWidth={1.5}
                />
                <h2 className="font-[var(--font-display)] text-xl leading-7">
                  画布等待你的想象
                </h2>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  选择工具、配置参数并提交。
                </p>
              </div>
            )}
          </div>
          {notice && (
            <div className="mx-3 mb-2 flex items-start justify-between gap-2 rounded border border-[#e4c991] bg-[#fff8e8] px-3 py-2.5 text-sm text-[#77531e] sm:mx-4 sm:mb-3 sm:px-4 sm:py-3">
              <span className="min-w-0 break-words">{notice}</span>
              <button
                onClick={() => setNotice("")}
                aria-label="关闭提示"
                className="shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!sidebarPromptLayout && (
            <div className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] bg-[#fffefa] p-3">
              {operation !== "suggest-tags" && signedIn && (
                <div className="hidden shrink-0 text-right text-[10px] leading-4 text-[var(--muted)] sm:block">
                  {canUseAffEstimate ? (
                    <>
                      <div>
                        预计消耗{" "}
                        <b className="text-[var(--ink)]">
                          {estimatedAffCost} AFF
                        </b>
                      </div>
                      {estimatedPackageCost > 0 && (
                        <div>
                          图包额度{" "}
                          <b className="text-[var(--ink)]">
                            -{estimatedPackageCost} AFF
                          </b>
                        </div>
                      )}
                      {estimatedPersonalCost > 0 && (
                        <div>
                          个人 AFF{" "}
                          <b className="text-[var(--ink)]">
                            -{estimatedPersonalCost} AFF
                          </b>
                        </div>
                      )}
                      <div>
                        图包 / 个人余量{" "}
                        <b className="text-[var(--ink)]">
                          {wallet?.aff?.packageBalance ?? 0} /{" "}
                          {wallet?.aff?.balance ?? 0}
                        </b>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        预计消耗{" "}
                        <b className="text-[var(--ink)]">
                          {estimatedNewApiCost == null ? "暂不可估算" : `$${estimatedNewApiCost.toFixed(2)}`}
                        </b>
                      </div>
                      {modelPricing && (
                        <div>
                          上游 {modelPricing.effectiveGroup} ×{" "}
                          {modelPricing.groupRatio} 倍率；实际以账单为准
                        </div>
                      )}
                      <div>
                        图包/个人 AFF 不足或服务未启用，将使用 NewAPI 余额
                      </div>
                      <div>
                        NewAPI 余额{" "}
                        <b className="text-[var(--ink)]">
                          {me?.user?.balance != null
                            ? `$${me.user.balance.toFixed(2)}`
                            : "--"}
                        </b>
                      </div>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={runOperation}
                disabled={generating}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded bg-[var(--rose)] text-sm font-semibold text-white disabled:opacity-60 sm:h-12 sm:text-base"
              >
                <Sparkles size={18} />
                {generating
                  ? batchProgress
                    ? `生成中 ${batchProgress}…`
                    : "处理中，请稍候..."
                  : `执行${modes.find((item) => item.id === operation)?.label}`}
              </button>
            </div>
          )}
        </section>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧面板宽度"
          aria-valuenow={rightWidth}
          aria-valuemin={200}
          aria-valuemax={460}
          tabIndex={0}
          className="panel-resizer hidden lg:block"
          onPointerDown={(event) => startResize("right", event)}
          onKeyDown={(event) => resizePanelWithKeyboard("right", event)}
          onDoubleClick={() => { setRightWidth(230); savePanelWidths(leftWidth, 230); }}
        />
        <aside
          className={`studio-tools-panel panel hidden min-h-0 flex-col border-y-0 border-r-0 lg:flex${rightPanelCollapsed ? " is-collapsed" : ""}`}
          onMouseEnter={openRightPanel}
          onMouseLeave={scheduleRightPanelClose}
          onFocus={openRightPanel}
          onBlur={scheduleRightPanelClose}
        >
          <button
            type="button"
            className="tools-panel-collapse"
            aria-label={rightPanelCollapsed ? "展开功能栏" : "折叠功能栏"}
            aria-expanded={!rightPanelCollapsed}
            onClick={() => setRightPanelCollapsed((current) => !current)}
          >
            {rightPanelCollapsed ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </button>
          {rightPanelCollapsed ? (
            <div className="collapsed-history-rail" aria-label="本次历史缩略图">
              {sessionHistory.map((item) => (
                <button type="button" key={item.id} onClick={() => { openRightPanel(); applyImageAsSource(item.image, "img2img"); }} aria-label="使用历史图片">
                  <Image src={item.image} alt="历史图片" width={38} height={38} unoptimized />
                </button>
              ))}
            </div>
          ) : toolsPanel}
        </aside>
      </div>
      {lightboxIndex !== null && displayedImages[lightboxIndex] && (
        <Lightbox
          images={displayedImages}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={setLightboxIndex}
        />
      )}
      {agentImageZoom && agentImage && (
        <Lightbox
          images={[agentImage]}
          index={0}
          onClose={() => setAgentImageZoom(false)}
          onNavigate={() => {}}
        />
      )}
      {mobilePanel && (
        <div
          className="fixed inset-0 z-40 bg-black/35 lg:hidden"
          onClick={() => setMobilePanel(false)}
        >
          <aside
            ref={mobilePanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="图像设置"
            tabIndex={-1}
            className="studio-controls-panel panel flex h-full w-[min(90vw,350px)] flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] px-4">
              <b className="flex items-center gap-2 text-sm">
                <SlidersHorizontal size={15} className="text-[var(--rose)]" />{" "}
                图像设置
              </b>
              <button
                onClick={() => setMobilePanel(false)}
                aria-label="关闭图像设置"
              >
                <X size={18} />
              </button>
            </div>
            {controls}
            {sidebarPromptLayout && naiGenerationFooter}
          </aside>
        </div>
      )}
      {mobileToolsOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/35 lg:hidden"
          onClick={() => setMobileToolsOpen(false)}
        >
          <aside
            ref={mobileToolsRef}
            role="dialog"
            aria-modal="true"
            aria-label="功能区"
            tabIndex={-1}
            className="panel ml-auto flex h-full w-[min(90vw,350px)] flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] px-4">
              <b className="flex items-center gap-2 text-sm">
                <Images size={15} className="text-[var(--rose)]" /> 功能区
              </b>
              <button
                onClick={() => setMobileToolsOpen(false)}
                aria-label="关闭功能区"
              >
                <X size={18} />
              </button>
            </div>
            {toolsPanel}
          </aside>
        </div>
      )}
      {naiLayout && menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/35"
          onClick={() => setMenuOpen(false)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="站内菜单"
            className="nai-menu panel absolute right-0 top-0 flex h-full w-[min(85vw,340px)] flex-col overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="nai-menu-head">
              <div className="flex min-w-0 items-center gap-2.5">
                <Aperture className="text-[var(--nai-action)]" size={20} />
                <div className="min-w-0">
                  <b className="block truncate font-[var(--font-display)] text-base leading-5">
                    Love for NAI
                  </b>
                  <span className="block text-[9px] tracking-[0.22em] text-[var(--muted)]">
                    IMAGE STUDIO
                  </span>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => setMenuOpen(false)}
                className="nai-menu-close"
              >
                <X size={16} />
              </button>
            </div>

            <p className="nai-menu-label">账号</p>
            <div className="nai-menu-user">
              <span className="nai-menu-avatar" aria-hidden="true">
                {(userName || "游").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <b className="block truncate text-sm">{userName}</b>
                <small
                  className={
                    signedIn
                      ? "text-emerald-600"
                      : authenticated
                        ? "text-red-600"
                        : "text-[var(--muted)]"
                  }
                >
                  {signedIn
                    ? "NewAPI 已连接"
                    : authenticated
                      ? "登录已过期"
                      : "体验模式 · 不扣费"}
                </small>
              </span>
            </div>
            <Link href="/account" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <UserRound size={16} /> 我的账号
            </Link>
            {signedIn ? (
              <button
                type="button"
                className="nai-menu-item"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/sign-in");
                  router.refresh();
                }}
              >
                <X size={16} /> 退出登录
              </button>
            ) : (
              <Link href="/sign-in" onClick={() => setMenuOpen(false)} className="nai-menu-item">
                <UserRound size={16} /> 重新登录
              </Link>
            )}

            <p className="nai-menu-label">创作</p>
            <Link href="/history" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <Images size={16} /> 图片历史
            </Link>
            <Link href="/gallery" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <Images size={16} /> 图片广场
            </Link>
            <Link href="/usage" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <SlidersHorizontal size={16} /> 使用记录
            </Link>
            <button
              type="button"
              className="nai-menu-item"
              aria-expanded={menuDirectorOpen}
              onClick={() => setMenuDirectorOpen((open) => !open)}
            >
              <WandSparkles size={16} /> 导演工具
              <ChevronRight size={14} className={`nai-menu-chev ${menuDirectorOpen ? "is-open" : ""}`} />
            </button>
            {menuDirectorOpen && (
              <div className="nai-menu-sub">
                {modes
                  .filter((item) => item.id.startsWith("director-"))
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="nai-menu-item"
                      onClick={() => {
                        selectOperation(item.id);
                        setNotice("");
                        setMenuOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
              </div>
            )}
            <button
              type="button"
              className="nai-menu-item"
              onClick={() => {
                setMenuOpen(false);
                window.setTimeout(() => {
                  document
                    .querySelector<HTMLTextAreaElement>('textarea[aria-label="标签助手输入"]')
                    ?.focus();
                }, 60);
              }}
            >
              <Sparkles size={16} /> 标签助手
            </button>

            <p className="nai-menu-label">设置</p>
            <Link href="/settings" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <Paintbrush size={16} /> 外观设置
            </Link>
            <Link href="/resources" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <Code2 size={16} /> 模型密钥
            </Link>
            <Link href="/announcements" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <Megaphone size={16} /> 公告
            </Link>
            {isAdmin && (
              <Link href="/admin" onClick={() => setMenuOpen(false)} className="nai-menu-item">
                <ShieldCheck size={16} /> 管理
              </Link>
            )}

            <p className="nai-menu-label">其他</p>
            <a
              href="https://github.com/fuilyha56-wq/love-for-nai"
              target="_blank"
              rel="noreferrer"
              className="nai-menu-item"
            >
              <Code2 size={16} /> 源代码与 AGPL-3.0
            </a>
            <a
              href="http://47.108.250.118:3000/"
              target="_blank"
              rel="noreferrer"
              className="nai-menu-item"
            >
              <ExternalLink size={16} /> NewAPI 控制台
            </a>

            <p className="nai-menu-foot">
              图片历史、导演工具等创作入口已收入此菜单。
            </p>
          </aside>
        </div>
      )}
      {galleryPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setGalleryPickerOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-[var(--panel)] p-4" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <b>从公开图库选择图片</b>
              <button type="button" aria-label="关闭图库选择器" onClick={() => setGalleryPickerOpen(false)}><X size={18} /></button>
            </div>
            <GalleryPicker
              returnDataUrl
              onSelect={(dataUrl) => {
                applyImageAsSource(dataUrl, "img2img");
                setGalleryPickerOpen(false);
              }}
            />
          </div>
        </div>
      )}
      {maskEditorOpen && source && (
        <MaskEditor
          source={source}
          initialMask={mask}
          onClose={() => setMaskEditorOpen(false)}
          onSave={(nextMask) => {
            setMask(nextMask);
            setMaskEditorOpen(false);
          }}
          onReplaceSource={(nextSource) => {
            setSource(nextSource);
            setMask(null);
          }}
          onPreciseRedraw={preciseRedraw}
        />
      )}
      {dropActive && !maskEditorOpen && (
        <DropOverlay onPick={() => setDropActive(false)} />
      )}
    </main>
  );
}

// 拖放进行中的全屏提示遮罩：portal 到 body，主题变量 + 虚线内框。
function DropOverlay({ onPick }: { onPick: () => void }) {
  return createPortal(
    <div
      className="drop-overlay"
      role="button"
      aria-label="松手导入图片与生成参数"
      onPointerDown={onPick}
    >
      <div className="drop-overlay-card">
        <FileUp size={30} className="text-[var(--rose)]" />
        <p className="drop-overlay-title">松手导入图片</p>
        <p className="drop-overlay-hint">
          自动读取 NAI 生成参数，并把图片设为图生图源图
        </p>
      </div>
    </div>,
    document.body,
  );
}

function FeatureLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="feature-link">
      {icon}
      <span>{label}</span>
    </Link>
  );
}

// —— 蒙版编辑器（交互特性移植自 novelai_local_web InpaintWorkspace，AGPL-3.0）——
// NAI 语义：白色（不透明）= 重绘区。笔迹始终以白色存入蒙版画布，
// 颜色/不透明度仅影响预览渲染；导出前可按“扩张像素”做圆形印章扩张。
type MaskStroke = {
  size: number;
  erase: boolean;
  points: Array<{ x: number; y: number }>;
};

const MASK_COLORS = ["#ff4d4f", "#ffb300", "#4dabf7", "#f783ac", "#51cf66"];

function renderMaskStrokes(
  context: CanvasRenderingContext2D,
  strokes: MaskStroke[],
) {
  for (const stroke of strokes) {
    context.save();
    context.globalCompositeOperation = stroke.erase
      ? "destination-out"
      : "source-over";
    context.strokeStyle = "#fff";
    context.fillStyle = "#fff";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Math.max(stroke.size, 1);
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(
        point.x,
        point.y,
        Math.max(stroke.size / 2, 1),
        0,
        Math.PI * 2,
      );
      context.fill();
    } else {
      context.beginPath();
      stroke.points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();
    }
    context.restore();
  }
}

// 圆形印章式扩张（移植自 novelai_local_web dilateWhiteMask）。
function dilateMask(
  source: HTMLCanvasElement,
  radius: number,
): HTMLCanvasElement {
  if (!radius) return source;
  const expanded = document.createElement("canvas");
  expanded.width = source.width;
  expanded.height = source.height;
  const context = expanded.getContext("2d");
  if (!context) return source;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
      context.drawImage(source, offsetX, offsetY);
    }
  }
  return expanded;
}

// 旧版编辑器导出的是黑色笔迹；检测到深色为主的蒙版时反相为白色语义。
function normalizeMaskImage(
  image: HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height);
  let dark = 0;
  let light = 0;
  for (let index = 0; index < data.data.length; index += 4) {
    if (data.data[index + 3] < 128) continue;
    if (
      data.data[index] + data.data[index + 1] + data.data[index + 2] >=
      384
    )
      light += 1;
    else dark += 1;
  }
  if (dark > light) {
    for (let index = 0; index < data.data.length; index += 4) {
      if (data.data[index + 3] >= 128) {
        data.data[index] = 255;
        data.data[index + 1] = 255;
        data.data[index + 2] = 255;
        data.data[index + 3] = 255;
      } else {
        data.data[index + 3] = 0;
      }
    }
    context.putImageData(data, 0, 0);
  }
  return canvas;
}

function MaskEditor({
  source,
  initialMask,
  onClose,
  onSave,
  onReplaceSource,
  onPreciseRedraw,
}: {
  source: Upload;
  initialMask: Upload | null;
  onClose: () => void;
  onSave: (mask: Upload) => void;
  onReplaceSource: (upload: Upload) => void;
  onPreciseRedraw?: (selection: Rect) => Promise<void>;
}) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<MaskStroke[]>([]);
  const historyRef = useRef<{
    past: MaskStroke[][];
    future: MaskStroke[][];
  }>({ past: [], future: [] });
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const currentStrokeRef = useRef<MaskStroke | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [baseImage, setBaseImage] = useState<HTMLCanvasElement | null>(null);
  const [imageRatio, setImageRatio] = useState(1);
  const [tool, setTool] = useState<"brush" | "eraser" | "rectangle">("brush");
  const [selection, setSelection] = useState<Rect | null>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(32);
  const [maskColor, setMaskColor] = useState("#ff4d4f");
  const [maskOpacity, setMaskOpacity] = useState(0.4);
  const [expandPixels, setExpandPixels] = useState(8);
  const [showMaskPreview, setShowMaskPreview] = useState(false);
  const [bgMode, setBgMode] = useState<"checker" | "white">("checker");
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [historyFlags, setHistoryFlags] = useState({
    undo: false,
    redo: false,
  });
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // 载入源图：按原始尺寸建离屏蒙版/着色画布，并归一化已有蒙版。
  useEffect(() => {
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (cancelled) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      setImageRatio(width / height);
      setCanvasSize({ width, height });
      const mask = document.createElement("canvas");
      mask.width = width;
      mask.height = height;
      maskCanvasRef.current = mask;
      const overlay = document.createElement("canvas");
      overlay.width = width;
      overlay.height = height;
      overlayRef.current = overlay;
      setStrokes([]);
      historyRef.current = { past: [], future: [] };
      setHistoryFlags({ undo: false, redo: false });
      if (!initialMask) {
        setBaseImage(null);
        return;
      }
      const existing = new window.Image();
      existing.onload = () => {
        if (cancelled) return;
        setBaseImage(normalizeMaskImage(existing, width, height));
      };
      existing.onerror = () => {
        if (!cancelled) setBaseImage(null);
      };
      existing.src = initialMask.data;
    };
    image.src = source.data;
    return () => {
      cancelled = true;
    };
  }, [initialMask, source.data]);

  // 把着色后的蒙版合成到预览层（或显示黑白原始蒙版）。
  const compose = useCallback(() => {
    const display = displayRef.current;
    const mask = maskCanvasRef.current;
    const overlay = overlayRef.current;
    if (!display || !mask || !overlay) return;
    const context = display.getContext("2d");
    const overlayContext = overlay.getContext("2d");
    if (!context || !overlayContext) return;
    context.clearRect(0, 0, display.width, display.height);
    if (showMaskPreview) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, display.width, display.height);
      context.drawImage(mask, 0, 0);
      return;
    }
    overlayContext.globalCompositeOperation = "source-over";
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
    overlayContext.drawImage(mask, 0, 0);
    overlayContext.globalCompositeOperation = "source-in";
    overlayContext.fillStyle = maskColor;
    overlayContext.fillRect(0, 0, overlay.width, overlay.height);
    overlayContext.globalCompositeOperation = "source-over";
    context.globalAlpha = maskOpacity;
    context.drawImage(overlay, 0, 0);
    context.globalAlpha = 1;
  }, [maskColor, maskOpacity, showMaskPreview]);

  // 笔迹/底图变化时重建蒙版画布（撤销、重做、清空共用此路径）。
  useEffect(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const context = mask.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, mask.width, mask.height);
    if (baseImage) context.drawImage(baseImage, 0, 0, mask.width, mask.height);
    renderMaskStrokes(context, strokes);
    compose();
  }, [baseImage, compose, strokes]);

  const commitHistory = (previous: MaskStroke[]) => {
    historyRef.current.past.push(previous);
    historyRef.current.future = [];
    setHistoryFlags({ undo: true, redo: false });
  };

  const undo = useCallback(() => {
    const previous = historyRef.current.past.pop();
    if (previous === undefined) return;
    historyRef.current.future.push(strokesRef.current);
    strokesRef.current = previous;
    setStrokes(previous);
    setHistoryFlags({
      undo: historyRef.current.past.length > 0,
      redo: true,
    });
  }, []);

  const redo = useCallback(() => {
    const next = historyRef.current.future.pop();
    if (next === undefined) return;
    historyRef.current.past.push(strokesRef.current);
    strokesRef.current = next;
    setStrokes(next);
    setHistoryFlags({
      undo: true,
      redo: historyRef.current.future.length > 0,
    });
  }, []);

  // 快捷键：Ctrl+Z / Ctrl+Y（或 Ctrl+Shift+Z）撤销重做，[ ] 调笔刷，B/E 切工具。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = document.activeElement as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        redo();
      } else if (key === "[") {
        setBrushSize((size) => Math.max(4, size - 4));
      } else if (key === "]") {
        setBrushSize((size) => Math.min(200, size + 4));
      } else if (key === "b") {
        setTool("brush");
      } else if (key === "e") {
        setTool("eraser");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [redo, undo]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = displayRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return clampPoint({
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    }, { width: canvas.width, height: canvas.height });
  }

  function strokeSegment(
    stroke: MaskStroke,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    const mask = maskCanvasRef.current;
    const context = mask?.getContext("2d");
    if (!mask || !context) return;
    context.save();
    context.globalCompositeOperation = stroke.erase
      ? "destination-out"
      : "source-over";
    context.strokeStyle = "#fff";
    context.fillStyle = "#fff";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Math.max(stroke.size, 1);
    if (from.x === to.x && from.y === to.y) {
      // 单击落点：零长度线段在部分浏览器不渲染，用圆点补齐。
      context.beginPath();
      context.arc(to.x, to.y, Math.max(stroke.size / 2, 1), 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.restore();
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(event);
    if (tool === "rectangle" && selectionStartRef.current && point) {
      setSelection(normalizeRect(selectionStartRef.current, point));
      return;
    }
    if (!drawingRef.current || !currentStrokeRef.current) return;
    const canvas = displayRef.current;
    const previous = lastPointRef.current;
    if (!canvas || !point || !previous) return;
    strokeSegment(currentStrokeRef.current, previous, point);
    currentStrokeRef.current.points.push(point);
    lastPointRef.current = point;
    compose();
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = displayRef.current;
    const point = pointFromEvent(event);
    if (!canvas || !point) return;
    if (tool === "rectangle") {
      selectionStartRef.current = point;
      setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    drawingRef.current = true;
    // 笔刷大小按显示像素输入，存储时换算成画布像素，窗口缩放后仍一致。
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    currentStrokeRef.current = {
      size: brushSize * scale,
      erase: tool === "eraser",
      points: [point],
    };
    strokeSegment(currentStrokeRef.current, point, point);
    lastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    compose();
  }

  function stopDrawing(event?: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "rectangle") {
      const start = selectionStartRef.current;
      const end = event ? pointFromEvent(event) : null;
      selectionStartRef.current = null;
      drawingRef.current = false;
      if (start && end) {
        const next = normalizeRect(start, end);
        if (next.width >= 8 && next.height >= 8) setSelection(next);
      }
      return;
    }
    if (currentStrokeRef.current) {
      commitHistory(strokesRef.current);
      setStrokes((current) => [...current, currentStrokeRef.current!]);
    }
    currentStrokeRef.current = null;
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearMask() {
    if (!strokesRef.current.length && !baseImage) return;
    commitHistory(strokesRef.current);
    strokesRef.current = [];
    setStrokes([]);
    setBaseImage(null);
    setHistoryFlags({
      undo: historyRef.current.past.length > 0,
      redo: false,
    });
  }

  function saveMask() {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const expanded = dilateMask(mask, Math.max(0, Math.round(expandPixels)));
    onSave({ data: expanded.toDataURL("image/png"), name: "绘制蒙版.png" });
  }

  function replaceSource(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string")
        onReplaceSource({ data: reader.result, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  return createPortal(
    <div
      className="mask-editor"
      role="dialog"
      aria-modal="true"
      aria-label="蒙版编辑器"
    >
      <div className="mask-editor-topbar">
        <div className="mask-editor-tools">
          <button
            type="button"
            className={tool === "brush" ? "is-active" : ""}
            onClick={() => setTool("brush")}
            title="画笔（B）"
          >
            <Brush size={18} /> <span>画笔</span>
          </button>
          <button
            type="button"
            className={tool === "eraser" ? "is-active" : ""}
            onClick={() => setTool("eraser")}
            title="橡皮擦（E）"
          >
            <Eraser size={18} /> <span>橡皮</span>
          </button>
          <button
            type="button"
            className={tool === "rectangle" ? "is-active" : ""}
            onClick={() => setTool("rectangle")}
            title="矩形选区：用于精确重绘"
          >
            <span aria-hidden="true">▣</span> <span>精确选区</span>
          </button>
          <label>
            <span>笔刷大小：{brushSize}</span>
            <WheelNumberInput
              className="mask-editor-number"
              ariaLabel="笔刷大小"
              min={4}
              max={200}
              step={2}
              value={brushSize}
              setValue={setBrushSize}
            />
          </label>
        </div>
        <div className="mask-editor-actions">
          <button
            type="button"
            onClick={() => replaceInputRef.current?.click()}
            title="替换源图片"
          >
            <FileUp size={17} /> <span>替换源图</span>
          </button>
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              replaceSource(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button type="button" onClick={saveMask} className="primary">
            <Save size={17} /> 保存并关闭
          </button>
          <button
            type="button"
            onClick={() => selection && onPreciseRedraw?.(selection)}
            disabled={!selection || selection.width < 8 || selection.height < 8 || !onPreciseRedraw}
            className="primary"
            title="只重绘矩形选区并合成回原图"
          >
            <WandSparkles size={17} /> 精确重绘选区
          </button>
          <button type="button" onClick={onClose} title="关闭蒙版编辑器">
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="mask-editor-stage">
        <div
          className={`mask-editor-canvas-wrap${bgMode === "white" ? " plain" : ""}`}
          style={{
            aspectRatio: imageRatio,
            width: `min(86vw, calc(76vh * ${imageRatio}))`,
          }}
        >
          <Image
            src={source.data}
            alt="待编辑的源图片"
            fill
            unoptimized
            className="object-contain"
          />
          <canvas
            ref={displayRef}
            width={canvasSize.width}
            height={canvasSize.height}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={() => stopDrawing()}
            aria-label="蒙版绘制画布"
          />
          {selection && selection.width > 0 && selection.height > 0 && (
            <div
              className="mask-editor-selection"
              style={{
                left: `${(selection.x / Math.max(canvasSize.width, 1)) * 100}%`,
                top: `${(selection.y / Math.max(canvasSize.height, 1)) * 100}%`,
                width: `${(selection.width / Math.max(canvasSize.width, 1)) * 100}%`,
                height: `${(selection.height / Math.max(canvasSize.height, 1)) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      <div className="mask-editor-bottombar">
        <div className="mask-editor-tools">
          <button
            type="button"
            onClick={undo}
            disabled={!historyFlags.undo}
            title="撤销（Ctrl+Z）"
          >
            <Undo2 size={17} /> <span>撤销</span>
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!historyFlags.redo}
            title="重做（Ctrl+Y）"
          >
            <Redo2 size={17} /> <span>重做</span>
          </button>
          <button
            type="button"
            onClick={clearMask}
            title="清空蒙版"
          >
            <Trash2 size={17} /> <span>清空</span>
          </button>
          <button
            type="button"
            className={showMaskPreview ? "is-active" : ""}
            onClick={() => setShowMaskPreview((current) => !current)}
            title="显示上游实际收到的黑白蒙版"
          >
            <Eye size={17} /> <span>蒙版预览</span>
          </button>
          <button
            type="button"
            className={bgMode === "white" ? "is-active" : ""}
            onClick={() =>
              setBgMode((current) =>
                current === "white" ? "checker" : "white",
              )
            }
            title="切换白色/棋盘背景"
          >
            <ImageIcon size={17} /> <span>背景</span>
          </button>
        </div>
        <div className="mask-editor-tools">
          {MASK_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              className={`mask-editor-color-swatch${maskColor === color ? " is-active" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => setMaskColor(color)}
              aria-label={`蒙版颜色 ${color}`}
            />
          ))}
          <label>
            <span>不透明度</span>
            <WheelNumberInput
              className="mask-editor-number"
              ariaLabel="蒙版不透明度"
              min={0.05}
              max={1}
              step={0.05}
              value={maskOpacity}
              setValue={setMaskOpacity}
            />
          </label>
          <label>
            <span>扩张像素</span>
            <WheelNumberInput
              className="mask-editor-number"
              ariaLabel="蒙版扩张像素"
              min={0}
              max={64}
              step={1}
              value={expandPixels}
              setValue={setExpandPixels}
            />
          </label>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 左侧参数面板的折叠分区，视觉对齐 novelai_local_web 的手风琴分区。
function PanelSection({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="panel-section-head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="panel-section-icon">{icon}</span>
        <b>{title}</b>
        <ChevronRight size={14} className="panel-section-chev" />
      </button>
      {open && <div className="panel-section-body">{children}</div>}
    </section>
  );
}

function Control({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block text-xs font-semibold text-[#4c5052]">
      <span className="mb-2 block">{label}</span>
      {children}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="assistant-preview-row">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}
function NumericSlider({
  label,
  value,
  setValue,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  setValue: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="nai-slider-control">
      <span className="nai-control-label">{label}</span>
      <div className="nai-slider-row">
        <WheelNumberInput
          className="nai-number-input"
          ariaLabel={label}
          value={value}
          setValue={setValue}
          min={min}
          max={max}
          step={step}
        />
        <input
          className="range min-w-0 flex-1"
          aria-label={`${label}滑块`}
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      </div>
    </div>
  );
}
function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // showModal 才会渲染 ::backdrop 并阻止背后页面交互。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  // dialog 原生 Escape 依赖焦点落在浮层内，这里直接接管更可靠。
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      onNavigate((index + step + images.length) % images.length);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, images.length, onNavigate, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="lightbox"
      aria-label="图片预览"
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="lightbox-surface">
        <Image
          src={images[index]}
          alt={`预览 ${index + 1}`}
          width={1600}
          height={1600}
          unoptimized
          priority
          className="lightbox-image"
        />
        <div className="lightbox-toolbar">
          <span>
            {index + 1} / {images.length}
          </span>
          <a href={images[index]} download={`lfn-${index + 1}.png`} title="下载">
            <Download size={16} />
          </a>
          <button type="button" onClick={onClose} aria-label="关闭预览">
            <X size={16} />
          </button>
        </div>
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="lightbox-nav is-prev"
              aria-label="上一张"
              onClick={() =>
                onNavigate((index - 1 + images.length) % images.length)
              }
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="lightbox-nav is-next"
              aria-label="下一张"
              onClick={() => onNavigate((index + 1) % images.length)}
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
function NumberField({
  value,
  setValue,
  min,
  max,
  step,
}: {
  value: number;
  setValue: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <WheelNumberInput
      className="field h-10 px-2 text-center"
      value={value}
      setValue={setValue}
      min={min}
      max={max}
      step={step}
    />
  );
}
function UploadField({
  label,
  value,
  onChange,
  onError,
}: {
  label: string;
  value: Upload | null;
  onChange: (value: Upload | null) => void;
  onError?: (message: string) => void;
}) {
  async function read(file?: File) {
    if (!file) return;
  const nextType = file.type as string;
    if (!acceptedUploadTypes.has(nextType)) {
      onError?.("仅支持 PNG/JPEG/WebP 图片");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      onError?.("图片不能超过 15MB");
      return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      onChange({ data, name: file.name });
      onError?.("");
    } catch {
      onError?.("图片读取失败，请重试");
    }
  }
  return (
    <div className="upload-field-stack">
      {value && (
        <div className="image-source-preview upload-preview">
          <Image src={value.data} alt={`${label}预览`} width={96} height={96} unoptimized />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-xs">{value.name}</b>
            <span className="text-[10px] text-[var(--muted)]">已载入参考图</span>
          </div>
          <button type="button" aria-label={`移除${label}`} title="移除" onClick={() => onChange(null)}><X size={15} /></button>
        </div>
      )}
      <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[var(--line)] bg-white px-3 text-xs">
        <ImagePlus size={16} />
        <span className="truncate">{value?.name ? `更换：${value.name}` : label}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            void read(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
function Prompt({
  label,
  value,
  onChange,
  accent = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accent?: boolean;
}) {
  return (
    <label
      className={`rounded border bg-white p-3 ${accent ? "border-[#c99ba3]" : "border-[var(--line)]"}`}
    >
      <span className="mb-2 flex items-center gap-2 text-xs font-semibold">
        {accent && <Sparkles size={13} className="text-[var(--rose)]" />}
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-14 w-full resize-none text-sm leading-6 outline-none sm:h-16"
      />
    </label>
  );
}
