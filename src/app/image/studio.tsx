"use client";
import { CharacterReferenceField } from "@/app/ui/character-reference-field";
import { supportsCharacterReferenceEdit, type CharacterReferenceBinding } from "@/lib/character-reference";
import { readReferenceAsset } from "@/lib/client-reference-library";
import "./parameter-utilities.css";
import { assistantImageFileWithType } from "@/lib/assistant-image-resource";
import { useAssistantImageSources } from "@/app/ui/use-assistant-image-sources";
import { useMetadataRestorePreferences } from "@/lib/client-metadata-restore";
import { MetadataRestoreControl } from "./metadata-restore-control";
import { appendComicCandidates } from "@/lib/client-comic-projects";
import { useImageReferences } from "@/app/ui/use-image-references";
import { ReferenceLibrary, type ReferenceLibraryProps } from "./reference-library";
import { createImageReference, type ImageReferenceKind } from "@/lib/image-references";


import { imageGenerationIntentParams } from "@/lib/client-image-generation-intent";

import { wikipediaLookupEnabled } from "@/lib/client-assistant-web";

import { useOperationQueue } from "@/app/ui/use-operation-queue";
import type { AssistantRequestSnapshot } from "@/lib/assistant-request-snapshot";

import { useAssistantConversations } from "@/app/ui/use-assistant-conversations";

import { requestCreativeMemory } from "@/lib/client-assistant-memory";
import { useAssistantModels } from "@/app/ui/use-assistant-models";

import { TagAssistantPanel } from "@/app/image/tag-assistant-panel";

import { useStudioSessionHistory } from "@/app/image/use-studio-session-history";
import { localStudioHistory, remoteStudioHistory, mergeStudioHistory, studioHistoryKey } from "@/lib/studio-history";
import { usePanelHistory } from "@/app/ui/use-panel-history";
import { hasImageCharacterPrompts, imageCharacterUseCoords, readImageCharacterPrompts } from "@/lib/image-character-prompts";
import { UserAvatar } from "@/app/ui/user-avatar";
import { PromptHistoryButton, PromptVersionProvider } from "@/app/ui/prompt-versions";
import "./studio-mode-indicator.css";
import { LfnSelect } from "@/app/ui/lfn-select";
import { dailyImageDay, dailyImageFamily, quoteDailyImage, type DailyImageBillingState } from "@/lib/daily-image-pricing";
import { lfnConfirm, lfnPrompt } from "@/app/ui/lfn-dialog";
import { copyTextToClipboard } from "@/lib/client-clipboard";


import { splitImageBatches, studioBatchSize } from "@/lib/image-batches";
import { imageHistoryReferences, readImageOperationResponse } from "@/lib/image-operation-response";
import { consumeImageStream } from "@/lib/sse";
import { ASSISTANT_CLIENT_TIMEOUT_MS, ASSISTANT_MAX_POLLS, ASSISTANT_POLL_INTERVAL_MS } from "@/lib/assistant-timing";
import { ASSISTANT_INPUT_MAX_LENGTH } from "@/lib/assistant-input";
import { ImageDownloadMenu } from "@/app/image-download-menu";
import { fetchCachedImageBlob } from "@/lib/browser-image-cache";
import { generationModelFor, inpaintModelFor } from "@/lib/inpaint-model";
import { parseImageHistoryMetadata, saveEditorComposite } from "@/lib/editor-composite-history";
import type { GenerationParameters } from "@/lib/history";
import {
  InlineChatMenu,
  InlineChatZone,
  type InlineChatMenuItem,
  type InlineChatSession,
  type InlineChatTarget,
} from "@/app/image/inline-chat";

import {
  Aperture,
  BookOpen,
  Brush,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Eraser,
  Eye,
  FileUp,
  Dices,
  Globe,
  BarChart3,
  ImagePlus,
  ImageIcon,
  Images,
  KeyRound,
  History,
  Megaphone,
  Menu,
  Maximize2,
  Move,
  Paintbrush,
  PanelLeft,
  PanelLeftClose,
  PawPrint,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  Type,
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
import { Tooltip } from "@/app/ui/tooltip";
import { WheelNumberInput } from "@/app/ui/wheel-number";
import { useAppearance } from "@/app/appearance";
import { generateRandomPrompt } from "@/lib/random-prompt";
import { PromptAutocompleteTextarea } from "@/app/image/prompt-autocomplete";
import { TagChipEditor } from "@/app/image/tag-chip-editor";
import { resolvePromptAliases, type ReplicaPromptConfig } from "@/lib/replica-prompt";
import { transformModelPromptOnBlur } from "@/lib/model-prompt";
import { tagZh } from "@/lib/tag-translations";
import {
  appendQualityTags,
  prependUcPreset,
  qualityTagsForTier,
  ucPresetContent,
  isV5Model,
  QUALITY_TIER_LABELS,
  UC_PRESET_LABELS,
  type QualityTier,
  type UcPresetType,
} from "@/lib/nai-quality";
import { NaiImageSettings, MAX_NAI_IMAGE_COUNT } from "./nai-image-settings";
import { storedAssistantReasoning } from "@/app/ui/assistant-reasoning-control";
import { MAX_ASSISTANT_IMAGES } from "@/lib/assistant-limits";
import { useAssistantUsage, useGoalRoundLimit } from "@/app/ui/assistant-usage";
import type { AssistantCallUsage } from "@/lib/assistant-usage";
import { CreditPricingButton, useCreditPricing } from "@/app/ui/credit-pricing";
import { formatAff } from "@/lib/credit-pricing";
import { roundAffAmount } from "@/lib/daily-image-pricing";
import { NaiBalanceMeter } from "./nai-balance-meter";
import { ReplicaControls, ReplicaCharacters, ReplicaNaiReference, ReplicaReverseTagger } from "./replica-controls";
import { ReplicaGenerationSettings, ReplicaImageSize } from "./replica-generation-settings";
import { NaturalImageSettings } from "./natural-image-settings";
import { naiImageSizeError, naiDimensionLimit, naiMaxSamples, isNaiLimitModel, NAI_MAX_DIMENSION } from "@/lib/nai-image-limits";
import { imageProductMode, isKnownImageModel, modelMatchesProductMode, nearestImageSize, normalizeImageModelSize, productModeProtocol, resolveImageModelCapabilities, resolveProviderImageProtocol, type ImageProductMode, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { DEFAULT_CLIENT_MODEL_POLICY, filterNaiModelOptions, type ModelPolicy } from "@/lib/model-policy";
import { NAI_IMAGE_MODEL_OPTIONS, NAI_UPSCALE_MODEL_OPTIONS } from "@/lib/nai-model-catalog";
import { isNaiMediumModel } from "@/lib/nai-native-request";
import { ReplicaPromptEditor, ReplicaPromptSettingsButton, useReplicaPromptConfig } from "./replica-prompt-editor";
import { ReplicaMedia } from "./replica-media";
import { ReplicaRightDock } from "./replica-right-dock";
import { ReplicaHistory, type ReplicaHistoryItem } from "./replica-history";
import { ReplicaNavigation, ReplicaGenerationFooter } from "./replica-shell";
import { SeedModeNotice } from "@/app/image/seed-mode-notice";
import { NotificationBell } from "@/app/notifications/notification-bell";
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
  DEFAULT_CUSTOM_LAYOUT,
  loadCustomLayout,
  saveCustomLayout,
  type CustomLayoutModule,
} from "@/lib/appearance-store";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
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
  loadEditorDraft,
  saveEditorDraft,
} from "@/lib/image-editor-store";
import { clearPersistentStudioSource, editorHistoryOperation, loadEditorHistoryNode, loadPersistentStudioSource, savePersistentStudioSource, type EditorHistoryReference } from "@/lib/image-editor-history";
import { recordStudioImageEdit } from "@/lib/image-editor-record";
import {
  dataUrlToBlob,
  deleteLocalImageHistory,
  findLocalImageHistory,
  listLocalImageHistory,
  readImageHistoryMode,
  saveLocalImageHistory,
  type ImageHistoryMode,
} from "@/lib/local-image-history";

type Props = { userName: string; userId?: number; authenticated: boolean; layoutEditor?: boolean };

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function clampPanel(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function createBrowserRequestId(prefix = "request"): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return `${prefix}-${values[0].toString(36)}-${values[1].toString(36)}-${values[2].toString(36)}-${values[3].toString(36)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

import {
  estimateNewApiCost,
  imageCreditCost,
  imagePricingStrength,
  officialNaiAnlasCost,
  splitImageCreditCost,
  usesLimitPricing,
  UPSCALE_MAX_PIXELS,
  upscaleBillingModel,
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
  dailyBilling?: DailyImageBillingState;
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
type ProviderSummary = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  protocol?: ImageProviderProtocol;
};
type AvailableModel = { id: string; kind?: string };
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
type Upload = { data: string; name: string } & EditorHistoryReference;
type GatewayImageCapacity = { total: number; v5: number; v45: number; anlas: number; v5_and_anlas: number; concurrency: number };
type SessionResult = ReplicaHistoryItem & EditorHistoryReference & {
  id: string;
  image: string;
  prompt: string;
  negative: string;
  seed?: number;
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: string;
  historyId?: string;
  requestId?: string;
  operation: Operation;
  createdAt: number;
};
// 多角色：每角色独立 prompt + 负向提示词 + 画面中心坐标（对齐 NAI Character Prompts）。
type CharacterPromptUi = {
  reference?: CharacterReferenceBinding;
  id: string;
  prompt: string;
  negative?: string;
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
  imageModel?: string;
  modelProtocol?: ImageProviderProtocol;
  promptStyle?: "tags" | "natural";
  goalComplete?: boolean;
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
type GoalAgentRun = { referenceImages?: string[]; id: string; goal: string; accessMode: "approval" | "full"; completedGenerations: number; maxGenerations: number; status: "running" | "complete" | "stopped" | "limit" | "needs-attention" };

// 持久化对话：历史轮次（新→旧）与跨轮次累积的标签池。
type ConversationTurnUi = {
  id: string;
  usage?: AssistantCallUsage[];
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

// 创作中心链接：完整侧栏与折叠图标栏（new-api 式 icon rail）共用。
// 图标按功能语义选择，图标栏下同名图标不能重复。
const CREATIVE_CENTER_LINKS: Array<{
  href: string;
  label: string;
  icon: React.ReactNode;
}> = [
  { href: "/stories", label: "故事工作台", icon: <BookOpen size={15} /> },
  { href: "/history", label: "图片历史", icon: <Images size={15} /> },
  { href: "/gallery", label: "图片广场", icon: <Globe size={15} /> },
  { href: "/usage", label: "使用记录", icon: <BarChart3 size={15} /> },
  { href: "/account", label: "我的账号", icon: <UserRound size={15} /> },
  { href: "/settings#models", label: "模型密钥", icon: <KeyRound size={15} /> },
  { href: "/announcements", label: "公告", icon: <Megaphone size={15} /> },
  { href: "/settings", label: "外观设置", icon: <Paintbrush size={15} /> },
];

// 模型名不做内置翻译，直接显示上游真实 ID。
const models: SelectOption[] = [...NAI_IMAGE_MODEL_OPTIONS];
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
  { id: "generate", label: "文生图" },
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
const SOURCE_REFRESH_TTL_MS = 5 * 60 * 1_000;
const POLICY_REFRESH_TTL_MS = 5 * 60 * 1_000;
const defaultPrompt =
  "masterpiece, best quality, 1girl, white hair, crimson eyes, intricate kimono, soft window light";
const defaultNegative = "lowres, bad anatomy, blurry, text, watermark";

type GenerationValidationInput = {
  imageModel?: string;
  imageProtocol?: ImageProviderProtocol;
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
  imageModel,
  imageProtocol,
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
  const natural = imageModel && resolveImageModelCapabilities(imageModel, imageProtocol).promptStyle === "natural";
  if (natural && (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 3840 || height > 3840)) return "输出宽高必须是 64–3840 之间的整数。";
  if (!natural) {
    const sizeError = naiImageSizeError(imageModel || "nai-v5-full", width, height);
    if (sizeError) return sizeError;
    if (isNaiLimitModel(imageModel || "") && steps > 28) return "Limit 模型最多支持 28 步。";
  }
  if (!natural && generationModes.has(operation) && officialNaiAnlasCost({
    model: imageModel || "nai-v5-full", width, height, steps, samples: 1, operation,
    strength: operation === "img2img" ? strength : undefined,
  }) > 140) return "这些设置的单张生成费超过 140 Anlas，请降低分辨率或步数。";
  if (!natural && (!Number.isInteger(steps) || steps < 1 || steps > 50))
    return "采样步数必须是 1–50 之间的整数。";
  if (!natural && (!Number.isFinite(scale) || scale < 0 || scale > 10))
    return "提示词相关性必须是 0–10 之间的有效数字。";
  if (!Number.isInteger(count) || count < 1 || count > MAX_NAI_IMAGE_COUNT)
    return `生成张数必须是 1-${MAX_NAI_IMAGE_COUNT} 之间的整数。`;
  if (!natural && (!Number.isFinite(cfgRescale) || cfgRescale < 0 || cfgRescale > 1))
    return "CFG 重缩放必须是 0–1 之间的有效数字。";
  if (!natural && (!Number.isFinite(strength) || strength < 0 || strength > 1))
    return "变化强度必须是 0–1 之间的有效数字。";
  const seedValue = seed.trim();
  if (
    !natural && seedValue &&
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

export default function ImageStudio({ userName, userId, authenticated, layoutEditor = false }: Props) {
  const { preferences, updatePreferences } = useAppearance();
  const [promptConfig, savePromptConfig] = useReplicaPromptConfig("nai");
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(layoutEditor);
  const [previousLayoutEditor, setPreviousLayoutEditor] = useState(layoutEditor);
  if (previousLayoutEditor !== layoutEditor) {
    setPreviousLayoutEditor(layoutEditor);
    setLayoutEditorOpen(layoutEditor);
  }
  const naiLayout = preferences.theme === "nai" && preferences.workspaceLayout !== "custom" && !layoutEditorOpen;
  const customWorkspace = layoutEditorOpen || (!naiLayout && preferences.workspaceLayout === "custom");
  const nlwLayout = !naiLayout && preferences.workspaceLayout === "nlw";
  const replicaLayout = naiLayout || nlwLayout;
  // 所有运行布局共用停靠栏；布局编辑器保留独立模块预览。
  const aaaliceDock = !layoutEditorOpen;
  const composedPromptLayout = replicaLayout || customWorkspace;
  const sidebarPromptLayout = replicaLayout || customWorkspace;
  const [operation, setOperation] = useState<Operation>("generate");
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [contentMode, setContentMode] = useState<"anime" | "furry">("anime");
  const [model, setModel] = useState(models[0].value);
  const generationModelBeforeInpaint = useRef<string | null>(null);
  const [modelPolicy, setModelPolicy] = useState<ModelPolicy>(DEFAULT_CLIENT_MODEL_POLICY);
  const [modelPolicyReady, setModelPolicyReady] = useState(false);
  const [providerId, setProviderId] = useState("newapi");
  const [newApiImageProtocol, setNewApiImageProtocol] = useState<ImageProviderProtocol>("auto");
  const [productMode, setProductMode] = useState<ImageProductMode>("nai");
  const [imageQuality, setImageQuality] = useState("auto");
  const [imageResolution, setImageResolution] = useState("1K");
  const [imageBackground, setImageBackground] = useState("auto");
  const [newApiModels, setNewApiModels] = useState<SelectOption[]>([]);
  const [newApiModelsLoaded, setNewApiModelsLoaded] = useState(false);
  const [customProviders, setCustomProviders] = useState<ProviderSummary[]>([]);
  const [customProviderModels, setCustomProviderModels] = useState<SelectOption[]>([]);
  const [novelAiConnected, setNovelAiConnected] = useState(false);
  const [width, setWidth] = useState(832);
  const [height, setHeight] = useState(1216);
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [count, setCount] = useState(1);
  // 生成张数提交方式：分批次（每个请求 n=1）或一次性（单请求 n 张）。
  const [batchMode, setBatchMode] = useState<"once" | "sequential">("sequential");
  const [batchProgress, setBatchProgress] = useState("");
  const [gatewayImageCapacity, setGatewayImageCapacity] = useState<GatewayImageCapacity | null>(null);
  const [gatewayImageCapacityChecked, setGatewayImageCapacityChecked] = useState(false);
  const [generationConfirmation, setGenerationConfirmation] = useState<string | null>(null);
  const generationInFlight = useRef(false);
  const generationAbortRef = useRef<AbortController | null>(null);
  const galleryUseRecorded = useRef(new Set<string>());
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
  const [effectivePrompts, setEffectivePrompts] = useState({ prompt: defaultPrompt, negative: defaultNegative });
  const [source, setSourceState] = useState<Upload | null>(null);
  const [redrawHistoryError, setRedrawHistoryError] = useState("");
  const sourceRevisionRef = useRef(0);
  const sourcePersistenceTaskRef = useRef<Promise<void>>(Promise.resolve());
  const [mask, setMask] = useState<Upload | null>(null);
  const [charactersEnabled, setCharactersEnabled] = useState(false);
  // AI 自动定位（Aaalice aiChoice）：开启时不发坐标（use_coords=false），
  // 角色位置由模型按提示词决定；关闭后用每角色滑块（use_coords=true）。
  const [aiAutoPosition, setAiAutoPosition] = useState(true);
  const [characters, setCharacters] = useState<CharacterPromptUi[]>([
    { id: "char-1", prompt: "", negative: "", centerX: 0.5, centerY: 0.5 },
  ]);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  // 提示词输入模式（借鉴 Aaalice）：tag 模式 = Danbooru 标签（逗号分隔），
  // 文本模式 = 自然语言描述。切换不转换文本，只影响提示与输入辅助。
  const [promptTagMode, setPromptTagMode] = useState(false);
  const [randomPromptLoading, setRandomPromptLoading] = useState(false);
  // 质量词 / UC 负面预设（移植 Aaalice 等级系统）：默认走 NAI 服务端
  // 行为（qualityToggle + ucPreset 0）；选轻量/无/自定义时改为本地注入。
  const [qualityTier, setQualityTier] = useState<QualityTier>("nai-default");
  const [ucType, setUcType] = useState<Exclude<UcPresetType, "custom"> | "custom">("heavy");
  const [customQuality, setCustomQuality] = useState("");
  const [customUc, setCustomUc] = useState("");
  const [promptPreferencesReady, setPromptPreferencesReady] = useState(false);
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
  const [upscaleModel, setUpscaleModel] = useState<string>(NAI_UPSCALE_MODEL_OPTIONS[0].value);
  const [upscaleSource, setUpscaleSource] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const setSource = useCallback((next: Upload | null) => {
    const revision = sourceRevisionRef.current + 1;
    sourceRevisionRef.current = revision;
    setSourceState(next);
    sourcePersistenceTaskRef.current = sourcePersistenceTaskRef.current
      .catch(() => undefined)
      .then(async () => {
        if (revision !== sourceRevisionRef.current) return;
        if (next) await savePersistentStudioSource(next);
        else await clearPersistentStudioSource();
      })
      .catch((error) => {
        if (revision === sourceRevisionRef.current)
          setNotice(`${error instanceof Error ? error.message : "无法持久化工作台源图"}；刷新后可能需要重新导入。`);
      });
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("editorResult") || params.has("galleryId") || params.has("historyId")) return;
    const revision = sourceRevisionRef.current;
    let active = true;
    void loadPersistentStudioSource()
      .then((saved) => {
        if (active && saved && sourceRevisionRef.current === revision) setSourceState(saved);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
  const [replicaGalleryOperation, setReplicaGalleryOperation] = useState<Operation>("img2img");
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const creditPricing = useCreditPricing();
  const [aff, setAff] = useState<Aff | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [previewDrafts, setPreviewDrafts] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [sessionHistory, setSessionHistory] = useStudioSessionHistory<SessionResult>(userId);
  const [imageHistoryMode, setImageHistoryMode] = useState<ImageHistoryMode>("account");
  // 最左侧功能导航栏（new-api/Aaalice 式）：折叠 = 纯图标 56px，展开 = 图标+文字。
  const [navRailExpanded, setNavRailExpanded] = useState(false);
  const modePickerRef = useRef<HTMLDivElement>(null);
  // VSCode 内联聊天（LFN 版）：选中文本→右键菜单→锚定对话框，Keep 替换所选内容。
  const [inlineChatMenu, setInlineChatMenu] = useState<{
    textarea: HTMLTextAreaElement;
    position: { x: number; y: number };
    anchor: { top: number; left: number; width: number };
    target: InlineChatTarget;
    selection: { start: number; end: number; text: string };
    contextBefore: string;
    contextAfter: string;
  } | null>(null);
  const [inlineChat, setInlineChat] = useState<InlineChatSession | null>(null);
  const customDockInteractionRevision = useRef(0);
  const [replicaDockCollapsed, setReplicaDockCollapsed] = useState(true);
  const [customDockExpansionRequest, setCustomDockExpansionRequest] = useState({ revision: 0, expanded: false });
  const [replicaAssistantOpenRequest, setReplicaAssistantOpenRequest] = useState(0);
  const [nlwLeftCollapsed, setNlwLeftCollapsed] = useState(false);
  // 多角色手动定位坐标系（画布叠加层）：拖动圆点更新 centerX/centerY。
  const positionOverlayRef = useRef<HTMLDivElement>(null);
  const [streamProgress, setStreamProgress] = useState("");
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);

  const [tagResults, setTagResults] = useState<DanbooruTag[]>([]);
  const [tagSearching, setTagSearching] = useState(false);
  const assistantSelection = useAssistantModels();
  const { model: assistantModel, providerId: assistantProviderId, group: assistantGroup, refresh: refreshAssistantModels } = assistantSelection;
  const [agentInput, setAgentInput] = useState("");
  const [assistantMode, setAssistantMode] = useState<"tags" | "goal">("tags");
  const [autonomyMode, setAutonomyMode] = useState<"approval" | "full">("approval");
  const [goalMaxRounds, setGoalMaxRounds] = useGoalRoundLimit();
  const assistantUsage = useAssistantUsage();
  const restoreAssistantUsage = assistantUsage.restore;
  const [goalRun, setGoalRun] = useState<GoalAgentRun | null>(null);
  const goalRunRef = useRef<GoalAgentRun | null>(null);
  const goalReviewImageRef = useRef<{ goalId: string; image: string } | null>(null);
  const autonomousGenerationRef = useRef(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [assistantTaskError, setAssistantTaskError] = useState("");
  // 随需求发给视觉模型的参考图（data URL）。
  const [agentImages, setAgentImages] = useState<string[]>([]);
  const agentImagesRef = useRef<string[]>([]);
  const agentImageUploadGeneration = useRef(0);
  const agentImageOwnerRef = useRef(authenticated && userId ? `assistant-assets:${userId}` : "assistant-assets:guest");
  const [agentImagesScope, setAgentImagesScope] = useState(authenticated && userId ? `assistant-assets:${userId}` : "assistant-assets:guest");
  const agentImage = agentImages[0] || null;
  const updateAgentImages = (images: string[]) => { agentImagesRef.current = images; setAgentImages(images); };
  const setAgentImage = (image: string | null) => { cancelAgentImageImport(); updateAgentImages(image ? [image] : []); };
  const [agentPreview, setAgentPreview] = useState<string | null>(null);
  const [agentImagesLoading, setAgentImagesLoading] = useState(false);
  const agentImageUploadQueue = useRef<Promise<void>>(Promise.resolve());
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantSuggestion, setAssistantSuggestion] =
    useState<AssistantSuggestion | null>(null);
  const sourcesRefreshedAt = useRef(0);
  const policyRefreshedAt = useRef(0);
  const policyRequestRef = useRef<Promise<void> | null>(null);
  const [conversation, setConversation] = useState<ConversationUi>({
    turns: [],
    tagPool: [],
  });
  const [modelPricing, setModelPricing] = useState<ModelPricingSnapshot | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantActiveRequestRef = useRef<Promise<unknown> | null>(null);
  const studioMountedRef = useRef(true);
  useEffect(() => {
    studioMountedRef.current = true;
    return () => {
      studioMountedRef.current = false;
      goalRunRef.current = null;
      assistantAbortRef.current?.abort("unmounted"); assistantActiveRequestRef.current = null;
      generationAbortRef.current?.abort(new DOMException("工作台已关闭", "AbortError"));
    };
  }, []);
  const assistantTimeoutRef = useRef<number | null>(null);
  const router = useRouter();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  usePanelHistory("lfnStudioImage", lightboxIndex === null ? null : String(lightboxIndex), next => setLightboxIndex(next === null ? null : Number(next)));
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const [classicLeftWidth, setClassicLeftWidth] = useState(310);
  const [naiLeftWidth, setNaiLeftWidth] = useState(447);
  const [nlwLeftWidth, setNlwLeftWidth] = useState(400);
  const [classicRightWidth, setClassicRightWidth] = useState(280);
  const [naiRightWidth, setNaiRightWidth] = useState(280);
  const [nlwRightWidth, setNlwRightWidth] = useState(280);
  const leftWidth = naiLayout ? naiLeftWidth : nlwLayout ? nlwLeftWidth : classicLeftWidth;
  const setLeftWidth = naiLayout ? setNaiLeftWidth : nlwLayout ? setNlwLeftWidth : setClassicLeftWidth;
  const rightWidth = naiLayout ? naiRightWidth : nlwLayout ? nlwRightWidth : classicRightWidth;
  const setRightWidth = naiLayout ? setNaiRightWidth : nlwLayout ? setNlwRightWidth : setClassicRightWidth;
  const [customLayout, setCustomLayout] = useState(() => structuredClone(DEFAULT_CUSTOM_LAYOUT));
  const historyEnabled = !customWorkspace || customLayout.visibleModules.history;
  const assistantEnabled = !customWorkspace || customLayout.visibleModules.agent;
  useEffect(() => {
    const syncMode = () => setImageHistoryMode(readImageHistoryMode());
    syncMode();
    window.addEventListener("lfn-image-history-mode", syncMode);
    return () => window.removeEventListener("lfn-image-history-mode", syncMode);
  }, []);
  useEffect(() => {
    if (imageHistoryMode === "none") return;
    const startedAt = Date.now();
    let active = true;
    const controller = new AbortController();
    void (async () => {
      const local = await listLocalImageHistory(Number.POSITIVE_INFINITY).catch(() => []);
      let restored: SessionResult[];
      if (imageHistoryMode === "account" && authenticated) {
        const response = await fetch("/api/history", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("历史加载失败，请重新进入或刷新重试。");
        const result = await response.json() as { items?: Array<{ id: string; imageUrl: string; createdAt: string; parameters: GenerationParameters }> };
        const remote = (result.items || []).map(remoteStudioHistory) as SessionResult[];
        // Account history is authoritative: do not resurrect deleted cloud copies.
        // Keep unsynced local results only when they belong to this account.
        const pending = local.filter(item => !item.remoteId && item.ownerId === userId)
          .map(item => localStudioHistory(item, URL.createObjectURL(item.image))) as SessionResult[];
        restored = mergeStudioHistory(remote, pending) as SessionResult[];
      } else {
        restored = local.filter(item => imageHistoryMode === "local" || item.ownerId === (userId ?? 0))
          .map(item => localStudioHistory(item, URL.createObjectURL(item.image))) as SessionResult[];
      }
      if (active) setSessionHistory(current => mergeStudioHistory(
        imageHistoryMode === "account" && authenticated
          ? current.filter(item => item.createdAt >= startedAt || !item.historyId || restored.some(saved => saved.historyId === item.historyId))
          : current.filter(item => item.createdAt >= startedAt || restored.some(saved => saved.id === item.id)), restored));
    })().catch(error => { if (active && error.name !== "AbortError") setNotice(error.message || "历史恢复失败，请重试。"); });
    return () => { active = false; controller.abort(); };
  }, [imageHistoryMode, authenticated, userId, setSessionHistory]);
  const [customPromptCollapsed, setCustomPromptCollapsed] = useState(false);
  const [customReferenceOpen, setCustomReferenceOpen] = useState(true);
  const [customDirectorOpen, setCustomDirectorOpen] = useState(false);
  const draggedModule = useRef<{ id: CustomLayoutModule; element: HTMLElement; startY: number; top: number; pointerY: number } | null>(null);
  const previousCardPositions = useRef<Map<CustomLayoutModule, number> | null>(null);
  const [formCacheReady, setFormCacheReady] = useState(false);
  const historyImportPending = useRef(false);
  const selectedProvider = customProviders.find((item) => item.id === providerId);
  const imageProtocol = providerId === "newapi" ? newApiImageProtocol : providerId === "novelai" ? "auto" : resolveProviderImageProtocol(selectedProvider?.protocol, selectedProvider?.baseUrl || "");
  const modelCapabilities = resolveImageModelCapabilities(model, imageProtocol);
  const modePickerOptions: Array<{ id: Operation; label: string; detail: string }> = [
    { id: "generate", label: "文生图", detail: "根据提示词生成图片。" },
    ...referenceOperations,
  ];
  const mediumEffort = isNaiMediumModel(model);
  const highEffortSettings = useRef<{ model: string; steps: number; sampler: string; cfgRescale: number; width: number; height: number; count: number } | null>(null);
  useEffect(() => {
    if (modelCapabilities.family !== "nai") return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const size = normalizeImageModelSize(model, width, height, imageProtocol);
      setWidth(size.width);
      setHeight(size.height);
      if (isNaiLimitModel(model)) setSteps((value) => Math.min(value, 28));
      if (mediumEffort) {
        setSteps(14); setSampler("k_euler_ancestral"); setCfgRescale(0);
      }
      if (!resolveImageModelCapabilities(model, imageProtocol).operations.includes(operation)) setOperation("generate");
    });
    return () => { active = false; };
  }, [mediumEffort, model, imageProtocol, operation, width, height, modelCapabilities.family]);
  useEffect(() => {
    if (!modePickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !modePickerRef.current?.contains(event.target)) {
        setModePickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModePickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modePickerOpen]);
  // 输出设置的门控能力：未选具体模型时（如刚切换接口）按接口的代表性模型
  // 展示与校验，否则用户的选择会因空模型能力列表被立即重置回默认值。
  const displayModel = model
    || (imageProtocol === "gemini" ? "nano-banana" : imageProtocol === "openai-images" ? "gpt-image-1.5" : "");
  const displayCaps = resolveImageModelCapabilities(displayModel, imageProtocol);
  const naturalImageModel = modelCapabilities.promptStyle === "natural";
  const outputCount = generationModes.has(operation) ? count : 1;
  const effectiveImageQuality = displayCaps.qualityOptions.includes(imageQuality) ? imageQuality : "auto";
  const effectiveImageResolution = displayCaps.imageSizes.includes(imageResolution) ? imageResolution : "1K";
  const naturalSettings = naturalImageModel ? <NaturalImageSettings model={model} imageProtocol={imageProtocol} width={width} height={height} setWidth={setWidth} setHeight={setHeight}
    quality={effectiveImageQuality} setQuality={setImageQuality} imageSize={effectiveImageResolution} setImageSize={setImageResolution} background={imageBackground} setBackground={setImageBackground} /> : undefined;
  useEffect(() => {
    assistantAbortRef.current?.abort("cancel");
    void Promise.resolve().then(() => { setAssistantSuggestion(null); setInlineChat(null); setInlineChatMenu(null); });
  }, [model, imageProtocol]);
  const providerOptions: SelectOption[] = [
    { value: "newapi", label: "NewAPI 账号" },
    ...(novelAiConnected ? [{ value: "novelai", label: "NovelAI 官方 Key" }] : []),
    ...customProviders.map((item) => ({ value: item.id, label: item.name })),
  ];
  // 模型只来自上游：NewAPI 列表按图像接口过滤；上游不可用时只保留 NAI 内置列表，
  // 不伪造 GPT/Gemini 模型 ID。
  const policyModelOptions = useMemo(() => filterNaiModelOptions(models, modelPolicy), [modelPolicy]);
  const allModelOptions = useMemo(() => providerId === "newapi"
    ? (newApiModelsLoaded ? filterNaiModelOptions(newApiModels, modelPolicy) : policyModelOptions)
    : providerId === "novelai"
      ? policyModelOptions.filter((item) => !item.value.endsWith("-limit"))
      : customProviderModels.length
        ? customProviderModels
        : (selectedProvider?.models || []).map((id) => ({ value: id, label: id })), [providerId, newApiModelsLoaded, newApiModels, policyModelOptions, modelPolicy, customProviderModels, selectedProvider]);
  const modelOptions = useMemo(() => allModelOptions.filter((item) => modelMatchesProductMode(item.value, productMode)), [allModelOptions, productMode]);
  const modelSelectionOptions = useMemo(
    () => modelOptions.filter((item) => !isNaiMediumModel(item.value)),
    [modelOptions],
  );
  const modelSelectionValue = isNaiMediumModel(model)
    ? model.replace(/-medium$/i, "")
    : model;
  // 模型被外部来源（历史复用、URL 参数、缓存）改变时，接口模式跟随模型。
  useEffect(() => {
    if (!model) return;
    const mode = imageProductMode(model);
    if (mode === productMode) return;
    void Promise.resolve().then(() => {
      setProductMode(mode);
      if (providerId === "newapi") setNewApiImageProtocol(productModeProtocol(mode));
    });
  }, [model, productMode, providerId]);
  useEffect(() => {
    if (!modelPolicyReady) return;
    const next = modelOptions[0]?.value;
    if (!next || modelOptions.some((item) => item.value === model)) return;
    void Promise.resolve().then(() => {
      setModel(next);
      if (providerId === "newapi") setNewApiImageProtocol(productModeProtocol(productMode));
    });
  }, [modelPolicyReady, modelOptions, model, providerId, productMode]);

  useLayoutEffect(() => {
    const previous = previousCardPositions.current;
    if (!previous) return;
    previousCardPositions.current = null;
    document.querySelectorAll<HTMLElement>("[data-layout-editor-board] [data-layout-module]").forEach((element) => {
      const id = element.dataset.layoutModule as CustomLayoutModule;
      const oldTop = previous.get(id);
      if (oldTop === undefined) return;
      if (draggedModule.current?.id === id) {
        const drag = draggedModule.current;
        const layoutTop = element.getBoundingClientRect().top - new DOMMatrixReadOnly(getComputedStyle(element).transform).m42;
        element.style.transform = `translateY(${drag.top + drag.pointerY - drag.startY - layoutTop}px)`;
      } else {
        const delta = oldTop - element.getBoundingClientRect().top;
        if (Math.abs(delta) > 1) element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(.2,.75,.3,1)" });
      }
    });
  }, [customLayout.moduleOrder]);

  function customModuleOrder(module: CustomLayoutModule) {
    return customLayout.moduleOrder.indexOf(module);
  }
  function customModuleStyle(module: CustomLayoutModule, collapsed = false): React.CSSProperties | undefined {
    if (!customWorkspace) return undefined;
    const rect = customLayout.modulePositions[module];
    return {
      display: customLayout.visibleModules[module] ? undefined : "none",
      order: customModuleOrder(module),
      minHeight: collapsed ? 0 : `${rect.height * 52}px`,
      width: `${customLayout.moduleWidths?.[module] ?? 100}%`,
      maxWidth: "100%",
      minWidth: 0,
      alignSelf: "flex-start",
    };
  }

  function updateLayoutModule(module: CustomLayoutModule, next: (typeof customLayout.modulePositions)[CustomLayoutModule]) {
    setCustomLayout((current) => ({ ...current, modulePositions: { ...current.modulePositions, [module]: next } }));
  }

  function moveLayoutModule(source: CustomLayoutModule, target: CustomLayoutModule) {
    if (source === target) return;
    previousCardPositions.current = new Map([...document.querySelectorAll<HTMLElement>("[data-layout-editor-board] [data-layout-module]")]
      .map((element) => [element.dataset.layoutModule as CustomLayoutModule, element.getBoundingClientRect().top]));
    setCustomLayout((current) => {
      const order = current.moduleOrder.filter((moduleId) => moduleId !== source);
      order.splice(order.indexOf(target), 0, source);
      return { ...current, moduleOrder: order };
    });
  }

  function startModuleDrag(event: React.PointerEvent<HTMLButtonElement>, source: CustomLayoutModule) {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget.closest<HTMLElement>("[data-layout-module]");
    if (!element) return;
    draggedModule.current = { id: source, element, startY: event.clientY, top: element.getBoundingClientRect().top, pointerY: event.clientY };
    element.classList.add("is-dragging");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueModuleDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = draggedModule.current;
    if (!drag) return;
    drag.pointerY = event.clientY;
    const layoutTop = drag.element.getBoundingClientRect().top - new DOMMatrixReadOnly(getComputedStyle(drag.element).transform).m42;
    drag.element.style.transform = `translateY(${drag.top + drag.pointerY - drag.startY - layoutTop}px)`;
    const siblings = [...drag.element.parentElement!.querySelectorAll<HTMLElement>(":scope > [data-layout-module]")]
      .filter((element) => element !== drag.element && getComputedStyle(element).display !== "none");
    const target = siblings.find((element) => {
      const rect = element.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (target?.dataset.layoutModule && target.dataset.layoutModule !== drag.id) {
      const from = customLayout.moduleOrder.indexOf(drag.id);
      const to = customLayout.moduleOrder.indexOf(target.dataset.layoutModule as CustomLayoutModule);
      if ((to < from && event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2) ||
          (to > from && event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2)) {
        moveLayoutModule(drag.id, target.dataset.layoutModule as CustomLayoutModule);
      }
    }
  }

  function finishModuleDrag() {
    const drag = draggedModule.current;
    draggedModule.current = null;
    if (!drag) return;
    drag.element.classList.remove("is-dragging");
    drag.element.style.transform = "";
  }

  function toggleLayoutModule(moduleId: CustomLayoutModule) {
    setCustomLayout((current) => ({ ...current, visibleModules: { ...current.visibleModules, [moduleId]: !current.visibleModules[moduleId] } }));
  }

  function layoutModuleTools(moduleId: CustomLayoutModule) {
    if (!layoutEditorOpen) return null;
    const height = customLayout.modulePositions[moduleId].height;
    return <div className="layout-module-tools" aria-label={`${moduleId} 布局操作`}>
      <button type="button" data-layout-drag={moduleId} onPointerDown={(event) => startModuleDrag(event, moduleId)} onPointerMove={continueModuleDrag} onPointerUp={finishModuleDrag} onPointerCancel={finishModuleDrag} aria-label={`拖动${moduleId}`} title="拖动调整顺序" className="layout-module-drag"><Move size={15} /></button>
      <span>{moduleId}</span>
      <button type="button" aria-label={`上移${moduleId}`} title="上移模块" onClick={() => { const index = customLayout.moduleOrder.indexOf(moduleId); if (index > 0) moveLayoutModule(moduleId, customLayout.moduleOrder[index - 1]); }}>↑</button>
      <button type="button" aria-label={`下移${moduleId}`} title="下移模块" onClick={() => { const index = customLayout.moduleOrder.indexOf(moduleId); if (index < customLayout.moduleOrder.length - 1) moveLayoutModule(customLayout.moduleOrder[index + 1], moduleId); }}>↓</button>
      <button type="button" aria-label={`缩小${moduleId}`} title="缩小模块" disabled={height <= 1} onClick={() => updateLayoutModule(moduleId, { ...customLayout.modulePositions[moduleId], height: height - 1 })}>−</button>
      <button type="button" aria-label={`放大${moduleId}`} title="放大模块" disabled={height >= 4} onClick={() => updateLayoutModule(moduleId, { ...customLayout.modulePositions[moduleId], height: height + 1 })}>+</button>
      <button type="button" aria-label={`隐藏${moduleId}`} title="隐藏模块" onClick={() => toggleLayoutModule(moduleId)}><Eye size={14} /></button>
    </div>;
  }

  function restoreCharacterParameters(parameters: Record<string, unknown>, resetMissing = false) {
    if (!resetMissing && !hasImageCharacterPrompts(parameters)) return;
    const imported = readImageCharacterPrompts(parameters);
    setCharactersEnabled(imported.length > 0);
    setCharacters(imported.length ? imported.map((character, index) => ({
      id: `import-${Date.now()}-${index}`, prompt: character.prompt, negative: character.negativePrompt,
      centerX: character.center.x, centerY: character.center.y,
    })) : [{ id: "c1", prompt: "", negative: "", centerX: .5, centerY: .5 }]);
    const useCoords = imageCharacterUseCoords(parameters);
    if (useCoords !== undefined) setAiAutoPosition(!useCoords);
  }

  function restoreGenerationParameters(parameters: GenerationParameters) {
    restoreCharacterParameters(parameters);
    const metadata = parseImageHistoryMetadata(parameters);
    if (metadata.providerId) setProviderId(metadata.providerId);
    if (metadata.imageProtocol) setNewApiImageProtocol(metadata.imageProtocol);
    if (metadata.quality) setImageQuality(metadata.quality);
    if (metadata.imageSize) setImageResolution(metadata.imageSize);
    if (metadata.background) setImageBackground(metadata.background);
    const targetModel = parameters.model || model;
    const targetProtocol = metadata.imageProtocol || imageProtocol;
    const caps = resolveImageModelCapabilities(targetModel, targetProtocol);
    if (parameters.model) setModel(parameters.model);
    if (typeof parameters.prompt === "string") setPrompt(parameters.prompt);
    if (typeof parameters.negative_prompt === "string") setNegative(parameters.negative_prompt);
    if (parameters.width && parameters.height) {
      const size = normalizeImageModelSize(targetModel, parameters.width, parameters.height, targetProtocol);
      setWidth(size.width); setHeight(size.height);
    }
    if (caps.sampling) {
      if (typeof parameters.steps === "number") setSteps(parameters.steps);
      if (typeof parameters.scale === "number") setScale(parameters.scale);
      if (parameters.sampler) setSampler(parameters.sampler);
      if (parameters.noise_schedule) setSchedule(parameters.noise_schedule);
      if (typeof parameters.strength === "number") setStrength(parameters.strength);
    }
    if (caps.seed) setSeed(parameters.seed == null || parameters.seed === 0 ? "" : String(parameters.seed));
  }

  async function addSessionResults(nextImages: string[], historyIds: string[] = [], sourceOperation = operation, settings: Partial<Omit<ReplicaHistoryItem, "operation">> & EditorHistoryReference = {}, requestIds: string[] = [], originGoalId?: string) {
    if (!nextImages.length || sourceOperation === "suggest-tags") return;
    const now = Date.now();
    const results: SessionResult[] = nextImages.map((image, index) => ({
        id: `${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        image,
        historyId: historyIds[index] || undefined,
        requestId: requestIds[index] || undefined,
        prompt: composedPromptLayout ? effectivePrompts.prompt : prompt,
        negative: composedPromptLayout ? effectivePrompts.negative : negative,
        seed: seed ? Number(seed) : undefined, width, height, steps, scale, sampler, noise_schedule: schedule,
        model, providerId, imageProtocol, quality: effectiveImageQuality, imageSize: effectiveImageResolution, background: imageBackground,
        characterPrompts: ["generate", "img2img", "inpainting"].includes(sourceOperation) && modelCapabilities.characters && charactersEnabled
          ? readImageCharacterPrompts({ characterPrompts: characters.filter(character => character.prompt.trim()).map(character => ({ prompt: character.prompt, negativePrompt: mediumEffort ? "" : character.negative || "", center: { x: character.centerX, y: character.centerY } })) }) : [],
        use_coords: !aiAutoPosition,
        operation: sourceOperation,
        createdAt: now + index,
        ...settings,
      }));
    setSessionHistory((current) => [
      ...results,
      ...current,
    ]);
    for (const item of results) void loadImageElement(item.image).then(decoded => {
      setSessionHistory(current => current.map(saved => saved.id === item.id ? { ...saved, width: decoded.naturalWidth, height: decoded.naturalHeight } : saved));
    }).catch(() => undefined);
    if (imageHistoryMode !== "none") {
      void Promise.all(results.map(async (item) => {
        try {
          await saveLocalImageHistory({
            id: item.id,
            ownerId: userId ?? 0,
            remoteId: item.historyId,
            requestId: item.requestId,
            createdAt: item.createdAt,
            image: await dataUrlToBlob(item.image),
            prompt: item.prompt,
            negative: item.negative,
            model: item.model,
            operation: item.operation,
            parameters: { prompt: item.prompt, negative_prompt: item.negative, characterPrompts: item.characterPrompts, use_coords: item.use_coords, providerId: item.providerId, imageProtocol: item.imageProtocol, width: item.width, height: item.height, steps: item.steps, scale: item.scale, sampler: item.sampler, noise_schedule: item.noise_schedule, seed: item.seed },
          });
        } catch {
          setNotice("图片已生成，但浏览器无法保存本地历史；请检查存储空间或权限。");
        }
      }));
    }
    const editOperation = editorHistoryOperation(sourceOperation);
    if (editOperation && !settings.editorDraftId) {
      const failures = await Promise.all(results.map(async (item) => {
        try {
          const reference = await recordStudioImageEdit({
            image: item.image, sourceImage: source?.data, name: source?.name,
            editorDraftId: source?.editorDraftId, editorNodeId: source?.editorNodeId, editorBranchId: source?.editorBranchId,
            operation: editOperation, prompt: item.prompt, negative: item.negative,
            generation: { model: item.model, providerId: item.providerId, imageProtocol: item.imageProtocol, quality: item.quality, imageSize: item.imageSize, background: item.background, width: item.width, height: item.height, steps: item.steps, scale: item.scale, sampler: item.sampler, noiseSchedule: item.noise_schedule, strength },
            recordId: item.id, createdAt: item.createdAt,
          });
          setSessionHistory((current) => current.map((saved) => saved.id === item.id ? { ...saved, ...reference } : saved));
          return "";
        } catch (error) {
          return `图像已完成，但重绘历史保存失败：${error instanceof Error ? error.message : "浏览器存储不可用"}。请先下载结果。`;
        }
      }));
      setRedrawHistoryError(failures.find(Boolean) || "");
    }
    if (originGoalId && goalRunRef.current?.id === originGoalId && goalRunRef.current?.status === "running")
      goalReviewImageRef.current = results.at(-1)?.image ? { goalId: originGoalId, image: results.at(-1)!.image } : null;
  }

  async function openImageEditor(mode: "inpaint" | "canvas", image = source?.data, character?: CharacterPromptUi) {
    if (!image && mode === "canvas") {
      const blank = document.createElement("canvas");
      blank.width = width; blank.height = height;
      const context = blank.getContext("2d");
      if (!context) { setNotice("当前浏览器不支持 Canvas"); return; }
      context.fillStyle = "white"; context.fillRect(0, 0, width, height);
      image = blank.toDataURL("image/png");
    }
    if (!image) { setNotice("请先导入或生成一张图片。"); return; }
    try {
      if (character) {
        if (!signedIn || !userId || character.reference?.owner !== String(userId)) throw new Error("请登录保存此参考图的账号后重试。");
        if (!supportsCharacterReferenceEdit(model, imageProtocol)) throw new Error("角色参考重绘需要支持精准参考的 NAI V4.5 / V5 非 Medium 模型。");
        if (!await readReferenceAsset(String(userId), character.reference.assetId)) throw new Error("角色参考图已从本机图库移除，请重新选择。");
      }
      if (!character && source?.editorDraftId && image === source.data) {
        if (source.editorNodeId && await loadEditorHistoryNode(source.editorNodeId)) {
          router.push(`/image/editor?${new URLSearchParams({ draftId: source.editorDraftId, nodeId: source.editorNodeId, branchId: source.editorBranchId || "", mode }).toString()}`);
          return;
        }
        const savedDraft = await loadEditorDraft(source.editorDraftId).catch(() => null);
        if (savedDraft) {
          router.push(`/image/editor?draftId=${encodeURIComponent(source.editorDraftId)}&mode=${mode}`);
          return;
        }
      }
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
          prompt: character ? character.prompt : prompt,
          negativePrompt: character ? character.negative || "" : negative,
          ...(character?.reference ? { characterReference: { ...character.reference, label: `角色 ${characters.findIndex(item => item.id === character.id) + 1}` } } : {}),
          seed: seed || null,
          source: { name: source?.name || "工作区图片.png", mimeType: "image/png" },
          generation: { model, providerId, imageProtocol, quality: effectiveImageQuality, imageSize: effectiveImageResolution, background: imageBackground, width, height, steps, scale, strength, sampler, noiseSchedule: schedule },
        },
      );
      const random = new Uint32Array(2);
      crypto.getRandomValues(random);
      const draftId = `editor-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
      if (!character) syncEditorPromptToStudioForm(draftId, prompt, negative);
      await saveEditorDraft(createEditorDraft(draftId, mode, editorDocument));
      if (!character && source && image === source.data) {
        setSource({ ...source, editorDraftId: draftId, editorNodeId: undefined, editorBranchId: undefined });
        await sourcePersistenceTaskRef.current;
      }
      router.push(`/image/editor?draftId=${encodeURIComponent(draftId)}&mode=${mode}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法打开图像编辑器");
    }
  }

  function applyImageAsSource(image: string, nextOperation: Operation = "img2img") {
    if (nextOperation !== "suggest-tags" && !modelCapabilities.operations.includes(nextOperation)) {
      setNotice("当前模型不支持这个操作，请先选择支持图像编辑的模型。");
      return;
    }
    if (nextOperation === "vibe-transfer" || nextOperation === "precise-reference") imageReferences.add(nextOperation, { id: crypto.randomUUID(), data: image, name: "工作区图片.png", createdAt: Date.now() });
    const saved = sessionHistory.find((item) => item.image === image);
    setSource({ data: image, name: "工作区图片.png", editorDraftId: saved?.editorDraftId, editorNodeId: saved?.editorNodeId, editorBranchId: saved?.editorBranchId });
    setMask(null);
    setUpscaleSource(null);
    if (nextOperation === "inpainting" || nextOperation === "edits") {
      const inpaintModel = inpaintModelFor(model, imageProtocol);
      if (inpaintModel && inpaintModel !== model && modelOptions.some((item) => item.value === inpaintModel)) { generationModelBeforeInpaint.current = model; setModel(inpaintModel); }
    }
    setOperation(nextOperation);
    setSelectedImageIndex(0);
    setNotice("已将当前图片载入工作台。");
  }

  function selectOperation(nextOperation: Operation) {
    if (nextOperation !== "suggest-tags" && !modelCapabilities.operations.includes(nextOperation)) { setNotice("当前模型没有这个图像能力，请选择支持编辑的模型。"); return; }
    if (nextOperation !== "generate" && !source && images[0]) {
      applyImageAsSource(images[0], nextOperation);
      return;
    }
    // Base-only NewAPI catalogs use the native request's infill mapping.
    if (nextOperation === "inpainting" || nextOperation === "edits") {
      const inpaintModel = inpaintModelFor(model, imageProtocol);
      if (inpaintModel && inpaintModel !== model && modelOptions.some((item) => item.value === inpaintModel)) { generationModelBeforeInpaint.current = model; setModel(inpaintModel); }
    } else if (nextOperation === "generate" || nextOperation === "img2img") {
      const baseModel = generationModelFor(model);
      if (baseModel !== model) {
        const previous = generationModelBeforeInpaint.current;
        setModel(previous && inpaintModelFor(previous, imageProtocol) === model ? previous : baseModel);
      }
      generationModelBeforeInpaint.current = null;
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
    if (!modelCapabilities.edit) {
      setNotice("当前模型不支持重绘，请选择支持图像编辑的模型。");
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
      const inpaintModel = inpaintModelFor(model, imageProtocol);
      if (!inpaintModel) throw new Error(`当前模型 ${model} 没有对应的重绘模型，请先选择支持重绘的模型。`);
      const response = await fetch("/api/images/operate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "inpainting",
          providerId,
          editor_composite: true,
          imageProtocol,
          quality: effectiveImageQuality,
          imageSize: effectiveImageResolution,
          background: imageBackground,
          model: inpaintModel,
          prompt: composedPromptLayout ? effectivePrompts.prompt : prompt,
          negative_prompt: mediumEffort ? "" : composedPromptLayout ? effectivePrompts.negative : negative,
          ...(mediumEffort ? { ucPreset: 0, tag_hint_uc_preset: 2 } : composedPromptLayout ? { qualityToggle: false, ucPreset: 3 } : {}),
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
      if (contentType.includes("text/event-stream") && response.body) {
        const streamed = await consumeImageStream(response, {
          expected: 1,
          onPreview: (next) => setPreviewDrafts(next),
          onProgress: setStreamProgress,
        });
        patchImage = streamed[0] || "";
      } else {
        const result = await readImageOperationResponse(response);
        if (!response.ok) throw new Error(result.message || "精确重绘失败");
        patchImage = result.images?.[0] || result.image || "";
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

      setSource({ data: finalImage, name: "精确重绘结果.png" });
      setMask(null);
      setMaskEditorOpen(false);
      let historyId: string | undefined;
      let historyError = "";
      try {
        if (imageHistoryMode === "account") {
          historyId = await saveEditorComposite({
            image: finalImage, model: inpaintModel, prompt, negative_prompt: negative,
            providerId, imageProtocol, quality: effectiveImageQuality, imageSize: effectiveImageResolution, background: imageBackground,
            width: imageSize.width, height: imageSize.height, steps, scale, sampler, strength,
          });
        }
      } catch (error) {
        historyError = error instanceof Error ? error.message : "历史保存失败";
      }
      // Session persistence saves the owned local copy once for either mode.
      await addSessionResults([finalImage], historyId ? [historyId] : [], "inpainting", { model: inpaintModel, width: imageSize.width, height: imageSize.height });
      setNotice(historyError
        ? `精确重绘已完成，但${historyError}。完整图片已保留在工作台，请及时下载。`
        : imageHistoryMode === "none"
          ? "精确重绘完成，未保存图片历史。"
          : imageHistoryMode === "local"
            ? "精确重绘完成，完整合成图已保存到本机历史。"
            : "精确重绘完成，完整合成图已保存到图片历史。" );
      await refreshWallet();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "精确重绘失败");
    } finally {
      setGenerating(false);
    }
  }

  function openAssistantPanel() {
    if (customWorkspace && !customLayout.visibleModules.agent) {
      setNotice("标签助手模块已关闭，可在布局设置中启用。");
      return;
    }
    setReplicaAssistantOpenRequest(value => value + 1);
    if (signedIn) void refreshAssistantModels(new AbortController().signal);
  }

  // Clipboard actions also work with a caret and without an authenticated AI session.
  function openInlineChatMenu(
    event: React.MouseEvent<HTMLTextAreaElement>,
    target: InlineChatTarget,
  ) {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    event.preventDefault();
    const rect = textarea.getBoundingClientRect();
    setInlineChatMenu({
      textarea,
      position: { x: event.clientX, y: event.clientY },
      anchor: {
        top: rect.bottom + 6,
        left: rect.left,
        width: Math.max(rect.width, 280),
      },
      target,
      selection: { start, end, text: textarea.value.slice(start, end) },
      contextBefore: textarea.value.slice(Math.max(0, start - 200), start),
      contextAfter: textarea.value.slice(end, end + 200),
    });
  }

  function pickInlineChatMenuItem(item: InlineChatMenuItem) {
    if (!inlineChatMenu || !signedIn || !inlineChatMenu.selection.text) return;
    const menu = inlineChatMenu;
    setInlineChatMenu(null);
    setInlineChat({
      target: menu.target,
      anchor: menu.anchor,
      selection: menu.selection,
      contextBefore: menu.contextBefore,
      contextAfter: menu.contextAfter,
      mode: item.id,
      autoSend: item.autoSend,
    });
  }

  function keepInlineChatResult(text: string) {
    const session = inlineChat;
    if (!session) return;
    replaceInlineSelection(session.target,session.selection,text);
  }

  function replaceInlineSelection(target: InlineChatTarget, selection: {start:number;end:number}, text: string) {
    const { start, end } = selection;
    const apply = (value: string) => value.slice(0, start) + text + value.slice(end);
    if (target.kind === "prompt") setPrompt(apply);
    else if (target.kind === "negative") setNegative(apply);
    else if (target.characterId)
      setCharacters((current) =>
        current.map((item) =>
          item.id === target.characterId
            ? target.kind === "character"
              ? { ...item, prompt: apply(item.prompt) }
              : { ...item, negative: apply(item.negative || "") }
            : item,
        ),
      );
  }

  async function copyInlineSelection() {
    const menu=inlineChatMenu;if(!menu?.selection.text)return;
    setInlineChatMenu(null);
    try {await copyTextToClipboard(menu.selection.text);setNotice("已复制所选内容");}
    catch(error){setNotice(error instanceof Error?error.message:"复制失败");}
    menu.textarea.focus({preventScroll:true});
    menu.textarea.setSelectionRange(menu.selection.start,menu.selection.end);
  }

  async function pasteInlineSelection() {
    const menu=inlineChatMenu;if(!menu)return;
    setInlineChatMenu(null);
    let text:string|null=null;
    if(navigator.clipboard?.readText) {
      try {text=await navigator.clipboard.readText();}catch { /* HTTP/permission fallback uses the LFN dialog */ }
    }
    if(text===null)text=await lfnPrompt("在下方粘贴文本（Ctrl+V / 手机长按粘贴），确认后写入当前光标或替换所选内容。","",{title:"粘贴文本",multiline:true});
    if(text===null || text.length===0)return;
    replaceInlineSelection(menu.target,menu.selection,text);
    const caret=menu.selection.start+text.length;
    requestAnimationFrame(()=>{if(menu.textarea.isConnected){menu.textarea.focus({preventScroll:true});menu.textarea.setSelectionRange(caret,caret);}});
    setNotice("已粘贴文本");
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
    if (new URLSearchParams(window.location.search).has("historyId")) {
      historyImportPending.current = true;
      const ready = window.setTimeout(() => setFormCacheReady(true), 0);
      return () => window.clearTimeout(ready);
    }
    const timer = window.setTimeout(() => {
      const saved = loadImageStudioForm();
      setOperation(saved.operation as Operation);
      setContentMode(saved.contentMode);
      setProviderId(saved.providerId);
      setModel(saved.model);
      setNewApiImageProtocol(saved.imageProtocol || "auto");
      setImageQuality(saved.imageQuality || "auto");
      setImageResolution(saved.imageResolution || "1K");
      setImageBackground(saved.imageBackground || "auto");
      setWidth(saved.width);
      setHeight(saved.height);
      setSteps(saved.steps);
      setScale(saved.scale);
      // 数量与提交方式会直接影响扣费，每次打开工作台都从单张开始。
      setCount(1);
      setBatchMode("sequential");
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
        negative: character.negative ?? "",
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
        providerId,
        model,
        imageProtocol: newApiImageProtocol,
        imageQuality,
        imageResolution,
        imageBackground,
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
        characters: characters.map(({ prompt: characterPrompt, negative: characterNegative, centerX, centerY, reference }) => ({
          prompt: characterPrompt,
          ...(characterNegative ? { negative: characterNegative } : {}),
          ...(reference ? { reference } : {}),
          centerX,
          centerY,
        })),
      };
      // Keep the rest of the form persistent while provider discovery is in
      // flight, but never write a model that is not currently selectable.
      saveImageStudioForm(snapshot, {
        validModelIds: modelOptions.length ? modelOptions.map((item) => item.value) : undefined,
      });
    }, 180);
    return () => window.clearTimeout(timer);
    }, [
    formCacheReady, operation, contentMode, providerId, model, modelOptions, prompt, negative, width, height,

    newApiImageProtocol, imageQuality, imageResolution, imageBackground,
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
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as Element).closest?.(".rgs-panel, [data-replica-menu]")) return;
      event.preventDefault();
      setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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
      if (parsed.right) setClassicRightWidth(clampPanel(parsed.right, 200, 460));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 左侧功能导航栏展开/折叠记忆。
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (window.localStorage.getItem("lfn-nav-rail-expanded") === "1") setNavRailExpanded(true);
      if (window.localStorage.getItem("lfn-prompt-tag-mode") === "1") setPromptTagMode(true);
      const savedQuality = window.localStorage.getItem("lfn-quality-tier");
      if (savedQuality) setQualityTier(savedQuality as QualityTier);
      const savedUc = window.localStorage.getItem("lfn-uc-type");
      if (savedUc) setUcType(savedUc as typeof ucType);
      const savedCustomQuality = window.localStorage.getItem("lfn-quality-custom");
      if (savedCustomQuality) setCustomQuality(savedCustomQuality);
      const savedCustomUc = window.localStorage.getItem("lfn-uc-custom");
      if (savedCustomUc) setCustomUc(savedCustomUc);
      setPromptPreferencesReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!promptPreferencesReady) return;
    window.localStorage.setItem("lfn-prompt-tag-mode", promptTagMode ? "1" : "0");
    window.localStorage.setItem("lfn-quality-tier", qualityTier);
    window.localStorage.setItem("lfn-uc-type", ucType);
  }, [promptTagMode, qualityTier, ucType, promptPreferencesReady]);

  async function rollRandomPrompt() {
    if (randomPromptLoading) return;
    setRandomPromptLoading(true);
    try {
      const generated = await generateRandomPrompt();
      if (generated) setPrompt(generated);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "随机提示词生成失败");
    } finally {
      setRandomPromptLoading(false);
    }
  }

  useEffect(() => {
    if (naiLayout || (!layoutEditorOpen && preferences.workspaceLayout !== "custom")) return;
    const saved = loadCustomLayout();
    const interactionRevision = customDockInteractionRevision.current;
    const timer = window.setTimeout(() => {
      setCustomLayout(saved);
      setClassicLeftWidth(clampPanel(saved.leftWidth, 240, 520));
      setClassicRightWidth(clampPanel(saved.rightWidth, 200, 460));
      if (!layoutEditorOpen && customDockInteractionRevision.current === interactionRevision) setCustomDockExpansionRequest(current => ({ revision: current.revision + 1, expanded: !saved.rightCollapsed }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [layoutEditorOpen, naiLayout, preferences.workspaceLayout]);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem("lfn-nai-left-width"));
    const savedRight = Number(window.localStorage.getItem("lfn-nai-right-width"));
    if (!saved && !savedRight) return;
    const timer = window.setTimeout(() => {
      if (saved) setNaiLeftWidth(clampPanel(saved, 320, 560));
      if (savedRight) setNaiRightWidth(clampPanel(savedRight, 200, 520));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("lfn-nlw-panel-widths") || "null") as { left?: number; right?: number } | null;
      if (!saved) return;
      const timer = window.setTimeout(() => {
        if (saved.left) setNlwLeftWidth(clampPanel(saved.left, 320, 560));
        if (saved.right) setNlwRightWidth(clampPanel(saved.right, 200, 520));
      }, 0);
      return () => window.clearTimeout(timer);
    } catch { /* Invalid panel preferences fall back to their defaults. */ }
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
    if (naiLayout) {
      window.localStorage.setItem("lfn-nai-left-width", String(left));
      window.localStorage.setItem("lfn-nai-right-width", String(right));
    }
    else if (nlwLayout) window.localStorage.setItem("lfn-nlw-panel-widths", JSON.stringify({ left, right }));
    else window.localStorage.setItem("lfn-layout", JSON.stringify({ left, right }));
    if (customWorkspace) {
      const nextLayout = { ...customLayout, leftWidth: left, rightWidth: right };
      setCustomLayout(layoutEditorOpen ? nextLayout : saveCustomLayout(nextLayout));
    }
  }

  // side="right" 调右侧面板宽度。拖拽不再强制展开面板：折叠状态下也只调宽度。
  // 画布坐标系拖拽：以叠加层为界，指针位置归一化为 0–1 坐标。
  function startCharacterDrag(event: React.PointerEvent, characterId: string): void {
    event.preventDefault();
    const overlay = positionOverlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const x = Math.min(1, Math.max(0, (pointer.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (pointer.clientY - rect.top) / rect.height));
      setCharacters((current) =>
        current.map((item) =>
          item.id === characterId ? { ...item, centerX: x, centerY: y } : item,
        ),
      );
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.body.style.userSelect = "";
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.body.style.userSelect = "none";
  }

  function rightPanelMaxWidth() {
    const navigationWidth = nlwLayout ? 60 : naiLayout || layoutEditorOpen ? 0 : navRailExpanded ? 220 : 56;
    const controlsWidth = nlwLayout && nlwLeftCollapsed ? 40 : leftWidth;
    return Math.max(200, Math.min(replicaLayout ? 520 : 460, window.innerWidth - controlsWidth - navigationWidth - 236));
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
        latestLeft = clampPanel(startLeft + delta, replicaLayout ? 320 : 240, replicaLayout ? 560 : 520);
        setLeftWidth(latestLeft);
      } else {
        latestRight = clampPanel(startRight - delta, 200, rightPanelMaxWidth());
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
    const min = side === "left" ? replicaLayout ? 320 : 240 : 200;
    const max = side === "left" ? replicaLayout ? 560 : 520 : rightPanelMaxWidth();
    const bounds = { min, max };
    let next = current;
    if (event.key === "ArrowLeft") next = current - 16;
    if (event.key === "ArrowRight") next = current + 16;
    if (event.key === "Home") next = bounds.min;
    if (event.key === "End") next = bounds.max;
    if (next === current) return;
    event.preventDefault();
    next = clampPanel(next, bounds.min, bounds.max);
    if (side === "left") setLeftWidth(next);
    else setRightWidth(next);
    savePanelWidths(side === "left" ? next : leftWidth, side === "right" ? next : rightWidth);
  }

  // 服务端 prop 只是初值，会话可能在页面存活期间失效。
  const [sessionValid, setSessionValid] = useState(authenticated);
  const signedIn = authenticated && sessionValid;
  const assistantResourceScope = signedIn && userId ? `assistant-assets:${userId}` : "assistant-assets:guest";
  const assistantImageSources = useAssistantImageSources(assistantResourceScope, handleAgentImageFiles, setNotice);
  const cancelAssistantSourceImports = assistantImageSources.cancel;
  useLayoutEffect(() => {
    if (agentImageOwnerRef.current === assistantResourceScope) return;
    agentImageOwnerRef.current = assistantResourceScope; agentImageUploadGeneration.current++; agentImageUploadQueue.current = Promise.resolve(); cancelAssistantSourceImports(false);
    const generation = agentImageUploadGeneration.current;
    void Promise.resolve().then(() => { if (agentImageUploadGeneration.current === generation) { updateAgentImages([]); setAgentImagesScope(assistantResourceScope); setAgentImagesLoading(false); } });
  }, [assistantResourceScope, cancelAssistantSourceImports]);
  const metadataRestore = useMetadataRestorePreferences();
  const imageQueueScope = signedIn && userId ? `image:${userId}` : "image:guest";
  const imageOperationQueue = useOperationQueue(imageQueueScope, 10);
  const imageActiveRequestRef = useRef<Promise<void> | null>(null);
  const queuedGenerationApprovalRef = useRef<(() => void) | null>(null);
  const imageOwnerRef = useRef(imageQueueScope);
  useEffect(() => { imageOwnerRef.current = imageQueueScope; queuedGenerationApprovalRef.current = null; }, [imageQueueScope]);
  const [previewFrozen, setPreviewFrozen] = useState(false);
  const [frozenPreviewImages, setFrozenPreviewImages] = useState<string[]>([]);
  const incomingPreviewImages = images.length ? images : previewDrafts;
  const displayedImages = previewFrozen ? frozenPreviewImages : incomingPreviewImages;
  const [comicDestination, setComicDestination] = useState<{ projectId: string; panelId: string } | null>(null);
  const imageReferences = useImageReferences(signedIn && userId ? String(userId) : "guest", model, setNotice);
  function renderCharacterReference(character: CharacterPromptUi) {
    const image = displayedImages[Math.max(0, selectedImageIndex - 1)] || source?.data;
    const supported = supportsCharacterReferenceEdit(model, imageProtocol);
    return <CharacterReferenceField owner={signedIn && userId ? String(userId) : "guest"} value={character.reference}
      onChange={reference => setCharacters(current => current.map(item => item.id === character.id ? { ...item, reference } : item))}
      onEdit={() => void openImageEditor("inpaint", image, character)}
      canEdit={Boolean(signedIn && userId && image && supported && character.prompt.trim())}
      editHint={!signedIn ? "登录后可进行角色参考重绘。" : !supported ? "请选择支持精准参考的 NAI V4.5 / V5 非 Medium 模型。" : !image ? "请先导入或生成底图。" : !character.prompt.trim() ? "请先填写该角色的提示词。" : "打开编辑器后涂选此角色，生成候选图并确认应用。"} />;
  }
  function referenceSelections(kind: ImageReferenceKind) {
    if (imageReferences.baskets[kind].length || !source) return imageReferences.baskets[kind];
    return [{ ...createImageReference({ id: "source", data: source.data, name: source.name, createdAt: 0 }), strength: kind === "vibe-transfer" ? vibeStrength : 1, information: vibeInformationExtracted, referenceType: referenceType === "style" ? "style" as const : referenceType === "character" ? "character" as const : "character&style" as const }];
  }
  const activeReferenceSelections = operation === "vibe-transfer" || operation === "precise-reference" ? referenceSelections(operation).filter(item => item.enabled) : [];
  const referenceImageCount = operation === "vibe-transfer" || operation === "precise-reference" ? activeReferenceSelections.length : operation === "character-reference" && source ? 1 : 0;
  const encodedVibeCount = operation === "vibe-transfer" ? activeReferenceSelections.filter(item => imageReferences.encodings[item.id]?.model === model && imageReferences.encodings[item.id]?.information === item.information).length : 0;
  const activeGatewayCapacity = providerId === "newapi" ? gatewayImageCapacity : null;
  const batchConcurrency = Math.max(1, activeGatewayCapacity?.concurrency || 2);
  useEffect(() => {
    if (!signedIn || providerId !== "newapi") return;
    const controller = new AbortController();
    const refreshCapacity = async () => {
      try {
        const response = await fetch("/api/image-capacity", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Gateway 并发状态不可用");
        const result = await response.json() as { available?: boolean; capacity?: GatewayImageCapacity };
        if (!controller.signal.aborted) setGatewayImageCapacity(result.available && result.capacity ? result.capacity : null);
      } catch {
        if (!controller.signal.aborted) setGatewayImageCapacity(null);
      } finally {
        if (!controller.signal.aborted) setGatewayImageCapacityChecked(true);
      }
    };
    void refreshCapacity();
    const timer = window.setInterval(() => void refreshCapacity(), 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [providerId, signedIn]);

  // Navigation and refresh preserve the login. Idle upstream sessions are
  // revoked by the server's activity based cleanup; explicit logout stays below.

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (controller.signal.aborted || policyRequestRef.current || Date.now() - policyRefreshedAt.current < POLICY_REFRESH_TTL_MS) return;
      policyRefreshedAt.current = Date.now();
      const request = fetch("/api/public/image-policy", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (controller.signal.aborted) return;
          if (response.ok) {
            const result = await response.json() as Partial<ModelPolicy>;
            if (typeof result.enableV5Models === "boolean" && typeof result.enableV45Models === "boolean") {
              setModelPolicy({ enableV5Models: result.enableV5Models, enableV45Models: result.enableV45Models });
            }
          }
          setModelPolicyReady(true);
        })
        .catch(() => {
          if (!controller.signal.aborted) setModelPolicyReady(true);
          // Keep the conservative client policy until the next refresh.
        })
        .finally(() => { if (policyRequestRef.current === request) policyRequestRef.current = null; });
      policyRequestRef.current = request;
    };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, POLICY_REFRESH_TTL_MS);
    return () => {
      controller.abort();
      policyRequestRef.current = null;
      policyRefreshedAt.current = 0;
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

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

  // 模型来源实时读取：每次都直接请求上游（no-store），并在窗口聚焦和每 60 秒刷新，
  // 不依赖本地存档；上游新增/下架模型后无需手动刷新页面。
  const refreshSources = useCallback(async (signal: AbortSignal) => {
    void refreshAssistantModels(signal);
    const [modelsResult, providersResult, novelAiResult] = await Promise.allSettled([
      fetch("/api/models", { cache: "no-store", signal }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "无法读取 NewAPI 模型");
        return data as { items?: AvailableModel[] };
      }),
      fetch("/api/providers", { cache: "no-store", signal }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "无法读取自定义 API");
        return data as { items?: ProviderSummary[] };
      }),
      fetch("/api/providers/novelai", { cache: "no-store", signal }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "无法读取 NovelAI 账号");
        return data as { account?: { connected?: boolean } | null };
      }),
    ]);
    if (signal.aborted) return;
    if (modelsResult.status === "fulfilled") {
      const available = (modelsResult.value.items || [])
        .filter((item) => typeof item.id === "string" && (item.kind === "图像模型" || isKnownImageModel(item.id)))
        .map((item) => ({
          value: item.id,
          label: models.find((known) => known.value === item.id)?.label || item.id,
        }));
      setNewApiModels(available);
      setNewApiModelsLoaded(true);
    }
    if (providersResult.status === "fulfilled")
      setCustomProviders(Array.isArray(providersResult.value.items) ? providersResult.value.items : []);
    if (novelAiResult.status === "fulfilled")
      setNovelAiConnected(Boolean(novelAiResult.value.account?.connected));
  }, [refreshAssistantModels]);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    const refreshIfStale = () => {
      if (controller.signal.aborted || Date.now() - sourcesRefreshedAt.current < SOURCE_REFRESH_TTL_MS) return;
      sourcesRefreshedAt.current = Date.now();
      void refreshSources(controller.signal);
    };
    refreshIfStale();
    const onFocus = () => refreshIfStale();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, SOURCE_REFRESH_TTL_MS);
    return () => {
      controller.abort();
      sourcesRefreshedAt.current = 0;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refreshSources, signedIn]);

  useEffect(() => {
    if (!signedIn || !selectedProvider) return;
    const controller = new AbortController();
    fetch(`/api/providers/models?providerId=${encodeURIComponent(selectedProvider.id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取模型失败");
        return result as { items?: AvailableModel[] };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setCustomProviderModels((result.items || [])
          .filter((item) => typeof item.id === "string")
          .map((item) => ({ value: item.id, label: item.id })));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCustomProviderModels([]);
      });
    return () => controller.abort();
  }, [selectedProvider, signedIn]);

  useEffect(() => {
    // Do not replace the restored model while the server policy is still loading.
    // The bootstrap list intentionally hides V5/V4.5 until that policy arrives;
    // falling back during this window used to silently select nai-v4.5-curated.
    if (historyImportPending.current || !formCacheReady || !modelPolicyReady || !modelOptions.length || modelOptions.some((item) => item.value === model)) return;
    void Promise.resolve().then(() => setModel((current) =>
      modelOptions.some((item) => item.value === current) ? current : modelOptions[0].value,
    ));
  }, [formCacheReady, modelPolicyReady, model, modelOptions]);



  useEffect(() => {
    let params: URLSearchParams;
    try { params = imageGenerationIntentParams(window.location.search); }
    catch (error) { void Promise.resolve().then(() => setNotice(error instanceof Error ? error.message : "无法读取生成任务")); return; }
    if (params.get("reuse") !== "1") return;
    const timer = window.setTimeout(() => {
      if (params.get("origin") === "comic" && /^[a-f0-9-]{36}$/i.test(params.get("projectId") || "") && /^[a-f0-9-]{36}$/i.test(params.get("panelId") || "")) setComicDestination({ projectId: params.get("projectId")!, panelId: params.get("panelId")! });
      const reusedOperation = params.get("operation") as Operation | null;
      if (reusedOperation && modes.some(({ id }) => id === reusedOperation))
        setOperation(reusedOperation);
      const reusedModel = params.get("model");
      if (reusedModel && /^[\w][\w.\-/:+]{0,199}$/.test(reusedModel))
        setModel(reusedModel);
      const reusedProvider = params.get("providerId");
      if (reusedProvider && /^[A-Za-z0-9_-]{1,200}$/.test(reusedProvider)) setProviderId(reusedProvider);
      const reusedProtocol = params.get("imageProtocol");
      if (["auto", "openai-images", "gemini", "openai-chat-images"].includes(reusedProtocol || "")) setNewApiImageProtocol(reusedProtocol as ImageProviderProtocol);
      if (["auto", "low", "medium", "high", "xhigh", "max"].includes(params.get("quality") || "")) setImageQuality(params.get("quality")!);
      if (["512", "1K", "2K", "4K"].includes(params.get("imageSize") || "")) setImageResolution(params.get("imageSize")!);
      if (["auto", "opaque", "transparent"].includes(params.get("background") || "")) setImageBackground(params.get("background")!);
      const reusedNatural = reusedModel && resolveImageModelCapabilities(reusedModel, (reusedProtocol || "auto") as ImageProviderProtocol).promptStyle === "natural";
      const numericValues = [
        ["width", setWidth, 64, reusedNatural ? 3840 : NAI_MAX_DIMENSION],
        ["height", setHeight, 64, reusedNatural ? 3840 : NAI_MAX_DIMENSION],
        ["steps", setSteps, 1, 50],
        ["scale", setScale, 0, 10],
        ["n", setCount, 1, 6],
        ["count", setCount, 1, 6],
        ["cfg_rescale", setCfgRescale, 0, 1],
      ] as const;
      numericValues.forEach(([key, setter, min, max]) => {
        if (!params.has(key)) return;
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
      setNotice(params.get("origin") === "story" ? "已载入故事场景，请补充画面描述并确认后生成。" : params.get("origin") === "comic" ? "已载入分镜提示词，请确认后生成。" : "已载入历史参数，请确认后再生成。");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultId = params.get("editorResult");
    const editorHistory = params.get("editorHistory") || "";
    if (!resultId || !/^[a-z0-9][a-z0-9._-]{0,250}$/i.test(resultId)) return;
    let active = true;
    void loadEditorDraft(resultId)
      .then(async (resultDraft) => {
        if (!active || !resultDraft) throw new Error("编辑器结果已过期，请重新打开编辑器。");
        const result = editorImageDataUrl(resultDraft.document.image);
        if (!resultDraft.document.characterReference) {
          setPrompt(resultDraft.document.prompt || "");
          setNegative(resultDraft.document.negativePrompt || "");
          restoreGenerationParameters({ operation: "inpainting", ...resultDraft.document.generation, prompt: resultDraft.document.prompt, negative_prompt: resultDraft.document.negativePrompt });
        }
        applyImageAsSource(result, "inpainting");
        const reference = { editorDraftId: resultId, editorNodeId: params.get("editorNodeId") || resultDraft.historyNodeId, editorBranchId: params.get("editorBranchId") || resultDraft.historyBranchId };
        setSource({ data: result, name: "编辑器结果.png", ...reference });
        setImages([result]);
        await addSessionResults([result], /^[a-f0-9-]{36}$/i.test(editorHistory) ? [editorHistory] : [], "inpainting", {
          ...reference,
          ...resultDraft.document.generation, prompt: resultDraft.document.prompt || "", negative: resultDraft.document.negativePrompt || "", width: resultDraft.document.image.width, height: resultDraft.document.image.height,
        });
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
    const importMode = params.get("importMode") === "generate" ? "generate" : "img2img";
    const id = galleryId || historyId;
    if (!id || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) return;
    const endpoint = galleryId
      ? `/api/gallery/${encodeURIComponent(id)}/image`
      : `/api/history/${encodeURIComponent(id)}/image`;
    let active = true;
    void (async () => {
      let blob: Blob | null = null;
      const local = historyId ? await findLocalImageHistory(historyId).catch(() => null) : null;
      if (historyId) {
        if (local) blob = local.image;
      }
      if (!blob) {
        blob = await fetchCachedImageBlob(endpoint);
      }
      if (active) {
        const importedDataUrl = await blobToDataUrl(blob);
        if (!active) return;
        const type = blob.type === "image/jpeg" || blob.type === "image/webp" ? blob.type : "image/png";
        const file = new File([blob], `工作台导入.${type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png"}`, { type });
        // Both modes restore metadata; only img2img retains the image as a source.
        if (!await importImageAndParameters(file, importMode, () => active) || !active) return;
        setImages([importedDataUrl]);
        if (galleryId && !galleryUseRecorded.current.has(galleryId)) {
          galleryUseRecorded.current.add(galleryId);
          void fetch(`/api/gallery/${encodeURIComponent(galleryId)}/use`, { method: "POST" }).catch(() => undefined);
        }
        if (galleryId) {
          const response = await fetch(`/api/gallery/${encodeURIComponent(galleryId)}`, { cache: "no-store" });
          const result = await response.json().catch(() => null) as { item?: { parameters?: GenerationParameters; prompt?: string; negativePrompt?: string } } | null;
          if (active && response.ok && result?.item?.parameters && Object.keys(result.item.parameters).length) {
            restoreGenerationParameters({ ...result.item.parameters, prompt: result.item.prompt ?? result.item.parameters.prompt, negative_prompt: result.item.negativePrompt ?? result.item.parameters.negative_prompt });
            setOperation(importMode === "img2img" ? "img2img" : "generate");
            setNotice("已载入作品公开的主提示词、角色提示词与生成参数。");
          }
        }
        if (historyId && !local?.parameters) {
          const metadataResponse = await fetch(`/api/history/${encodeURIComponent(historyId)}`, { cache: "no-store" });
          const metadata = await metadataResponse.json().catch(() => null) as { parameters?: GenerationParameters } | null;
          if (active && metadataResponse.ok && metadata?.parameters) {
            restoreGenerationParameters(metadata.parameters);
            setOperation(importMode === "img2img" ? "img2img" : "generate");
            setNotice(importMode === "img2img" ? "已载入历史图片和全部参数；参数仍可调整。" : "已载入历史提示词和全部参数；当前为文生图，参数仍可调整。");
          }
        } else if (historyId && local?.parameters) {
          restoreGenerationParameters(local.parameters as GenerationParameters);
          setOperation(importMode === "img2img" ? "img2img" : "generate");
          setNotice(importMode === "img2img" ? "已从本地载入历史图片和全部参数；参数仍可调整。" : "已从本地载入历史提示词和全部参数；当前为文生图，参数仍可调整。");
        }
      }
    })().catch((error) => {
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
    // Normalize every upload to a supported, compact image format.
    // This also handles browser-decodable GIFs without sending unsupported data URLs.
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  function cancelAgentImageImport() { agentImageUploadGeneration.current++; agentImageUploadQueue.current = Promise.resolve(); assistantImageSources.cancel(); setAgentImagesLoading(false); }

  async function handleAgentImageFiles(files: File[]) {
    if (!files.length) return;
    const generation = agentImageUploadGeneration.current, scope = assistantResourceScope;
    const valid = () => studioMountedRef.current && agentImageUploadGeneration.current === generation && agentImageOwnerRef.current === scope;
    agentImageUploadQueue.current = agentImageUploadQueue.current.catch(() => {}).then(async () => {
      if (!valid()) return;
      setAgentImagesLoading(true);
      try {
        const available = Math.max(0, MAX_ASSISTANT_IMAGES - agentImagesRef.current.length);
        if (files.length > available) setNotice(`最多可附 ${MAX_ASSISTANT_IMAGES} 张参考图，本次仅添加前 ${available} 张。`);
        const added: string[] = [];
        for (const file of files.slice(0, available)) {
          if (!valid()) return;
          const preparedFile = await assistantImageFileWithType(file);
          if (!valid()) return;
          const image = await compressAgentImage(preparedFile);
          if (!valid()) return;
          added.push(image);
        }
        if (valid()) updateAgentImages([...agentImagesRef.current, ...added].slice(0, MAX_ASSISTANT_IMAGES));
      } catch (error) { if (valid()) setNotice(error instanceof Error ? error.message : "图片处理失败"); }
      finally { if (valid()) setAgentImagesLoading(false); }
    });
    await agentImageUploadQueue.current;
  }

  const assistantConversations = useAssistantConversations(signedIn);
  const assistantMessageQueue = useOperationQueue([signedIn ? "account" : "guest", assistantConversations.ownerId ?? "pending", assistantConversations.identityRevision, assistantConversations.activeId].join(":"), 10);
  useEffect(() => {
    const controller = new AbortController();
    assistantAbortRef.current?.abort("context-changed");
    assistantAbortRef.current = null;
    assistantActiveRequestRef.current = null;
    if (assistantTimeoutRef.current != null) { window.clearTimeout(assistantTimeoutRef.current); assistantTimeoutRef.current = null; }
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setAssistantLoading(false);
      setConversation({ turns: [], tagPool: [] }); setAssistantSuggestion(null); setAgentSteps([]);
    });
    if (!signedIn) return () => controller.abort();
    const selectedId = assistantConversations.activeId;
    fetch("/api/assistant/tags?conversationId=" + encodeURIComponent(selectedId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || controller.signal.aborted) return;
        setConversation({ turns: Array.isArray(result.turns) ? result.turns : [], tagPool: Array.isArray(result.tagPool) ? result.tagPool : [] });
      }).catch(() => undefined);
    return () => controller.abort();
  }, [signedIn, assistantConversations.activeId, assistantConversations.identityRevision]);

  useEffect(() => {
    const latest = conversation.turns[0];
    if (latest?.usage) restoreAssistantUsage(latest.id, latest.usage);
  }, [conversation.turns, restoreAssistantUsage]);

  async function refreshConversation() {
    const selectedId = assistantConversations.getActiveId();
    const identityToken = assistantConversations.getIdentityToken();
    try {
      const response = await fetch("/api/assistant/tags?conversationId=" + encodeURIComponent(selectedId), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || (selectedId !== assistantConversations.getActiveId() || identityToken !== assistantConversations.getIdentityToken())) return;
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
    if (!signedIn || providerId !== "newapi") {
      void Promise.resolve().then(() => {
        if (!cancelled) setModelPricing(null);
      });
      return () => {
        cancelled = true;
      };
    }
    const pricingModel = operation === "upscale" && !naturalImageModel ? upscaleBillingModel(upscaleModel) : model;
    fetch(`/api/pricing?model=${encodeURIComponent(pricingModel)}`, { cache: "no-store" })
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
  }, [signedIn, providerId, model, operation, naturalImageModel, upscaleModel]);

  async function clearConversationHistory() {
    const selectedId = assistantConversations.getActiveId();
    const identityToken = assistantConversations.getIdentityToken();
    const response = await fetch("/api/assistant/tags?conversationId=" + encodeURIComponent(selectedId), { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.message || "对话记录清空失败");
      return;
    }
    if ((selectedId !== assistantConversations.getActiveId() || identityToken !== assistantConversations.getIdentityToken())) return;
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
    return [...agentImagesRef.current];
  }
  async function askTagAssistant(request: string, options?: { snapshot?: AssistantRequestSnapshot; throwOnError?: boolean; localTags?: string[]; signal?: AbortSignal; image?: string; images?: string[]; goalMode?: boolean; accessMode?: "approval" | "full"; goal?: string; goalIteration?: number; goalMaxRounds?: number; goalRunId?: string }) {
    const task = (async () => {
      if (!studioMountedRef.current) return null;
    const requestIdentityToken = options?.snapshot?.identityToken ?? assistantConversations.getIdentityToken();
  const requestConversationId = options?.snapshot?.body.conversationId ?? assistantConversations.getActiveId();
  if (!options?.snapshot) await agentImageUploadQueue.current;
  if (!studioMountedRef.current || requestIdentityToken !== assistantConversations.getIdentityToken() || requestConversationId !== assistantConversations.getActiveId() || options?.signal?.aborted) return null;
    const activeMemory = requestCreativeMemory();
  const selectedMemory = options?.snapshot ? options.snapshot.body.creativeMemory?.filter((note) => activeMemory?.some((current) => current.title === note.title && current.text === note.text)) : activeMemory;
  const requestMemory = selectedMemory?.length ? selectedMemory : undefined;
  const requestedAssistantModel = options?.snapshot?.body.model || assistantModel;
  if (!requestedAssistantModel) {
      setNotice("当前账户没有可用的文本模型，请改用直接检索。");
      return null;
    }
    assistantAbortRef.current?.abort("cancel");
    const controller = new AbortController();
    let serverJobId = "";
    const cancelServerJob = () => { if (serverJobId) void fetch(`/api/assistant/tags?job=${encodeURIComponent(serverJobId)}`, { method: "DELETE", keepalive: true }).catch(() => {}); };
    controller.signal.addEventListener("abort", cancelServerJob, { once: true });
    const abortFromCaller = () => controller.abort("cancel");
    options?.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (options?.signal?.aborted) controller.abort("cancel");
    assistantAbortRef.current = controller;
    const timeoutId = window.setTimeout(
      () => controller.abort("timeout"),
      ASSISTANT_CLIENT_TIMEOUT_MS,
    );
    assistantTimeoutRef.current = timeoutId;
    setAssistantLoading(true);
    setAssistantTaskError("");
    setAssistantSuggestion(null);
    setAgentSteps([]);
    const usageScope = options?.goalRunId || createBrowserRequestId();
    if (!options?.goalMode) assistantUsage.start(usageScope);
    try {
      // 任务化轮询：避免长连接被移动端 WebView 掐断，同时让检索步骤实时可见。
      const response = await fetch("/api/assistant/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(options?.snapshot?.body || {
            model: assistantModel, assistantProviderId, assistantGroup,
            reasoningEffort: storedAssistantReasoning(assistantModel), creativeMemory: requestCreativeMemory(),
            conversationId: requestConversationId, imageModel: model, modelProtocol: imageProtocol, operation,
            currentPrompt: prompt, currentNegativePrompt: negative,
            images: options?.images ?? (options?.image ? [options.image] : inputImagesForAgent()),
          }),
          // A later opt-out or deletion also removes memory from waiting requests.
          creativeMemory: requestMemory,
          allowWikipedia: (options?.snapshot?.body.allowWikipedia ?? wikipediaLookupEnabled()) && wikipediaLookupEnabled(),
          request, localTags: options?.localTags,
          ...(options?.goalMode ? { goalMode: true, accessMode: options.accessMode || "approval", goal: options.goal || "", goalIteration: options.goalIteration || 0, goalMaxRounds: options.goalMaxRounds, goalRunId: options.goalRunId } : {}),
          image: undefined,
        }),
        // Keep the already-sent creation request alive to learn its job ID even
        // if the user stops polling; the server may still incur model charges.
        signal: AbortSignal.timeout(45_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "智能助手调用失败");
      const jobId = String(result.jobId || "");
      serverJobId = jobId;
      if (controller.signal.aborted) cancelServerJob();
      if (!studioMountedRef.current || requestIdentityToken !== assistantConversations.getIdentityToken() || requestConversationId !== assistantConversations.getActiveId()) { controller.abort("context-changed"); return null; }
      if (!jobId) throw new Error("智能助手未返回任务编号");
      assistantUsage.recordJob(usageScope, jobId, []);
      if (!studioMountedRef.current || requestIdentityToken !== assistantConversations.getIdentityToken() || requestConversationId !== assistantConversations.getActiveId()) { controller.abort("context-changed"); return null; }
      if (controller.signal.aborted || assistantAbortRef.current !== controller) return null;
      for (let pollCount = 0; pollCount < ASSISTANT_MAX_POLLS; pollCount += 1) {
        await waitForAssistantPoll(ASSISTANT_POLL_INTERVAL_MS, controller.signal);
        const poll = await fetch(
          `/api/assistant/tags?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const progress = await poll.json();
        if (!studioMountedRef.current || requestIdentityToken !== assistantConversations.getIdentityToken() || requestConversationId !== assistantConversations.getActiveId()) { controller.abort("context-changed"); return null; }
      if (controller.signal.aborted || assistantAbortRef.current !== controller) return null;
        if (!poll.ok) throw new Error(progress.message || "智能助手调用失败");
        if (Array.isArray(progress.usage)) assistantUsage.recordJob(usageScope, jobId, progress.usage, progress.status);
        if (Array.isArray(progress.steps) && progress.steps.length)
          setAgentSteps(progress.steps);
        if (progress.status === "done") {
          setAssistantSuggestion(progress.suggestion);
          // 本轮已落盘，刷新历史与标签池。
          void refreshConversation();
          return progress.suggestion as AssistantSuggestion;
        }
        if (progress.status === "cancelled") throw new DOMException("助手任务已取消", "AbortError");
        if (progress.status === "error")
          throw new Error(progress.message || "智能助手调用失败");
      }
      throw new Error("助手任务已超过等待时限，请稍后查看对话记录或重试。");
    } catch (error) {
      if (assistantAbortRef.current !== controller) return null;
      if (controller.signal.aborted) {
        setNotice(
          controller.signal.reason === "timeout"
            ? "助手任务超时，任务仍可能在后台运行，请稍后重试。"
            : "已取消助手任务。",
        );
      } else {
        const message = error instanceof Error ? error.message : "智能助手调用失败";
        setAssistantTaskError(message);
        setNotice(message);
      }
      if (options?.throwOnError && !controller.signal.aborted) throw error;
    if (options?.throwOnError && controller.signal.reason === "timeout") throw new Error("助手任务超时");
    return null;
  } finally {
      options?.signal?.removeEventListener("abort", abortFromCaller);
      if (assistantTimeoutRef.current === timeoutId) {
        window.clearTimeout(timeoutId);
        assistantTimeoutRef.current = null;
      }
      if (assistantAbortRef.current === controller) {
        assistantAbortRef.current = null;
        setAssistantLoading(false);
      }
    }

    })();
    assistantActiveRequestRef.current = task;
    const release = () => { if (assistantActiveRequestRef.current === task) assistantActiveRequestRef.current = null; };
    void task.then(release, release);
    return task;
  }

  // “让助手处理”是明确的 Agent 入口。仅在无可用模型时降级到直接检索。
  function submitAssistantMessage(inputOverride?: string): boolean {
    const input = (inputOverride ?? agentInput).trim();
    if (!input || input.length > ASSISTANT_INPUT_MAX_LENGTH) { setNotice("请输入不超过 10000 字的创作需求。"); return false; }
    if (assistantMode === "goal" || !signedIn || !assistantModel) { void runAgent(input); return true; }
    if (assistantConversations.control.pending || agentImagesLoading) { setNotice("正在恢复会话或处理参考图，请稍候再发送。"); return false; }
    const snapshot: AssistantRequestSnapshot = {
      identityToken: assistantConversations.getIdentityToken(),
      body: {
        model: assistantModel, assistantProviderId, assistantGroup,
        reasoningEffort: storedAssistantReasoning(assistantModel), allowWikipedia: wikipediaLookupEnabled(), creativeMemory: requestCreativeMemory()?.map((note) => ({ ...note })),
        conversationId: assistantConversations.getActiveId(), imageModel: model, modelProtocol: imageProtocol, operation,
        currentPrompt: prompt, currentNegativePrompt: negative, images: [...agentImagesRef.current],
      },
    };
    try {
      assistantMessageQueue.queue.enqueue(input, async (signal) => {
        const result = await askTagAssistant(input, { snapshot, signal, throwOnError: true });
        if (!result && !signal.aborted) throw new Error("助手任务未完成，请查看对话中的错误信息。");
      }, () => assistantActiveRequestRef.current);
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法加入助手队列"); return false; }
  }
  async function runAgent(inputOverride?: string) {
    const input = (inputOverride ?? agentInput).trim();
    if ((inputOverride ?? agentInput).length > ASSISTANT_INPUT_MAX_LENGTH) {
      setNotice("创作需求不能超过 10000 字。");
      return;
    }
    if (!input) {
      setNotice(assistantMode === "goal" ? "请描述你希望最终图像达到的目标。" : "请描述画面，或输入要查询的标签关键词。");
      return;
    }
    if (assistantMode === "goal") {
      await startGoalAgent(input);
      return;
    }
    setTagResults([]);
    setAssistantSuggestion(null);
    if (signedIn && assistantModel) await askTagAssistant(input);
    else await searchDanbooru(input);
  }

  // Parse parameters for both import modes; ordinary uploads still default to a source image.
  async function importImageAndParameters(file?: File, targetOperation?: "generate" | "img2img", isActive = () => true) {
    if (!file || !isActive()) return false;
    const invalid = validateUploadFile(file);
    if (invalid) {
      setNotice(invalid);
      return false;
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
      if (!isActive()) return false;
      setSource(targetOperation === "generate" ? null : { data, name: file.name });
      setMask(null);
      setUpscaleSource(null);
      if (targetOperation) setOperation(targetOperation);
      else if (operation === "generate" || operation === "suggest-tags")
        setOperation("img2img");
      if (!metadata) {
        if (targetOperation) restoreCharacterParameters({ characterPrompts: [] }, true);
        if (targetOperation === "generate") {
          setPrompt(""); setNegative("");
          setNotice("已切换到文生图；作品未包含可读取的公开参数，请填写提示词后生成。");
        } else setNotice(`已导入 ${file.name}，未检测到 NAI 参数（仅作为源图）。`);
        return true;
      }
      const { mapNaiParameters } = await import("@/lib/nai-import");
      const imported = mapNaiParameters(
        metadata.parameters,
        models.map(({ value }) => value),
      );
      if (!isActive()) return false;
      restoreCharacterParameters({ characterPrompts: imported.characterPrompts || [], use_coords: imported.useCoords }, true);
      if (imported.prompt || targetOperation) setPrompt(imported.prompt || "");
      if (imported.negativePrompt || targetOperation) setNegative(imported.negativePrompt || "");
      if (imported.model) setModel(imported.model);
      if (imported.width) setWidth(imported.width);
      if (imported.height) setHeight(imported.height);
      if (imported.steps != null) setSteps(imported.steps);
      if (imported.scale != null) setScale(imported.scale);
      if (imported.cfgRescale != null) setCfgRescale(imported.cfgRescale);
      if (imported.sampler) setSampler(imported.sampler);
      if (imported.noiseSchedule) setSchedule(imported.noiseSchedule);
      if (imported.seed != null && Number(imported.seed) !== 0) setSeed(imported.seed);
      if (imported.count != null) setCount(imported.count);
      if (imported.strength != null) setStrength(imported.strength);
      setNotice(targetOperation === "generate" ? "已载入提示词和生成参数；当前为文生图，原图仅供预览。" : `已从 ${file.name} 导入图片与生成参数。`);
      return true;
    } catch {
      if (isActive()) setNotice("读取图片失败，请重试。");
      return false;
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
    const suggestedSize = naturalImageModel && (parameters.width || parameters.height) ? normalizeImageModelSize(model, parameters.width || width, parameters.height || height, imageProtocol) : null;
    const targetSize = suggestedSize ? [suggestedSize.width, suggestedSize.height] : modelCapabilities.sizes.length ? nearestImageSize(parameters.width || width, parameters.height || height, modelCapabilities.sizes).split("x").map(Number) : null;
    if (targetSize) { setWidth(targetSize[0]); setHeight(targetSize[1]); }
    if (!targetSize && parameters.width && parameters.width >= 64 && parameters.width <= NAI_MAX_DIMENSION)
      setWidth(parameters.width);
    if (
      !targetSize && parameters.height &&
      parameters.height >= 64 &&
      parameters.height <= NAI_MAX_DIMENSION
    )
      setHeight(parameters.height);
    if (modelCapabilities.sampling && parameters.steps && parameters.steps >= 1 && parameters.steps <= 50)
      setSteps(parameters.steps);
    if (
      modelCapabilities.sampling && parameters.scale != null &&
      parameters.scale >= 0 &&
      parameters.scale <= 10
    )
      setScale(parameters.scale);
    // seed 0 = 随机，不填入种子框（保持为空即随机）。
    if (modelCapabilities.seed && parameters.seed != null && parameters.seed !== 0)
      setSeed(String(parameters.seed));
    if (
      modelCapabilities.sampling && parameters.sampler &&
      samplers.some(({ value }) => value === parameters.sampler)
    )
      setSampler(parameters.sampler);
    if (
      modelCapabilities.sampling && parameters.noiseSchedule &&
      schedules.some(({ value }) => value === parameters.noiseSchedule)
    )
      setSchedule(parameters.noiseSchedule);
  }

  // 应用全部：替换为建议提示词并补齐缺失标签。
  // 不用 window.confirm——部分内置浏览器会静默吞掉确认框导致无法应用。
  function applyAllSuggestions() {
    if (!assistantSuggestion) return;
    applySuggestionValues(assistantSuggestion);
  }

  function applySuggestionValues(suggestion: AssistantSuggestion, clearPreview = true) {
    if (suggestion.imageModel && (suggestion.imageModel !== model || suggestion.modelProtocol !== imageProtocol)) { setNotice("这份建议对应先前的图像模型，请使用当前模型重新生成建议。"); return; }
    if (naturalImageModel) {
      setPrompt(suggestion.prompt);
      setNegative(suggestion.negativePrompt || "");
      applySuggestedParameters(suggestion.parameters);
      if (clearPreview) setAssistantSuggestion(null);
      setNotice(clearPreview ? "已应用当前图像模型的场景描述建议。" : "Agent 已应用场景描述和参数，准备生成下一轮。"); return;
    }
    const tagNames = suggestion.tags.map((tag) => tag.name);
    setPrompt((value) => {
      const base = (suggestion.prompt || value).trim();
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
    if (suggestion.negativePrompt)
      setNegative(suggestion.negativePrompt);
    applySuggestedParameters(suggestion.parameters);
    // 多角色建议：切换到文生图并启用多角色，填入各角色提示词与坐标。
    const suggestedCharacters = suggestion.characters ?? [];
    if (suggestedCharacters.length) {
      setOperation("generate");
      setCharactersEnabled(true);
      setCharacters(
        suggestedCharacters.map((character, index) => ({
          id: `char-${index}-${Date.now()}`,
          prompt: character.prompt,
          negative: "",
          centerX: character.centerX,
          centerY: character.centerY,
        })),
      );
    }
    if (clearPreview) setAssistantSuggestion(null);
    setNotice(!clearPreview ? "Agent 已应用提示词与生成参数，准备生成下一轮。" :
      suggestedCharacters.length
        ? `已应用建议，并填充 ${suggestedCharacters.length} 个角色提示词。`
        : "已应用助手的全部建议。",
    );
  }

  function updateGoalRun(next: GoalAgentRun | null) {
    goalRunRef.current = next;
    setGoalRun(next);
  }

  function stopGoalAgent() {
    if (goalRunRef.current) updateGoalRun({ ...goalRunRef.current, status: "stopped" });
    goalReviewImageRef.current = null;
    assistantAbortRef.current?.abort("cancel");
    setNotice("已停止目标 Agent。当前正在生成的图片会照常完成，不会触发下一轮。");
  }

  async function startGoalAgent(goal: string) {
    if (agentImagesLoading) { setNotice("参考图正在处理，请稍候。"); return; }
    if (!signedIn || !assistantModel) {
      setNotice("目标 Agent 需要登录并选择可用的 NewAPI 文本模型。");
      return;
    }
    const current: GoalAgentRun = { id: createBrowserRequestId(), goal, accessMode: autonomyMode, completedGenerations: 0, maxGenerations: goalMaxRounds, status: "running" };
    updateGoalRun(current);
    assistantUsage.start(current.id);
    if (current.accessMode === "full") setCount(1);
    const referenceImage = source && ["img2img", "inpainting", "edits", "outpainting", "character-reference", "precise-reference", "vibe-transfer"].includes(operation) ? source.data : undefined;
    const referenceImages = agentImagesRef.current.length ? [...agentImagesRef.current] : referenceImage ? [referenceImage] : [];
    current.referenceImages = referenceImages;
    const suggestion = await askTagAssistant("请根据用户目标和当前工作台配置，提出第一轮最有效的提示词与参数建议。此时尚无本次目标的生成结果。", {
      goalMode: true, accessMode: current.accessMode, goal, goalIteration: 0, goalMaxRounds: current.maxGenerations, goalRunId: current.id,
      images: referenceImages,
    });
    const active = goalRunRef.current;
    if (!active || active.id !== current.id || active.status !== "running") return;
    if (!suggestion) { updateGoalRun({ ...active, status: "needs-attention" }); return; }
    if (current.accessMode === "full") {
      applySuggestionValues(suggestion, false);
      setCount(1);
      triggerGoalGeneration();
    }
  }

  async function reviewGoalResult(image: string) {
    const current = goalRunRef.current;
    if (!current || current.status !== "running") return;
    const completedGenerations = current.completedGenerations + 1;
    const reviewedRun = { ...current, completedGenerations };
    updateGoalRun(reviewedRun);
    const suggestion = await askTagAssistant(
      `请检查刚生成的结果是否符合目标；若未满足，给出下一轮最小有效修改。当前已完成 ${completedGenerations} 轮生成。`,
      { goalMode: true, accessMode: current.accessMode, goal: current.goal, goalIteration: completedGenerations, goalMaxRounds: current.maxGenerations, goalRunId: current.id, images: [...(current.referenceImages || []).slice(0, MAX_ASSISTANT_IMAGES - 1), image] },
    );
    const active = goalRunRef.current;
    if (!active || active.id !== current.id || active.status !== "running") return;
    if (!suggestion) { updateGoalRun({ ...active, status: "needs-attention" }); return; }
    if (suggestion.goalComplete) {
      updateGoalRun({ ...active, status: "complete" });
      setNotice("Agent 评估本轮图像已达到目标。");
      return;
    }
    if (current.accessMode === "approval") {
      setNotice(`Agent 已评估第 ${completedGenerations} 轮结果并提出下一步建议；请自行选择是否应用。`);
      return;
    }
    if (completedGenerations >= current.maxGenerations) {
      updateGoalRun({ ...active, status: "limit" });
      setNotice(`已达到完全访问模式的 ${current.maxGenerations} 轮上限，保留最后一份建议供你检查。`);
      return;
    }
    applySuggestionValues(suggestion, false);
    setCount(1);
    triggerGoalGeneration();
  }

  function triggerGoalGeneration() {
    window.setTimeout(() => {
      const current = goalRunRef.current;
      if (!current || current.status !== "running" || current.accessMode !== "full") return;
      const button = [...document.querySelectorAll<HTMLButtonElement>("[data-studio-generate]")]
        .find((candidate) => candidate.offsetParent !== null && !candidate.disabled);
      if (!button) {
        updateGoalRun({ ...current, status: "needs-attention" });
        setNotice("Agent 已整理好建议，但当前生成按钮不可用；请检查模型、源图和工作台参数。");
        return;
      }
      autonomousGenerationRef.current = true;
      button.click();
    }, 100);
  }

  function handleStudioGenerationClick() {
    const autonomous = autonomousGenerationRef.current;
    autonomousGenerationRef.current = false;
    void runOperation(undefined, autonomous);
  }

  const promptRelatedSamples = [...sessionHistory.map((item) => item.prompt), ...promptConfig.library.map((entry) => entry.content)];

  // 提示词工具条（借鉴 Aaalice）：随机、清空、文本/Tag 模式切换。
  const promptToolbar = (target: "prompt" | "negative") => (
    <>
      {!naturalImageModel && target === "prompt" && generationModes.has(operation) && (
        <Tooltip label="随机提示词"><button
          type="button"
          onClick={() => void rollRandomPrompt()}
          disabled={randomPromptLoading}
          aria-label="随机提示词"
          className="grid h-6 w-6 place-items-center rounded border border-[var(--line)] text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)] disabled:opacity-50"
        >
          <Dices size={13} className={randomPromptLoading ? "animate-spin" : ""} />
        </button></Tooltip>
      )}
      <Tooltip label={target === "prompt" ? "清空提示词" : "清空排除内容"}><button
        type="button"
        onClick={() => {
          if (target === "prompt") {
            setPrompt("");
            setCharacters((current) =>
              current.map((character) => ({ ...character, prompt: "" })),
            );
          } else setNegative("");
        }}
        disabled={target === "prompt" ? !prompt.trim() : !negative.trim()}
        aria-label={target === "prompt" ? "清空提示词" : "清空排除内容"}
        className="grid h-6 w-6 place-items-center rounded border border-[var(--line)] text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)] disabled:opacity-40"
      >
        <Eraser size={13} />
      </button></Tooltip>
      <Tooltip label="提示词设置"><ReplicaPromptSettingsButton variant="nai" config={promptConfig} onChange={savePromptConfig}
        initialText={target === "prompt" ? prompt : negative} natural={naturalImageModel} onNotice={setNotice}
        className="grid h-6 w-6 place-items-center rounded border border-[var(--line)] text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]" /></Tooltip>
      <PromptHistoryButton target={target} />
      {!naturalImageModel && target === "prompt" && (
        <span
          className="flex h-6 items-center rounded-full border border-[var(--line)] bg-white text-[10px] font-semibold"
          role="group"
          aria-label="输入模式"
        >
          <Tooltip label="文本模式"><button
            type="button"
            aria-pressed={!promptTagMode}
            onClick={() => setPromptTagMode(false)}
            className={`flex h-full items-center gap-1 rounded-full px-2 ${
              !promptTagMode ? "bg-[var(--rose)] text-white" : "text-[var(--muted)]"
            }`}
          >
            <Type size={10} />文本
          </button></Tooltip>
          <Tooltip label="Tag 模式"><button
            type="button"
            aria-pressed={promptTagMode}
            onClick={() => setPromptTagMode(true)}
            className={`flex h-full items-center gap-1 rounded-full px-2 ${
              promptTagMode ? "bg-[var(--rose)] text-white" : "text-[var(--muted)]"
            }`}
          >
            <Tags size={10} />Tag
          </button></Tooltip>
        </span>
      )}
    </>
  );

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
        placeholder={
          promptTagMode
            ? "Danbooru 标签，逗号分隔，如 1girl, white hair, crimson eyes"
            : "自然语言描述画面，如 一个白发的女孩穿着和服站在窗边"
        }
        tools={promptToolbar("prompt")}
        autocomplete={!naturalImageModel}
        tagMode={!naturalImageModel && promptTagMode}
        config={promptConfig}
        relatedSamples={promptRelatedSamples}
        natural={naturalImageModel}
        onNotice={setNotice}
        inlineChatTarget={{ kind: "prompt", label: naiLayout ? "提示词" : "描述画面" }}
        openInlineChatMenu={openInlineChatMenu}
      />
      {operation !== "suggest-tags" && modelCapabilities.acceptsNegative && (
        <Prompt
          label={naiLayout ? "负面内容" : "排除内容"}
          value={negative}
          onChange={setNegative}
          placeholder="低质量、错误肢体、水印等不希望出现的内容"
          tools={promptToolbar("negative")}
          autocomplete={!naturalImageModel}
          tagMode={!naturalImageModel && promptTagMode}
          config={promptConfig}
          relatedSamples={promptRelatedSamples}
          natural={naturalImageModel}
          onNotice={setNotice}
          inlineChatTarget={{ kind: "negative", label: naiLayout ? "负面内容" : "排除内容" }}
          openInlineChatMenu={openInlineChatMenu}
        />
      )}
      {!naturalImageModel && operation !== "suggest-tags" && (
        // 等级提示词预设（移植 Aaalice）：质量词→正向末尾，UC→负向前缀。
        <div className="grid gap-3">
          <div hidden={mediumEffort} className="block text-xs font-semibold text-[#4c5052]">
            <span className="mb-2 block">质量词 <small className="font-normal text-[var(--muted)]">追加到提示词末尾</small></span>
            <PopupSelect
              value={qualityTier}
              options={[
                { value: "nai-default", label: QUALITY_TIER_LABELS["nai-default"] },
                ...(isV5Model(model) ? [{ value: "light", label: QUALITY_TIER_LABELS.light }] : []),
                { value: "none", label: QUALITY_TIER_LABELS.none },
                ...(customQuality.trim() ? [{ value: "custom", label: `自定义 · ${customQuality.trim().slice(0, 24)}…` }] : []),
              ]}
              onChange={(next) => setQualityTier(next as QualityTier)}
              ariaLabel="质量词等级"
              emptyText="没有匹配项"
            />
          </div>
          <div hidden={mediumEffort} className="block text-xs font-semibold text-[#4c5052]">
            <span className="mb-2 block">负面预设 (UC) <small className="font-normal text-[var(--muted)]">添加到排除内容前缀</small></span>
            <PopupSelect
              value={ucType}
              options={(Object.keys(UC_PRESET_LABELS) as Array<Exclude<UcPresetType, "custom"> | "custom">)
                .filter((type) => type !== "custom" || customUc.trim())
                .map((type) => ({ value: type, label: UC_PRESET_LABELS[type] }))}
              onChange={(next) => setUcType(next as typeof ucType)}
              ariaLabel="负面提示词预设"
              emptyText="没有匹配项"
            />
          </div>
        </div>
      )}
    </div>
  );

  // 多角色：文生图与图生图/局部重绘（带参考图）都可与角色提示词一同使用。
  const characterControls = modelCapabilities.characters && ["generate", "img2img", "inpainting"].includes(operation) && (
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
            为画面中的每个角色编写独立提示词。主提示词描述整体场景。
          </p>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold">
            <input
              type="checkbox"
              checked={aiAutoPosition}
              onChange={(event) => setAiAutoPosition(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--rose)]"
            />
            关闭滑块定位
          </label>
          {characters.map((character, index) => (
            <div
              key={character.id}
              className="rounded border border-[var(--line)] bg-[#faf9f5] p-2.5"
            >
              <div className="flex items-center justify-between">
                <b className="flex items-center gap-1.5 text-[11px] text-[var(--rose)]">
                  <i className={`char-color-${index % 6} inline-block h-2.5 w-2.5 rounded-full`} style={{ background: "var(--char-color)" }} />
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
                onContextMenu={(event) =>
                  openInlineChatMenu(
                    event,
                    { kind: "character", label: `角色 ${index + 1} 提示词`, characterId: character.id },
                  )
                }
                onMouseDown={(event) => {
                  // 右键保护选区：mousedown 移动光标会让选区先塌掉。
                  if (
                    event.button === 2 &&
                    (event.currentTarget.selectionEnd ?? 0) >
                      (event.currentTarget.selectionStart ?? 0)
                  )
                    event.preventDefault();
                }}
              />
              <textarea
                className="field mt-2 min-h-12 w-full resize-y p-2 text-xs"
                placeholder="该角色的负向提示词（可选），如 bad hands"
                value={character.negative}
                onChange={(event) =>
                  setCharacters((current) =>
                    current.map((item) =>
                      item.id === character.id
                        ? { ...item, negative: event.target.value }
                        : item,
                    ),
                  )
                }
                onContextMenu={(event) =>
                  openInlineChatMenu(
                    event,
                    { kind: "characterNegative", label: `角色 ${index + 1} 负向提示词`, characterId: character.id },
                  )
                }
                onMouseDown={(event) => {
                  if (
                    event.button === 2 &&
                    (event.currentTarget.selectionEnd ?? 0) >
                      (event.currentTarget.selectionStart ?? 0)
                  )
                    event.preventDefault();
                }}
              />
              {renderCharacterReference(character)}
              {!aiAutoPosition && (
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
              )}
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
                    negative: "",
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

  const generationParameters = naturalImageModel ? naturalSettings : generationModes.has(operation) && (
    <div
      data-tutorial="sampling"
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
              min={mediumEffort ? 14 : 1}
              max={mediumEffort ? 14 : isNaiLimitModel(model) ? 28 : 50}
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
            min={mediumEffort ? 14 : 1}
            max={mediumEffort ? 14 : isNaiLimitModel(model) ? 28 : 50}
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
                placeholder="留空或 0 为随机"
                inputMode="numeric"
              />
            </Control>
            <Control label="采样器">
              <PopupSelect
                value={sampler}
                options={samplers}
                onChange={setSampler}
                disabled={mediumEffort}
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
              {!mediumEffort && <NumericSlider
                label="提示词相关性重缩放"
                value={cfgRescale}
                setValue={setCfgRescale}
                min={0}
                max={1}
                step={0.02}
              />}
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

  function selectImageModel(next: string) {
    setModel(next);
    const caps = resolveImageModelCapabilities(next, imageProtocol);
    if (!caps.operations.includes(operation)) setOperation("generate");
    if (caps.sizes.length || caps.sizeConstraints) {
      const { width: nextWidth, height: nextHeight } = normalizeImageModelSize(next, width, height, imageProtocol);
      setWidth(nextWidth);
      setHeight(nextHeight);
    }
  }

  function generationEffortTarget(effort: "high" | "medium") {
    return effort === "medium"
      ? (model.includes("inpaint") ? "nai-v5-inpaint-medium" : "nai-v5-full-medium")
      : highEffortSettings.current && model.includes("inpaint") === highEffortSettings.current.model.includes("inpaint")
        ? highEffortSettings.current.model
        : model.replace(/-medium$/, "");
  }

  function selectGenerationEffort(effort: "high" | "medium") {
    const target = generationEffortTarget(effort);
    if (!modelOptions.some((item) => item.value === target)) return;
    if (effort === "medium" && !mediumEffort) {
      highEffortSettings.current = { model, steps, sampler, cfgRescale, width, height, count };
      const size = normalizeImageModelSize(target, width, height);
      setWidth(size.width);
      setHeight(size.height);
      setSteps(14);
      setSampler("k_euler_ancestral");
      setCfgRescale(0);
      setCount(1);
    } else if (effort === "high" && highEffortSettings.current) {
      setSteps(highEffortSettings.current.steps);
      setSampler(highEffortSettings.current.sampler);
      setCfgRescale(highEffortSettings.current.cfgRescale);
      setWidth(highEffortSettings.current.width);
      setHeight(highEffortSettings.current.height);
      setCount(highEffortSettings.current.count);
    }
    setModel(target);
  }

  const modelModeControls = (
    <div className="studio-model-controls space-y-3">
      <div className="nai-model-mode-row">
        <Control label="模型来源">
          <PopupSelect
            value={providerId}
            options={providerOptions}
            onChange={(next) => {
              setProviderId(next);
              setCustomProviderModels([]);
              if (next === "newapi") setModel(newApiModels.find((item) => /^nai-v5-full$/i.test(item.value))?.value || newApiModels[0]?.value || (newApiModelsLoaded ? "" : models[0].value));
              else if (next === "novelai") setModel("nai-v5-full");
              else setModel(customProviders.find((item) => item.id === next)?.models[0] || "");
              if (next !== "newapi") setOperation("generate");
            }}
            ariaLabel="模型来源"
          />
        </Control>
        <Link href="/settings#models" className="studio-model-source-management flex h-10 items-center justify-center self-end text-xs font-semibold text-[var(--rose)] hover:underline">
          管理来源
        </Link>
      </div>
      <div className="nai-model-mode-row">
        <Control label="模型">
          <PopupSelect
            value={modelSelectionOptions.some((item) => item.value === modelSelectionValue) ? modelSelectionValue : ""}
            options={modelSelectionOptions}
            onChange={selectImageModel}
            ariaLabel="模型"
            searchable
            searchPlaceholder="搜索模型"
            emptyText={authenticated ? "该接口暂无可用模型" : "暂无可用模型，登录后从上游读取"}
          />
        </Control>
        {(providerId === "novelai" || model.startsWith("nai-")) && (
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
        )}
      </div>
      {(mediumEffort || /^nai-v5-(?:full|inpaint)(?:-limit)?$/.test(model)) && <Control label="生成档位">
        <div role="group" aria-label="生成档位" className="flex gap-1">
          {(["high", "medium"] as const).map((effort) => {
            return <button
              key={effort}
              type="button"
              aria-pressed={(effort === "medium") === mediumEffort}
              disabled={generating || !modelOptions.some((item) => item.value === generationEffortTarget(effort))}
              className={`h-9 flex-1 rounded border px-2 text-xs ${((effort === "medium") === mediumEffort) ? "border-[var(--rose)] text-[var(--rose)]" : "border-[var(--line)]"}`}
              onClick={() => selectGenerationEffort(effort)}
            >
              {effort === "medium" ? "低成本 · Medium" : "常规 · High"}
            </button>;
          })}
        </div>
      </Control>}
      {providerId === "newapi" && <Control label="图像接口">
        <PopupSelect
          value={productMode}
          onChange={(value) => {
            const nextMode = value as ImageProductMode;
            setProductMode(nextMode);
            if (providerId === "newapi") setNewApiImageProtocol(productModeProtocol(nextMode));
            // 切换接口时只允许选择该接口在上游可用的模型；没有可用模型时置空等待用户选择。
            const nextModel = allModelOptions.find((item) => modelMatchesProductMode(item.value, nextMode))?.value;
            setModel(nextModel ?? "");
          }}
          ariaLabel="图像接口"
          options={[
            { value: "nai", label: "NAI 原生", description: "标签、采样参数与 NAI 原生接口" },
            { value: "gpt", label: "GPT Images", description: "自然语言与 OpenAI Images" },
            { value: "nano-banana", label: "Nano Banana", description: "自然语言与 Gemini 原生接口" },
          ]}
        />
      </Control>}
    </div>
  );

  const directorTools = (
    <div className="nai-director-grid">
      {modes.filter((item) => item.id.startsWith("director-") && modelCapabilities.operations.includes(item.id)).map((item) => (
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
  );

  const workspaceExtras = <section className="studio-parameter-utilities" aria-label="参数附加工具"><header><WandSparkles size={16} /><b>工作台工具</b><small>历史复用、任务队列与预览</small></header><MetadataRestoreControl preferences={metadataRestore.preferences} onChange={metadataRestore.update}/><details className="studio-image-queue"><summary>图片队列 · {imageOperationQueue.items.filter(item => item.status === "queued" || item.status === "running").length} 个任务</summary><p>排队保留提交时的参数，费用以执行时服务端结算为准。</p><button type="button" disabled={!signedIn || imageOperationQueue.items.filter(item => item.status === "queued" || item.status === "running").length >= 10} onClick={() => void runOperation(undefined, false, true)}>将当前设置加入队列</button><button type="button" disabled={!imageOperationQueue.items.some(item => item.status === "queued")} onClick={() => imageOperationQueue.items.filter(item => item.status === "queued").forEach(item => imageOperationQueue.queue.cancel(item.id))}>清除等待任务</button>{!imageOperationQueue.items.length && <p className="queue-empty">暂无排队任务</p>}<ol>{imageOperationQueue.items.map(item => <li key={item.id}><span>{item.label} · {item.status === "queued" ? "等待中" : item.status === "running" ? "生成中" : item.status === "completed" ? "已完成" : item.status === "failed" ? "失败" : "已取消"}{item.error ? `：${item.error}` : ""}</span>{(item.status === "queued" || item.status === "running") && <button type="button" onClick={() => imageOperationQueue.queue.cancel(item.id)}>{item.status === "running" ? "停止" : "移除"}</button>}</li>)}</ol></details><div className="studio-preview-follow"><h3>预览与分镜</h3><p>固定预览时，新结果仍会保存至历史。</p><button type="button" disabled={!displayedImages.length && !previewFrozen} aria-pressed={previewFrozen} onClick={() => { if (!previewFrozen) setFrozenPreviewImages([...incomingPreviewImages]); setPreviewFrozen(value => !value); }}>{previewFrozen ? "恢复显示最新结果" : "固定当前预览"}</button>{previewFrozen && <span role="status">预览已固定；新结果继续保存在历史中。</span>}<a href="/comic">漫画分镜</a></div>{comicDestination && <div className="studio-comic-handoff"><a href="/comic">返回漫画分镜</a><button type="button" disabled={generating || !images.length} onClick={() => void returnComicCandidates()}>将当前结果加入此格</button></div>}</section>;
  const legacyControls = (
    <>
      <div
        className={
          naiLayout || customWorkspace
            ? "nai-toolbar flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5"
            : "studio-controls-header flex items-center justify-between border-b border-[var(--line)] px-4 py-3"
        }
      >
        {!naiLayout && !customWorkspace && (
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
            naiLayout || customWorkspace
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
            setProviderId("newapi");
            setModel(newApiModels[0]?.value || (newApiModelsLoaded ? "" : models[0].value));
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
              { id: "char-1", prompt: "", negative: "", centerX: 0.5, centerY: 0.5 },
            ]);
            setReferenceType("character&style");
            setControlModel("hed");
            setUpscaleModel(NAI_UPSCALE_MODEL_OPTIONS[0].value);
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
        {(naiLayout || customWorkspace) && (
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
                href="/profile#profile-wallet"
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
      <div className={`settings-scroll ${!naiLayout ? `workspace-panel-layout-${customWorkspace ? "custom" : preferences.workspaceLayout}` : "nai-panel-layout"} space-y-5 p-4`}>
        <div data-layout-module="model" style={customModuleStyle("model")}>
          {layoutModuleTools("model")}
          {naiLayout ? (
            <section className="nai-model-mode-persistent" aria-label="模型与模式">
              <div className="nai-section-heading">模型与模式</div>
              {modelModeControls}
            </section>
          ) : customWorkspace ? (
            <section className="replica-model-controls" aria-label="模型与模式">
              {modelModeControls}
            </section>
          ) : (
            <PanelSection title="模型与模式" icon={<SlidersHorizontal size={16} />}>
              {modelModeControls}
            </PanelSection>
          )}
        </div>
        {sidebarPromptLayout && (
          <div data-layout-module="prompt" data-layout-collapsed={customWorkspace && customPromptCollapsed ? "true" : undefined} style={customModuleStyle("prompt", customPromptCollapsed)}>
            {layoutModuleTools("prompt")}
            {customWorkspace ? <>
              <ReplicaPromptEditor variant="nai" prompt={prompt} negative={negative} model={model} imageProtocol={imageProtocol} operation={operation} assistantModel={assistantModel} assistantProviderId={assistantProviderId} assistantGroup={assistantGroup} historyPrompts={sessionHistory.map((item) => item.prompt)}
                onPromptChange={setPrompt} onNegativeChange={setNegative} onEffectiveChange={setEffectivePrompts}
                collapsed={customPromptCollapsed} onCollapsedChange={setCustomPromptCollapsed}
                onAssistant={(text) => { setAgentInput(text); openAssistantPanel(); }} />
              {modelCapabilities.characters && ["generate", "img2img", "inpainting"].includes(operation) && <ReplicaCharacters variant="nai" model={model} imageProtocol={imageProtocol}
                characters={characters} setCharacters={setCharacters} charactersEnabled={charactersEnabled} setCharactersEnabled={setCharactersEnabled}
                aiAutoPosition={aiAutoPosition} setAiAutoPosition={setAiAutoPosition} renderCharacterReference={renderCharacterReference} />}
            </> : <PanelSection title="提示词" icon={<Paintbrush size={16} />}>
              {promptFields}
              {characterControls}
            </PanelSection>}
          </div>
        )}

        <div data-layout-module="image" style={customModuleStyle("image")}>
          {layoutModuleTools("image")}
          {customWorkspace ? <ReplicaImageSize model={model} variant="nai" width={width} height={height} count={count} setWidth={setWidth} setHeight={setHeight} setCount={setCount} /> : naiLayout ? (
            <PanelSection title="图像设置" icon={<Images size={16} />}>
              <NaiImageSettings model={model} width={width} height={height} count={count} setWidth={setWidth} setHeight={setHeight} setCount={setCount} />
            </PanelSection>
          ) : (
          <Control label="自定义分辨率 · 64 对齐，按面积限制">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <NumberField
              value={width}
              setValue={setWidth}
              min={64}
              max={naiDimensionLimit(height, model)}
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
              max={naiDimensionLimit(width, model)}
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
        </div>
        {!sidebarPromptLayout && (naturalImageModel
          ? <Control label={model ? "输出设置" : `${productMode === "nano-banana" ? "Nano Banana" : "GPT Images"} 输出设置`}>{naturalSettings}</Control>
          : generationParameters)}
        {naiLayout && <div className="nai-inline-generation-parameters">{generationParameters}</div>}
        {(nlwLayout || customWorkspace) && <div data-layout-module="sampling" style={customModuleStyle("sampling")} className="nlw-inline-generation-parameters">
          {layoutModuleTools("sampling")}
          {customWorkspace ? <ReplicaGenerationSettings variant="nai" model={model} naturalSettings={naturalSettings} steps={steps} scale={scale} seed={seed} sampler={sampler} schedule={schedule} cfgRescale={cfgRescale}
            setSteps={setSteps} setScale={setScale} setSeed={setSeed} setSampler={setSampler} setSchedule={setSchedule} setCfgRescale={setCfgRescale}
            count={count} setCount={setCount} batchMode={batchMode} setBatchMode={setBatchMode} /> : generationParameters}
        </div>}
        <div data-layout-module="operations" style={customModuleStyle("operations")} className="space-y-5">
          {layoutModuleTools("operations")}
          {nlwLayout && <Control label="图片反推">
            <UploadField label="导入反推图片" value={agentImage ? { data: agentImage, name: "反推图片" } : null} onChange={value => setAgentImage(value?.data || null)} />
            {agentImage && <button type="button" className="text-xs text-[var(--muted)]" onClick={() => setAgentImage("")}>移除反推图片</button>}
            <ReplicaReverseTagger source={agentImage ? { data: agentImage, name: "反推图片" } : source} prompt={prompt} model={model} imageProtocol={imageProtocol} onPromptChange={setPrompt} reverseBusy={assistantLoading}
              onReverse={async (options) => { openAssistantPanel(); const ok = await askTagAssistant(naturalImageModel ? "请分析图片并给出适用于当前图像模型的完整场景描述。" : "请分析图片并给出英文生成标签。", { ...options, image: agentImage || source?.data }); if (!ok && !options?.signal?.aborted) throw new Error("视觉反推未完成，请查看助手提示。"); }} />
          </Control>}
          {!customWorkspace && generationModes.has(operation) && (
            <div>
            <Control label={naiLayout ? "提交方式" : `生成张数 · 1–${MAX_NAI_IMAGE_COUNT}`}>
              {!naiLayout && <NumberField
                ariaLabel="生成张数"
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
                  每次独立提交 1 张、最多 {batchConcurrency} 路并发{activeGatewayCapacity ? ` · Gateway 启用 ${activeGatewayCapacity.total} 个账号（V5 ${activeGatewayCapacity.v5}、V4.5 ${activeGatewayCapacity.v45}、允许 Anlas ${activeGatewayCapacity.anlas}）` : providerId === "newapi" && !gatewayImageCapacityChecked ? " · 正在读取 Gateway 实时账号能力" : providerId === "newapi" ? " · Gateway 状态暂不可用，暂按 2 路执行" : ""}，先出先显示；上限 {MAX_NAI_IMAGE_COUNT} 张。
                </p>
              )}
            </Control>
            </div>
          )}

          {!sidebarPromptLayout && characterControls}
          {!naturalImageModel && ["img2img", "inpainting", "edits"].includes(operation) && (
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
        {!naturalImageModel && operation === "vibe-transfer" && (
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
                data-tutorial-editor="inpaint"
                onClick={() => void openImageEditor("inpaint")}
              >
                <Brush size={15} />
                {mask ? "继续重绘" : "独立重绘编辑器"}
              </button>
              <button
                type="button"
                className="flex h-11 w-full items-center justify-center gap-2 rounded border border-[var(--rose)] bg-white px-3 text-xs font-semibold text-[var(--rose)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!source}
                data-tutorial-editor="canvas"
                onClick={() => void openImageEditor("canvas")}
              >
                <Maximize2 size={15} />
                无限画布
              </button>
            </div>
            <button
              type="button"
              className="flex h-10 w-full items-center justify-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-45"
              title="打开全部重绘、无限画布和超分作品的独立历史页面"
              onClick={() => router.push("/image/editor/history")}
            >
              <History size={15} />
              重绘历史记录
            </button>
            {redrawHistoryError && <p className="text-xs text-[var(--rose)]" role="status">{redrawHistoryError}</p>}
            <UploadField
              label={mask ? "蒙版已绘制，也可重新上传" : "或上传蒙版图片"}
              value={mask}
              onChange={setMask}
              onError={setNotice}
            />
          </div>
        )}
        {!naturalImageModel && operation === "upscale" && (
          <>
            <Control label="超分模型">
              <PopupSelect
                value={upscaleModel}
                options={[...NAI_UPSCALE_MODEL_OPTIONS]}
                onChange={setUpscaleModel}
                ariaLabel="超分模型"
              />
            </Control>
            <p className="rounded border border-[var(--line)] bg-[var(--bg2)] p-3 text-xs leading-5 text-[var(--muted)]">
              V5 扩散超分：输出固定为源图的 2 倍，仅接受 PNG。
              {upscaleSource
                ? `当前源图 ${upscaleSource.width}×${upscaleSource.height}，输出 ${upscaleSource.width * 2}×${upscaleSource.height * 2}，优先消耗 ${imageCreditCost({ model: upscaleBillingModel(upscaleModel), operation: "upscale", width: upscaleSource.width, height: upscaleSource.height, steps: 1, samples: 1 })} AFF；图包和个人 AFF 不足时使用站内余额。`
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
        </div>
        <div
          data-layout-module="references"
          data-layout-collapsed={customWorkspace && !customReferenceOpen ? "true" : undefined}
          style={customModuleStyle("references", !customReferenceOpen)}
        >
          {layoutModuleTools("references")}
          {customWorkspace ? <PanelSection title="参考图片" icon={<ImagePlus size={16} />} open={customReferenceOpen} onOpenChange={setCustomReferenceOpen}>
            <ReplicaNaiReference hideGroupLabel model={model} imageProtocol={imageProtocol} operation={operation} source={source} onRemoveSource={() => { setSource(null); setMask(null); }}
              onSelectOperation={(next) => selectOperation(next as Operation)} onUpload={(file) => { setOperation("img2img"); void importImageAndParameters(file); }}
              onOpenEditor={() => void openImageEditor("canvas")} strength={strength} setStrength={setStrength} />
            <div className="custom-reference-more"><button type="button" onClick={() => setGalleryPickerOpen(true)}><Images size={15} /> 从图库选择</button>
              {operation !== "generate" && <button type="button" onClick={() => selectOperation("generate")}><Sparkles size={15} /> 返回文生图</button>}</div>
          </PanelSection> : <PanelSection title="参考图片" icon={<ImagePlus size={16} />} defaultOpen={false}>
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
              {referenceOperations.filter((item) => modelCapabilities.operations.includes(item.id)).map((item) => (
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
              <button type="button" data-tutorial-editor="canvas" className="nai-inline-tool-button" disabled={!source} onClick={() => void openImageEditor("canvas")}><Maximize2 size={15} /> 无限画布</button>
              <label className="nai-inline-tool-button"><FileUp size={15} /> 导入图片<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { void importImageAndParameters(event.target.files?.[0]); event.target.value = ""; }} /></label>
            </div>
            <div className="mt-3">
              <Control label="图片工具">
                <PopupSelect
                  value={toolOperations.some(({ value }) => value === operation) ? operation : "generate"}
                  options={[{ value: "generate", label: "不使用工具" }, ...toolOperations.filter((item) => item.value === "suggest-tags" || modelCapabilities.operations.includes(item.value))]}
                  onChange={(value) => {
                    selectOperation(value as Operation);
                    setNotice("");
                  }}
                  ariaLabel="图片工具"
                />
              </Control>
            </div>
            {!customWorkspace && <div className="mt-3"><div className="nai-section-heading">导演工具</div>{directorTools}</div>}
          </PanelSection>}
        </div>
        {customWorkspace && (
          <div data-layout-module="director" data-layout-collapsed={!customDirectorOpen ? "true" : undefined} style={customModuleStyle("director", !customDirectorOpen)}>
            {layoutModuleTools("director")}
            <PanelSection title="图像工具" icon={<WandSparkles size={16} />} open={customDirectorOpen} onOpenChange={setCustomDirectorOpen}>
              <div className="custom-image-tools">{[...referenceOperations, ...toolOperations.filter((item) => !item.value.startsWith("director-")).map((item) => ({ id: item.value, label: item.label }))].filter((item) => item.id === "suggest-tags" || modelCapabilities.operations.includes(item.id)).map((item) => <button type="button" key={item.id} onClick={() => selectOperation(item.id as Operation)}>{item.label}</button>)}</div>
              {directorTools}
            </PanelSection>
          </div>
        )}
        {(operation === "vibe-transfer" || operation === "precise-reference") && renderReferenceLibrary(operation)}
        {workspaceExtras}
      </div>
    </>
  );

  function cancelImageGeneration() {
    for (const item of imageOperationQueue.items) if (item.status === "running") imageOperationQueue.queue.cancel(item.id);
    generationAbortRef.current?.abort();
  }

  function runOperation(approvedConfirmation?: string, allowAutonomousCost = false, queueRequested = false, queueSignal?: AbortSignal): Promise<void> {
    if (!queueRequested && generationInFlight.current) return imageActiveRequestRef.current ?? Promise.resolve();
    if (!queueRequested && !queueSignal) queuedGenerationApprovalRef.current = null;
    const originGoalId = !queueSignal && !queueRequested && goalRunRef.current?.status === "running" ? goalRunRef.current.id : undefined;
    const request = performImageOperation(approvedConfirmation, allowAutonomousCost, queueRequested, queueSignal, originGoalId);
    if (!queueRequested) { imageActiveRequestRef.current = request; const release = () => { if (imageActiveRequestRef.current === request) imageActiveRequestRef.current = null; }; void request.then(release, release); }
    return request;
  }

  async function performImageOperation(approvedConfirmation?: string, allowAutonomousCost = false, queueRequested = false, queueSignal?: AbortSignal, originGoalId?: string) {
    if (generationInFlight.current && !queueRequested) return;
    if (!model) {
      setNotice("请先选择当前接口可用的图像模型。");
      return;
    }
    if (!signedIn) {
      setNotice(
        authenticated
          ? "登录状态已过期，请重新登录后再提交。"
          : "体验模式不会发送真实请求。登录后可以选择模型来源。",
      );
      return;
    }
    if (providerId === "novelai" && !novelAiConnected) {
      setNotice("NovelAI 官方 Key 已移除，请在设置中重新导入。");
      return;
    }
    if (providerId !== "newapi" && providerId !== "novelai" && !selectedProvider) {
      setNotice("自定义 API 已移除，请重新选择模型来源。");
      return;
    }
    if (!modelOptions.some((item) => item.value === model)) {
      setNotice("请先选择当前来源可用的图像模型。");
      return;
    }
    if (operation !== "suggest-tags" && !modelCapabilities.operations.includes(operation)) {
      setNotice("当前模型不支持这个操作，请选择支持编辑的图像模型。");
      return;
    }
    if (providerId === "novelai") {
      const allowed = new Set<Operation>(["generate", "img2img", "inpainting", "edits", "vibe-transfer", "character-reference", "precise-reference"]);
      if (!allowed.has(operation)) {
        setNotice("这个操作暂不支持 NovelAI 官方来源，请切换模型来源。");
        return;
      }
    }
    const validationError = validateGenerationParameters({
      imageModel: model,
      imageProtocol,
      operation,
      width,
      height,
      steps,
      scale,
      count,
      cfgRescale,
      seed,
      strength,
      source: activeReferenceSelections[0] ?? source,
      mask,
    });
    if (validationError) {
      setNotice(validationError);
      return;
    }
    // 一次性提交走单请求，网关侧单请求上限 8 张；更多张数请逐张提交。
    if (batchMode === "once" && outputCount > (naturalImageModel ? modelCapabilities.maxBatch : naiMaxSamples(width, height, model))) {
      setNotice(`当前模型一次性提交最多 ${naturalImageModel ? modelCapabilities.maxBatch : naiMaxSamples(width, height, model)} 张；更多张数请改用分批次。`);
      return;
    }
    if (localCreditNotice) { setNotice(localCreditNotice); return; }
    const multiImage = generationModes.has(operation) && count > 1;
    const newApiPricedImage = providerId === "newapi" &&
      !["annotate", "suggest-tags"].includes(operation) && (operation !== "upscale" || naturalImageModel);
    const requestLeavesLimit =
      newApiPricedImage &&
      !usesLimitPricing({
        model,
        operation,
        width,
        height,
        steps,
        samples: batchMode === "sequential" ? 1 : outputCount,
        characterPromptCount: operation === "generate" && charactersEnabled
          ? characters.filter((character) => character.prompt.trim()).length
          : 0,
        referenceImageCount,
      });
    if (!naturalImageModel && newApiPricedImage && !canUseAffEstimate && (multiImage || requestLeavesLimit) && estimatedNewApiCost == null) {
      setNotice("暂时无法读取 NewAPI 实际价格，请稍后再试，避免意外扣费。");
      return;
    }
    if (!allowAutonomousCost && (multiImage || (requestLeavesLimit && !canUseAffEstimate) || (operation === "vibe-transfer" && referenceImageCount > encodedVibeCount))) {
      const payment = providerId !== "newapi"
        ? "费用以所选 API 的账单为准"
        : canUseAffEstimate
          ? `预计消耗 ${estimatedAffCost} AFF`
          : estimatedNewApiCost == null ? "当前模型按实际使用计费，费用以所选 API 的账单为准" : `预计扣费 $${estimatedNewApiCost.toFixed(2)}，实际以账单为准`;
      const requestMode = batchMode === "once" && multiImage
        ? `一次性请求 ${count} 张，可能进入高价档`
        : multiImage
          ? "每张独立请求"
          : "当前参数可能进入高价档";
      const confirmation = `将生成 ${outputCount} 张图像（${requestMode}）。\n${payment}${operation === "vibe-transfer" && referenceImageCount > encodedVibeCount ? `\n其中 ${referenceImageCount - encodedVibeCount} 张风格参考需先付费预处理；成功的编码将缓存并在以后复用，生成失败也不会退回已完成的编码费用。` : ""}`;
      if (approvedConfirmation !== confirmation) {
        queuedGenerationApprovalRef.current = queueRequested ? () => { if (imageOwnerRef.current === imageQueueScope) void runOperation(confirmation, allowAutonomousCost, true); } : null;
        setGenerationConfirmation(confirmation);
        return;
      }
    }
    if (queueRequested) {
      const capturedScope = imageQueueScope;
      try { imageOperationQueue.queue.enqueue(`${operation} · ${prompt.slice(0, 80) || "图片任务"}`, async signal => {
        signal.throwIfAborted();
        if (imageOwnerRef.current !== capturedScope || !studioMountedRef.current) throw new Error("账号已切换，此任务已停止。");
        await runOperation(approvedConfirmation, allowAutonomousCost, false, signal);
      }, () => goalRunRef.current?.status === "running" ? new Promise<void>(resolve => window.setTimeout(resolve, 250)) : imageActiveRequestRef.current); setNotice("已加入图片队列；提示词、模型、参考图与生成参数已固定。"); }
      catch (error) {
      if (queueSignal?.aborted) throw error; setNotice(error instanceof Error ? error.message : "图片队列已满。"); }
      return;
    }
    const usageGoalId = originGoalId && goalRunRef.current?.id === originGoalId && goalRunRef.current?.status === "running" ? originGoalId : undefined;
    const fetchGoalImage = async (url: string, init: RequestInit) => {
      generationAbortRef.current?.signal.throwIfAborted();
      queueSignal?.throwIfAborted();
      const response = await fetch(url, { ...init, signal: queueSignal && generationAbortRef.current ? AbortSignal.any([queueSignal, generationAbortRef.current.signal]) : generationAbortRef.current?.signal || init.signal });
      if (usageGoalId) assistantUsage.recordImage(usageGoalId, response.headers.get("x-lfn-request-id"));
      return response;
    };
    generationAbortRef.current = new AbortController();
    generationInFlight.current = true;
    setGenerating(true);
    setImages([]);
    setPreviewDrafts([]);
    setStreamProgress("");
    setSuggestedTags([]);
    setNotice("");
    const base: Record<string, unknown> = {
      operation,
      providerId,
      imageProtocol,
      quality: effectiveImageQuality,
      imageSize: effectiveImageResolution,
      background: imageBackground,
      assistantModel, assistantProviderId, assistantGroup,
      reasoningEffort: storedAssistantReasoning(assistantModel),
      model,
      prompt: composedPromptLayout ? effectivePrompts.prompt : prompt,
      negative_prompt: composedPromptLayout ? effectivePrompts.negative : negative,
      width,
      height,
      steps,
      scale,
      n: outputCount,
      sampler,
      noise_schedule: schedule,
      response_format: "b64_json",
      ...(imageHistoryMode === "none" ? { _lfnSkipServerHistory: true } : {}),
    };
    base._lfnRequestId = createBrowserRequestId();
    if (naturalImageModel && (["img2img", "inpainting", "edits", "upscale"].includes(operation) || operation.startsWith("director-"))) base.image = source?.data;
    if (!mediumEffort && modelCapabilities.sampling && cfgRescale > 0) base.cfg_rescale = cfgRescale;
    if (modelCapabilities.seed && seed.trim() && Number(seed) !== 0) base.seed = Number(seed);
    // 质量词 / UC 预设注入：NAI 默认档交给服务端（qualityToggle + ucPreset），
    // 其余档位按 Aaalice 语义本地注入（质量词→正向末尾，UC→负向前缀），
    // 并关闭服务端同名注入避免重复。
    if (naturalImageModel) {
      // Natural language models receive the composed description and explicit exclusions.
    } else if (composedPromptLayout) {
      // The editor has already composed the selected quality and UC presets.
      base.qualityToggle = false;
      base.ucPreset = 3;
    } else {
    if (qualityTier === "nai-default") {
      base.qualityToggle = true;
    } else {
      const qualityText =
        qualityTier === "custom"
          ? customQuality.trim()
          : qualityTagsForTier(model, qualityTier);
      base.prompt = appendQualityTags(prompt, qualityText);
      base.qualityToggle = false;
    }
    if (ucType === "heavy" || ucType === "custom") {
      base.ucPreset = 0;
      if (ucType === "custom" && customUc.trim()) {
        base.negative_prompt = prependUcPreset(negative, customUc.trim());
      }
    } else {
      base.negative_prompt = prependUcPreset(
        negative,
        ucPresetContent(model, ucType),
      );
      base.ucPreset = 3; // none：UC 已本地注入，关闭服务端追加
    }
    }
    // 多角色：文生图与图生图/局部重绘（带参考图）都可与角色提示词同请求共存，
    // NAI 原生 API 的 v4_prompt.char_captions 与 image/reference 独立编码。
    if (
      ["generate", "img2img", "inpainting"].includes(operation) &&
      modelCapabilities.characters && charactersEnabled &&
      characters.some((character) => character.prompt.trim())
    ) {
      base.characterPrompts = characters
        .filter((character) => character.prompt.trim())
        .map((character) => ({
          prompt: character.prompt.trim(),
          negativePrompt: character.negative?.trim() || "",
          center: { x: character.centerX, y: character.centerY },
        }));
      base.use_coords = !aiAutoPosition;
    }
    if (mediumEffort) {
      base.steps = 14;
      base.sampler = "k_euler_ancestral";
      // Medium rejects cfg_rescale by parameter presence, including an explicit zero.
      delete base.cfg_rescale;
      base.negative_prompt = "";
      base.ucPreset = 0;
      base.tag_hint_uc_preset = 2;
      if (Array.isArray(base.characterPrompts)) {
        base.characterPrompts = (base.characterPrompts as Array<Record<string, unknown>>).map((character) => ({
          ...character,
          negativePrompt: "",
        }));
      }
    }
    if (["img2img", "inpainting", "edits"].includes(operation)) {
      base.image = source?.data;
      base.strength = strength;
    }
    if (["inpainting", "edits"].includes(operation)) base.mask = mask?.data;
    if (operation === "vibe-transfer" || operation === "precise-reference") {
      try { Object.assign(base, await imageReferences.prepare(operation, queueSignal && generationAbortRef.current ? AbortSignal.any([queueSignal, generationAbortRef.current.signal]) : generationAbortRef.current?.signal, activeReferenceSelections)); }
      catch (error) { setNotice(generationAbortRef.current?.signal.aborted ? "已取消参考图预处理。" : error instanceof Error ? error.message : "参考图预处理失败。"); generationInFlight.current = false; generationAbortRef.current = null; setGenerating(false); if (queueSignal) throw error; return; }
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

    if (operation === "annotate") {
      base.image = source?.data;
      base.model = controlModel;
    }
    if (operation.startsWith("director-")) {
      base.image = source?.data;
      base.defry = 1;
    }
    try {
      if (operation === "upscale" && !naturalImageModel) {
        if (!source) throw new Error("请先上传要超分的图片");
        if (!upscaleSource) throw new Error("无法读取源图尺寸，请重新上传");
        if (upscaleSource.width * upscaleSource.height > UPSCALE_MAX_PIXELS)
          throw new Error("源图超过超分上限 1536×2048（3145728 像素），请缩小后再试");
        // 上游只收 PNG；JPEG/WEBP 源图在此统一重编码为 PNG。
        base.image = await toPngDataUrl(source.data);
        base.upscale_model = upscaleModel;
        base.n = 1;
      }
      // 分批次：每片 1 张、最多 2 路在途、错峰 0.5s 启动，
      // 网关会把并发请求分摊到多个启用账号；一次性保持单请求 n 张（≤8）。
      // 超分单次固定 1 张，避免重复扣费。
      const sequential = batchMode === "sequential" && outputCount > 1;
      const collected: string[] = [];
      const collectedHistoryIds: string[] = [];
      const chunkImagesByIndex: string[][] = [];
      const chunkHistoryByIndex: string[][] = [];
      const chunkRequestIdsByIndex: string[][] = [];
      let usedNewApi = false;
      let failures = 0;
      let lastError = "";
      let partialMessage = "";
      if (sequential) {
        const BATCH_CHUNK = studioBatchSize(batchMode);
        const BATCH_PARALLEL = Math.max(1, batchConcurrency);
        const chunkSizes = splitImageBatches(count, BATCH_CHUNK);
        let chunkOffset = 0;
        const chunkStarts = chunkSizes.map((size) => {
          const start = chunkOffset;
          chunkOffset += size;
          return start;
        });
        // 各分片携带“基础种子 + 片内起始偏移”，与 NAI 单请求多张的种子序列
        // 语义一致；不填种子时客户端随机一个基础种子，避免分片间重复出图。
        const baseSeed = seed.trim() && Number(seed.trim()) !== 0
          ? Number(seed.trim())
          : Math.floor(Math.random() * 2 ** 32);
        const previewMap = new Map<string, string>();
        let doneImages = 0;
        let nextChunk = 0;
        const runChunk = async (chunkIndex: number) => {
          const size = chunkSizes[chunkIndex];
          const response = await fetchGoalImage("/api/images/operate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...base,
              n: size,
              n_samples: size,
              ...(modelCapabilities.seed ? { seed: (baseSeed + chunkStarts[chunkIndex]) % 2 ** 32 } : {}),
            }),
          });
          const contentType = response.headers.get("content-type") || "";
          let chunkImages: string[] = [];
          let chunkHistoryIds: string[] = [];
          let chunkRequestId: string | undefined;
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
              onComplete(historyIds, requestId) {
                chunkHistoryIds = historyIds;
                chunkRequestId = requestId;
              },
            });
          } else {
            const result = await readImageOperationResponse(response);
            if (!response.ok && !result.images)
              throw new Error(result.message || "操作失败");
            chunkImages = result.images || (result.image ? [result.image] : []);
            if (result.payment === "newapi") usedNewApi = true;
            chunkHistoryIds = imageHistoryReferences(chunkImages, result.historyIds).historyIds;
            chunkRequestId = result.requestId;
            if (result.partial)
              partialMessage = result.message || "部分批次生成失败。";
          }
          chunkImagesByIndex[chunkIndex] = chunkImages;
          const references = imageHistoryReferences(chunkImages, chunkHistoryIds, chunkRequestId);
          chunkHistoryByIndex[chunkIndex] = references.historyIds;
          chunkRequestIdsByIndex[chunkIndex] = references.requestIds;
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
              while ((nextChunk < chunkSizes.length && !generationAbortRef.current?.signal.aborted) && !queueSignal?.aborted) {
                const chunkIndex = nextChunk;
                nextChunk += 1;
                // 按片序号错峰启动，避免瞬时并发挤满网关队列。
                await new Promise((resolve) =>
                  setTimeout(resolve, 500 * chunkIndex),
                );
                try {
                  await runChunk(chunkIndex);
                } catch (error) {
      if (queueSignal?.aborted) throw error;
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
        await addSessionResults(collected, collectedHistoryIds, operation, {}, chunkRequestIdsByIndex.flat(), usageGoalId);
      } else {
        const response = await fetchGoalImage("/api/images/operate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        });
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream") && response.body) {
          let batchHistoryIds: string[] = [];
          let batchRequestId: string | undefined;
          const batchImages = await consumeImageStream(response, {
            expected: outputCount,
            onPreview(next) {
              setPreviewDrafts(next);
            },
            onComplete(historyIds, requestId) {
              batchHistoryIds = historyIds;
              batchRequestId = requestId;
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
          await addSessionResults(batchImages, batchHistoryIds, operation, {}, batchRequestId ? batchImages.map(() => batchRequestId as string) : [], usageGoalId);
        } else {
          const result = await readImageOperationResponse(response);
          if (!response.ok && !result.images)
            throw new Error(result.message || "操作失败");
          if (operation === "suggest-tags") {
            if (typeof result.prompt === "string" && result.prompt.trim()) setPrompt(result.prompt);
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
          const references = imageHistoryReferences(newImages, result.historyIds, result.requestId);
          setImages(newImages);
          setSelectedImageIndex(0);
          await addSessionResults(newImages, references.historyIds, operation, {}, references.requestIds, usageGoalId);
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
          setNotice(naturalImageModel ? "图像已生成，本次使用 NewAPI 余额支付。" : "AFF 余额不足，本次已使用 NewAPI 余额支付。");
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
      if (queueSignal) throw error;
      setNotice(
        error instanceof Error ? error.message : "操作失败，请稍后重试",
      );
    } finally {
      const generationWasCancelled = Boolean(generationAbortRef.current?.signal.aborted || queueSignal?.aborted);
      if (generationWasCancelled) setNotice("已停止当前生成；已经返回的图片保留在当前结果中。");
      generationAbortRef.current = null;
      generationInFlight.current = false;
      setBatchProgress("");
      setStreamProgress("");
      setGenerating(false);
      if (usageGoalId) void assistantUsage.refresh();
      const goalReview = goalReviewImageRef.current;
      const goalImage = usageGoalId && goalReview?.goalId === usageGoalId && goalRunRef.current?.id === usageGoalId ? goalReview.image : null;
      if (usageGoalId && goalReview?.goalId === usageGoalId) goalReviewImageRef.current = null;
      if (!generationWasCancelled && goalImage && usageGoalId && goalRunRef.current?.id === usageGoalId && goalRunRef.current?.status === "running") window.setTimeout(() => { if (goalRunRef.current?.id === usageGoalId && goalRunRef.current?.status === "running") void reviewGoalResult(goalImage); }, 0);
    }
  }

  const activeCharacterCount =
    operation === "generate" && charactersEnabled
      ? characters.filter((character) => character.prompt.trim()).length
      : 0;
  // 超分按源图尺寸计 Anlas；本站价格统一读取当前服务端配置。
  // 管理员配置了固定 AFF 单价的模型优先按固定价 × 张数。
  const upscaleDims = operation === "upscale" ? upscaleSource : null;
  const localPricePolicy = creditPricing.data?.policy ?? wallet?.dailyBilling?.policy;
  const pricingModel = operation === "upscale" && !naturalImageModel ? upscaleBillingModel(upscaleModel) : model;
  const affFixedCost = creditPricing.data
    ? creditPricing.data.fixedCosts[pricingModel] ?? null
    : typeof (modelPricing as unknown as { affFixedCost?: unknown } | null)?.affFixedCost === "number"
      ? (modelPricing as unknown as { affFixedCost: number }).affFixedCost : null;
  const affGeneration = {
          model: operation === "upscale" && !naturalImageModel ? upscaleBillingModel(upscaleModel) : model,
          operation,
          width: upscaleDims ? upscaleDims.width : width,
          height: upscaleDims ? upscaleDims.height : height,
          steps,
          samples: outputCount,
          sequential: batchMode === "sequential" && outputCount > 1,
          strength: imagePricingStrength({ strength }, operation),
          referenceImageCount,
          encodedVibeCount,
          characterPromptCount: activeCharacterCount,
        };
  const dailyFamily = dailyImageFamily(affGeneration);
  const dailyQuote = wallet?.dailyBilling && localPricePolicy && dailyFamily && affFixedCost == null
    ? quoteDailyImage(affGeneration, localPricePolicy, wallet.dailyBilling.cnyPerAff, wallet.dailyBilling.day === dailyImageDay() ? wallet.dailyBilling.counts[dailyFamily] : 0)
    : null;
  const estimatedAffCost = dailyQuote?.costAff ?? imageCreditCost(affGeneration, affFixedCost, localPricePolicy);
  const estimatedNewApiCost = providerId !== "newapi" || ["annotate", "suggest-tags"].includes(operation) || (operation === "upscale" && !naturalImageModel && !upscaleDims) || (naturalImageModel && modelPricing?.quotaType !== 1) ? null : estimateNewApiCost(modelPricing, {
    model: operation === "upscale" && !naturalImageModel ? upscaleBillingModel(upscaleModel) : model, operation, maxSamplesPerRequest: studioBatchSize(batchMode), width: upscaleDims?.width ?? width,
    height: upscaleDims?.height ?? height, steps,
    samples: outputCount,
    characterPromptCount: activeCharacterCount,
    strength: imagePricingStrength({ strength }, operation),
    referenceImageCount,
    encodedVibeCount,
  });
  const packageRateImages = Math.min(
    outputCount,
    wallet?.aff?.packageBalance && wallet.aff.packageRateLimitRemaining > 0
      ? wallet.aff.packageRateLimitRemaining
      : 0,
  );
  const estimatedPackageCost = wallet?.aff?.enabled
    ? splitImageCreditCost(estimatedAffCost, outputCount, wallet.aff.packageBalance, packageRateImages, dailyQuote?.affCosts).packageCost
    : 0;
  const estimatedPersonalCost = roundAffAmount(estimatedAffCost - estimatedPackageCost);
  const requiresLocalBilling = providerId === "newapi" && !naturalImageModel && wallet?.dailyBilling?.policy.strictApiBilling === true;
  const hasSufficientAff = Boolean(wallet?.aff?.enabled && wallet.aff.balance >= estimatedPersonalCost && wallet.aff.packageBalance >= estimatedPackageCost);
  // The price display follows the required wallet even when its balance is insufficient.
  const canUseAffEstimate = providerId === "newapi" && !naturalImageModel && (requiresLocalBilling || hasSufficientAff);
  const localAffShortfall = Math.max(0, Math.round((estimatedPersonalCost - (wallet?.aff?.balance ?? 0)) * 10000) / 10000);
  const localCreditNotice = requiresLocalBilling && wallet?.aff
    ? !wallet.aff.enabled ? "当前模型的本站额度服务尚未就绪，请刷新后重试。"
      : localAffShortfall > 0 ? `本次预计消耗 ${estimatedAffCost} AFF，当前可用个人 AFF ${wallet.aff.balance}、图包 ${wallet.aff.packageBalance}，个人 AFF 尚缺 ${localAffShortfall}。此模型使用本站额度，NewAPI 余额不参与本次扣费。` : ""
    : "";

  const pricingDetails = (children?: React.ReactNode, className?: string) => (
    <CreditPricingButton pricing={creditPricing} generation={affGeneration} state={wallet?.dailyBilling}
      wallet={wallet?.aff} usesAff={canUseAffEstimate} onRefresh={refreshWallet} className={className}
      paymentNote={providerId !== "newapi" ? "当前使用个人 Key，实际费用以提供方账单为准。下面展示本站 AFF / 图包价格，供对比。" : canUseAffEstimate ? "当前使用本站 AFF / 图包，图包优先，个人 AFF 补足。" : "当前按 NewAPI 自身价格与余额计费。下面的 AFF / 图包规则仅作对比，不是本次 NewAPI 账单。"}>
      {children}
    </CreditPricingButton>
  );

  // 右侧功能区：标签助手 + 会话状态（桌面侧栏与移动抽屉共用）。
  // NAI 主题下创作入口移入左上角「站内菜单」，其他主题保留创作中心。
  const sessionHistoryPanel = (
    <section className="session-history-panel" data-layout-module="history" style={customModuleStyle("history")} aria-label="本次会话历史">
      {layoutModuleTools("history")}
      <div className="flex items-center justify-between gap-2">
        <b className="text-xs">本次历史</b>
        <span className="text-[10px] text-[var(--muted)]">{sessionHistory.length} 张</span>
      </div>
      <label className="mt-2 flex items-center justify-between gap-2 rounded border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-1.5 text-[10px] text-[var(--muted)]">
        <span>图片历史保存</span>
        <LfnSelect className="bg-transparent text-[10px] font-semibold text-[var(--ink)] outline-none" value={imageHistoryMode} onChange={(event) => {
          const next = event.target.value as ImageHistoryMode;
          setImageHistoryMode(next);
          try { window.localStorage.setItem("lfn-image-history-mode-v1", next); window.dispatchEvent(new CustomEvent("lfn-image-history-mode", { detail: next })); } catch { setNotice("无法保存图片历史设置，请检查浏览器存储权限。"); }
        }} aria-label="图片历史保存方式">
          <option value="account">保存到 LFN</option><option value="local">仅保存本机</option><option value="none">不保存</option>
        </LfnSelect>
      </label>
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

  // 创作中心入口：左侧独立导航栏（展开态）与移动抽屉共用。
  const creativeCenterLinks = (
    <nav className="grid grid-cols-2 gap-2">
      {CREATIVE_CENTER_LINKS.map((link) => (
        <FeatureLink key={link.href} href={link.href} label={link.label} icon={link.icon} />
      ))}
      {isAdmin && (
        <FeatureLink href="/admin" label="管理" icon={<ShieldCheck size={15} />} />
      )}
    </nav>
  );

  // 标签助手内容保持挂载，切换标签、折叠和浮窗均保留输入与对话。
  const agentBlockInner = (
    <TagAssistantPanel signedIn={signedIn} natural={naturalImageModel} imageModel={model}
      style={layoutEditorOpen ? customModuleStyle("agent") : undefined} tools={layoutModuleTools("agent")}
      mode={assistantMode} onModeChange={setAssistantMode} autonomy={autonomyMode} onAutonomyChange={setAutonomyMode}
      rounds={goalMaxRounds} onRoundsChange={setGoalMaxRounds} goal={goalRun} onStopGoal={stopGoalAgent} onClearGoal={() => updateGoalRun(null)}
      modelControl={assistantSelection.control} sessionControl={assistantConversations.control}
      usage={assistantUsage} input={agentInput} onInputChange={setAgentInput} onSubmit={submitAssistantMessage} onQueue={signedIn && assistantModel ? submitAssistantMessage : undefined}
      queueRunning={assistantMessageQueue.running} messageQueue={assistantMessageQueue.items}
      onRemoveQueued={(id) => assistantMessageQueue.queue.cancel(id)}
      onClearQueued={() => assistantMessageQueue.pending.forEach((item) => assistantMessageQueue.queue.cancel(item.id))}
      onClearQueueHistory={() => assistantMessageQueue.queue.clearFinished()}
      onCancel={() => { const current = assistantMessageQueue.items.find((item) => item.status === "running"); if (current) assistantMessageQueue.queue.cancel(current.id); cancelAssistantTask(); }}
      loading={assistantLoading} searching={tagSearching} error={assistantTaskError}
      resourceScope={assistantResourceScope} imageResources={[...sessionHistory.map((item, index) => ({ id: `history:${item.id}`, source: item.image, name: `生成图片 ${index + 1}`, kind: "history" as const, description: `${item.width}×${item.height} · ${item.prompt.slice(0, 160)}` })), ...imageReferences.library.map(item => ({ id: `library:${item.id}`, source: item.data, name: item.name, kind: "library" as const }))]}
      onAddImageSources={sources => { if (agentImagesRef.current.length >= MAX_ASSISTANT_IMAGES) { setNotice("参考图已满，请先移除不需要的图片。"); return; } void assistantImageSources.addSources(sources.slice(0, MAX_ASSISTANT_IMAGES - agentImagesRef.current.length)); }} onCancelImageImport={cancelAgentImageImport}
      images={agentImagesScope === assistantResourceScope ? agentImages : []} imagesLoading={(agentImagesScope === assistantResourceScope && agentImagesLoading) || assistantImageSources.loading} onAddImages={files => { void handleAgentImageFiles(files); }}
      onRemoveImage={index => updateAgentImages(agentImagesRef.current.filter((_, i) => i !== index))}
      onClearImages={() => setAgentImage(null)} onPreviewImage={setAgentPreview}
      conversation={conversation} onClearConversation={() => { void (async () => {
        if (await lfnConfirm("确定清空助手对话记录？历史轮次与累积标签都会删除。")) void clearConversationHistory();
      })(); }}
      steps={agentSteps} results={tagResults} onAppendTag={appendTag}
      suggestion={assistantSuggestion && (!assistantSuggestion.imageModel || (assistantSuggestion.imageModel === model && assistantSuggestion.modelProtocol === imageProtocol)) ? assistantSuggestion : null}
      onReplacePrompt={() => { if (assistantSuggestion) { setPrompt(assistantSuggestion.prompt); if (naturalImageModel) setNegative(assistantSuggestion.negativePrompt || ""); } }}
      onReplaceNegative={() => { if (assistantSuggestion) setNegative(assistantSuggestion.negativePrompt); }}
      onApplyParameters={() => { if (assistantSuggestion) applySuggestedParameters(assistantSuggestion.parameters); }}
      onApplyAll={applyAllSuggestions} onDismissSuggestion={() => setAssistantSuggestion(null)} />
  );

  // 会话状态（钱包）：左侧导航栏展开态、NAI overlay 与移动抽屉共用。
  const walletBlock = (
          <div className="studio-session-state p-4" data-layout-module="session">
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
  );

  // 布局编辑器的独立模块预览。
  const toolsPanel = (
    <>
      {sessionHistoryPanel}
      {!naiLayout && (
        <div className="studio-custom-nav border-b border-[var(--line)] p-4" data-layout-module="navigation">
          <b className="text-sm">创作中心</b>
          <div className="mt-3">{creativeCenterLinks}</div>
        </div>
      )}
      {agentBlockInner}
      {walletBlock}
    </>
  );

  const legacyGenerationFooter = (
    <div className="nai-generation-footer" data-layout-module="generate">
      {!sidebarPromptLayout && generationParameters}
      {operation !== "suggest-tags" && providerId === "newapi" && (
        <NaiBalanceMeter
          signedIn={signedIn}
          unit={canUseAffEstimate ? "AFF" : "USD"}
          balance={canUseAffEstimate ? wallet?.aff?.totalBalance : me?.user?.balance}
          cost={canUseAffEstimate ? estimatedAffCost : estimatedNewApiCost}
        />
      )}
      {operation !== "suggest-tags" && providerId !== "newapi" && (
        <span className="text-xs text-[var(--muted)]">个人 Key · 费用以提供方账单为准</span>
      )}
      {modelCapabilities.seed && <SeedModeNotice seed={seed} onRandom={() => setSeed("")} />}
      {operation !== "suggest-tags" && pricingDetails()}
      <div className="nai-generation-action">
        <button
          data-studio-generate={generating ? undefined : true}
              data-studio-cancel={generating || undefined}
              aria-label={generating ? "取消当前生成" : undefined}
          onClick={generating ? () => cancelImageGeneration() : handleStudioGenerationClick}
          disabled={!generating && (layoutEditorOpen || !model)}
          title={
            providerId !== "newapi"
              ? "使用个人 API Key；费用以提供方账单为准"
              : canUseAffEstimate
              ? localCreditNotice || `图包 -${estimatedPackageCost} / 个人 -${estimatedPersonalCost} · 余量 ${wallet?.aff?.packageBalance ?? 0} / ${wallet?.aff?.balance ?? 0}`
              : modelPricing
                ? `$上游 {modelPricing.effectiveGroup} × ${modelPricing.groupRatio} 倍率；实际以账单为准 · 按 NewAPI 余额计费`
                : undefined
          }
          className="nai-generate-button"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={18} />{generating && <span>取消当前生成</span>}
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
          {!generating && operation !== "suggest-tags" && providerId === "newapi" && (canUseAffEstimate || estimatedNewApiCost != null) && (
            <span className="nai-cost-badge" title={canUseAffEstimate ? "预计创作额度" : "按当前 NewAPI 配置预估，实际以账单为准"}>
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

  const assistantPanel = agentBlockInner;

  const replicaVariant = naiLayout ? "nai" as const : "nlw" as const;
  const replicaBalance = providerId === "newapi"
    ? !signedIn ? "体验模式" : canUseAffEstimate ? String(wallet?.aff?.totalBalance ?? "读取中") : me?.user?.balance?.toFixed(2) ?? "读取中"
    : "个人 Key";
  function renderReferenceLibrary(kind: ImageReferenceKind) {
    const props: ReferenceLibraryProps = { kind, references: referenceSelections(kind), library: imageReferences.library, encodings: imageReferences.encodings, encodingId: imageReferences.encodingId, disabled: generating,
      onAdd: imageReferences.add, onUpdate: (mode,id,change) => { if (id === "source" && !imageReferences.baskets[mode].length) imageReferences.replace(mode, referenceSelections(mode).map(item => ({ ...item, ...change }))); else imageReferences.update(mode,id,change); },
      onRemove: (mode,id) => { if (imageReferences.baskets[mode].length <= 1) { setSource(null); setMask(null); } imageReferences.remove(mode,id); },
      onReplace: imageReferences.replace, onSave: imageReferences.save, onDeleteSaved: imageReferences.removeSaved, onEncode: imageReferences.encode, onCancelEncoding: imageReferences.cancelEncoding, onClearCache: imageReferences.clearCache, onNotice: setNotice };
    return <ReferenceLibrary {...props}/>;
  }
  async function returnComicCandidates() {
    if (!comicDestination || !images.length) return;
    try { await appendComicCandidates(signedIn && userId ? String(userId) : "guest", comicDestination.projectId, comicDestination.panelId, images.map((image, index) => ({ id: crypto.randomUUID(), image, prompt, createdAt: Date.now() + index }))); setNotice("已加入分镜候选，可返回漫画工作台选择图片和编辑对白。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "无法保存分镜候选，请返回漫画工作台确认项目仍存在。"); }
  }

  const controls = <>{replicaLayout ? <><ReplicaControls referenceLibrary={{ "vibe-transfer": renderReferenceLibrary("vibe-transfer"), "precise-reference": renderReferenceLibrary("precise-reference") }} variant={replicaVariant} parameterFooter={<>{replicaVariant === "nai" && (operation === "vibe-transfer" || operation === "precise-reference") && renderReferenceLibrary(operation)}{workspaceExtras}</>}
    prompt={prompt} negative={negative} model={model} imageProtocol={imageProtocol} operation={operation} assistantModel={assistantModel} assistantProviderId={assistantProviderId} assistantGroup={assistantGroup} historyPrompts={sessionHistory.map((item) => item.prompt)}
    onPromptChange={setPrompt} onNegativeChange={setNegative} onEffectiveChange={setEffectivePrompts}
    onAssistant={(text) => { setAgentInput(text); openAssistantPanel(); }}
    width={width} height={height} count={count} setWidth={setWidth} setHeight={setHeight} setCount={setCount}
    seed={seed} setSeed={setSeed} characters={characters} setCharacters={setCharacters}
    charactersEnabled={charactersEnabled} setCharactersEnabled={setCharactersEnabled}
    aiAutoPosition={aiAutoPosition} setAiAutoPosition={setAiAutoPosition} renderCharacterReference={renderCharacterReference}
    source={source} onRemoveSource={() => { setSource(null); setMask(null); }}
    reverseSource={agentImage ? { data: agentImage, name: "反推图片" } : null} onRemoveReverseSource={() => setAgentImage("")}
    onUpload={(file, nextOperation) => {
      const validation = validateUploadFile(file);
      if (validation) { setNotice(validation); return; }
      const reader = new FileReader();
      reader.onerror = () => setNotice("读取图片失败，请重试。");
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        if (nextOperation === "suggest-tags") { setAgentImage(reader.result); return; }
        if (nextOperation === "vibe-transfer" || nextOperation === "precise-reference") imageReferences.add(nextOperation, { id: crypto.randomUUID(), data: reader.result as string, name: file.name, createdAt: Date.now() });
      setSource({ data: reader.result, name: file.name }); setMask(null);
        setOperation(nextOperation as Operation);
        if (nextOperation === "inpainting" || nextOperation === "edits") {
          const inpaintModel = inpaintModelFor(model, imageProtocol);
          if (inpaintModel && inpaintModel !== model && modelOptions.some((item) => item.value === inpaintModel)) { generationModelBeforeInpaint.current = model; setModel(inpaintModel); }
        }
        if (nextOperation === "suggest-tags") setAgentImage(reader.result);
        setNotice("已载入图片。");
      };
      reader.readAsDataURL(file);
    }}
    onSelectOperation={(value) => selectOperation(value as Operation)}
    onOpenEditor={() => void openImageEditor("canvas")} onOpenMaskEditor={() => void openImageEditor("inpaint")} onGallery={(value) => { setReplicaGalleryOperation(value as Operation); setGalleryPickerOpen(true); }}
    reverseBusy={assistantLoading}
    onReverse={async (options) => { openAssistantPanel(); const ok = await askTagAssistant(naturalImageModel ? "请分析这张图片并给出可用于当前图像模型生成或编辑的完整场景描述。" : "请分析这张图片并给出可用于图像生成的英文标签。", { ...options, image: agentImage || source?.data }); if (!ok && !options?.signal?.aborted) throw new Error("视觉反推未完成，请查看助手提示并确认已选择可用视觉模型。"); }}
    onMenu={() => setMenuOpen(true)} onCollapse={() => setNlwLeftCollapsed(true)}
    modelControls={modelModeControls} balance={replicaBalance}
    strength={strength} setStrength={setStrength} vibeStrength={vibeStrength} setVibeStrength={setVibeStrength}
    vibeInformationExtracted={vibeInformationExtracted} setVibeInformationExtracted={setVibeInformationExtracted}
    referenceType={referenceType} setReferenceType={setReferenceType}
  /></> : <>{legacyControls}</>}</>;
  const naiGenerationFooter = replicaLayout || customWorkspace ? <ReplicaGenerationFooter variant={customWorkspace ? "nai" : replicaVariant}
    settings={customWorkspace ? <div className="custom-generation-meta"><span>{count} 张图像</span><button type="button" aria-label="切换提交方式" onClick={() => setBatchMode(batchMode === "once" ? "sequential" : "once")}>{batchMode === "once" ? "一次性" : "分批次"}</button></div> : <ReplicaGenerationSettings variant={replicaVariant} model={modelOptions.find(item => item.value === model)?.label || model} modelControls={modelModeControls} naturalSettings={naturalSettings}
      steps={steps} scale={scale} seed={seed} sampler={sampler} schedule={schedule} cfgRescale={cfgRescale}
      setSteps={setSteps} setScale={setScale} setSeed={setSeed} setSampler={setSampler} setSchedule={setSchedule} setCfgRescale={setCfgRescale}
      count={count} setCount={setCount} batchMode={batchMode} setBatchMode={setBatchMode} />}
    pricingControl={operation !== "suggest-tags" ? pricingDetails() : undefined}
    seedControl={modelCapabilities.seed ? <SeedModeNotice seed={seed} onRandom={() => setSeed("")} /> : undefined}
    generating={generating} disabled={layoutEditorOpen || !model} progress={streamProgress || batchProgress}
    operationLabel={generationModes.has(operation) ? "生成" : `执行${modes.find(item => item.id === operation)?.label ?? "工具"}`}
    balance={replicaBalance} cost={providerId !== "newapi" ? "" : canUseAffEstimate ? `${estimatedAffCost} AFF` : estimatedNewApiCost != null ? `$${estimatedNewApiCost.toFixed(2)}` : ""}
    count={outputCount} batchMode={batchMode} onBatchModeChange={setBatchMode} onRun={handleStudioGenerationClick}
      onCancel={() => cancelImageGeneration()}
  /> : legacyGenerationFooter;
  function reuseHistory(item: ReplicaHistoryItem, nextOperation: string) {
    if (nextOperation === "reuse-parameters") {
      if (metadataRestore.preferences.characters) restoreCharacterParameters(item, true);
      if (metadataRestore.preferences.model && item.providerId && item.providerId !== "newapi" && item.providerId !== "novelai" && !customProviders.some(provider => provider.id === item.providerId)) {
        setNotice("这张历史图片的 API 来源已移除，请先重新配置来源。"); return;
      }
      if (metadataRestore.preferences.model) {
      if (item.providerId) setProviderId(item.providerId);
      if (item.model) setModel(item.model);
      if (item.providerId === "newapi" && item.imageProtocol) setNewApiImageProtocol(item.imageProtocol);
      if (item.quality) setImageQuality(item.quality);
      if (item.imageSize) setImageResolution(item.imageSize);
      if (item.background) setImageBackground(item.background);
      }
      const targetModel = metadataRestore.preferences.model ? item.model || model : model;
      const targetProtocol = metadataRestore.preferences.model ? item.imageProtocol || imageProtocol : imageProtocol;
      const size = normalizeImageModelSize(targetModel, item.width, item.height, targetProtocol);
      if (metadataRestore.preferences.prompts) { setPrompt(item.prompt); setNegative(item.negative); }
      if (metadataRestore.preferences.dimensions) { setWidth(size.width); setHeight(size.height); }
      if (metadataRestore.preferences.sampling) { setSteps(item.steps); setScale(item.scale); setSampler(item.sampler); if (item.noise_schedule) setSchedule(item.noise_schedule); }
      if (metadataRestore.preferences.seed) setSeed(item.seed == null || item.seed === 0 ? "" : String(item.seed));
      setOperation("generate");
    } else applyImageAsSource(item.image, nextOperation as Operation);
  }
  async function deleteStudioHistory(item: SessionResult | undefined) {
    if (!item || !(await lfnConfirm("确认删除这张历史图片？"))) return;
    try {
      if (imageHistoryMode === "account" && item.historyId) {
        const response = await fetch(`/api/history?id=${encodeURIComponent(item.historyId)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("删除失败，历史记录已保留，请重试。");
      }
      const local = await findLocalImageHistory(item.historyId || item.id).catch(() => null);
      if (local) await deleteLocalImageHistory(local.id);
      const key = studioHistoryKey(item);
      setSessionHistory(current => current.filter(saved => studioHistoryKey(saved) !== key));
    } catch (error) { setNotice(error instanceof Error ? error.message : "删除历史失败，请重试。"); }
  }
  const replicaHistoryPanel = <ReplicaHistory items={sessionHistory} onOpen={(item) => { setImages([item.image]); setLightboxIndex(0); }}
    onUse={reuseHistory} onDelete={(index) => void deleteStudioHistory(sessionHistory[index])} />;


  return (
    <PromptVersionProvider prompt={prompt} negative={negative} scope={userId ? String(userId) : "guest"} onRestore={(target, text) => (target === "prompt" ? setPrompt : setNegative)(text)}>
    <main
      data-studio-layout={naiLayout ? "nai" : "classic"}
      data-tutorial-source-ready={Boolean(source)}
      data-workspace-layout={!naiLayout ? (customWorkspace ? "custom" : preferences.workspaceLayout) : undefined}
      data-replica-studio={replicaLayout ? replicaVariant : undefined}
      data-aaalice-dock={aaaliceDock ? "true" : undefined}
      data-has-images={displayedImages.length > 0 ? "true" : "false"}
      data-left-collapsed={nlwLayout && nlwLeftCollapsed ? "true" : undefined}
      className="flex h-[100dvh] min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden bg-[var(--paper)]"
    >
      {!replicaLayout && (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[#fffefa]/95 px-4">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="返回 Love for NAI 首页" className="flex items-center gap-3">
              <Aperture className="text-[var(--rose)]" size={23} />
              <span className="font-[var(--font-display)] text-lg font-bold">Love for NAI</span>
            </Link>
            <span className="hidden text-[10px] text-[var(--muted)] sm:inline">
              IMAGE STUDIO
            </span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
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
              title="打开账号中心"
              href="/profile"
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
                href="/profile#profile-wallet"
                title="我的账号：资料、钱包、签到与邀请"
                className="flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm hover:border-[var(--rose)]"
              >
                {userId ? <UserAvatar userId={userId} name={userName} size={24} /> : <UserRound size={16} />}
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
      {layoutEditorOpen && (
          <div className="layout-editor-toolbar" role="toolbar" aria-label="自定义工作台布局编辑器">
            <span className="layout-editor-title">图片工作台布局</span>
            <span className="layout-editor-hint">用模块把手拖动排序；− / + 调整高度，眼睛切换显示</span>
            <label className="layout-editor-width">左栏 <input aria-label="左栏宽度" type="number" min={240} max={520} value={leftWidth} onChange={(event) => { const value = Number(event.target.value); if (value >= 240 && value <= 520) { setClassicLeftWidth(value); setCustomLayout((current) => ({ ...current, leftWidth: value })); } }} />px</label>
            <label className="layout-editor-width">右栏 <input aria-label="右栏宽度" type="number" min={200} max={460} value={rightWidth} onChange={(event) => { const value = Number(event.target.value); if (value >= 200 && value <= 460) { setRightWidth(value); setCustomLayout((current) => ({ ...current, rightWidth: value })); } }} />px</label>
            <div className="layout-editor-visibility" aria-label="模块显隐">
              {(["model", "prompt", "image", "sampling", "references", "operations", "history", "agent"] as CustomLayoutModule[]).map((moduleId) => (
                <button key={moduleId} type="button" aria-pressed={customLayout.visibleModules[moduleId]} onClick={() => toggleLayoutModule(moduleId)}>{moduleId}</button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                saveCustomLayout({ ...customLayout, leftWidth, rightWidth });
                updatePreferences({ workspaceLayout: "custom", theme: preferences.theme === "nai" ? "paper" : preferences.theme });
                setLayoutEditorOpen(false);
                router.replace("/image");
              }}
              className="layout-editor-action is-primary"
            >
              <Save size={15} />保存布局
            </button>
            <button
              type="button"
              onClick={() => setCustomLayout(loadCustomLayout())}
              className="layout-editor-action"
            >
              <RotateCcw size={15} />恢复已保存
            </button>
            <button
              type="button"
              onClick={() => {
                setLayoutEditorOpen(false);
                router.replace("/image");
              }}
              className="layout-editor-action"
            >
              退出编辑
            </button>
          </div>
        )}
      <div
        className={`studio-layout grid min-h-0 flex-1${customWorkspace ? " is-custom-layout" : ""}`}
        data-layout-editor-board={layoutEditorOpen ? "true" : undefined}
        style={
          {
            "--lfn-left": `${leftWidth}px`,
            "--lfn-right": `${aaaliceDock && replicaDockCollapsed ? 40 : rightWidth}px`,
            "--lfn-nav-rail": navRailExpanded ? "220px" : "56px",
          } as React.CSSProperties
        }
      >
        {nlwLayout && <ReplicaNavigation onMenu={() => setMenuOpen(true)} onAssistant={() => setReplicaAssistantOpenRequest(value => value + 1)} />}
        {nlwLayout && nlwLeftCollapsed && <button type="button" className="replica-left-rail hidden" onClick={() => setNlwLeftCollapsed(false)} aria-label="展开参数栏"><ChevronRight size={18} />参数</button>}
        {customWorkspace && !layoutEditorOpen && <Link className="layout-editor-entry" href="/image/setting/layout"><Move size={14} />编辑布局</Link>}
        {!replicaLayout && !layoutEditorOpen && (
          // 最左侧功能导航栏（new-api/Aaalice 式）：折叠为纯图标，展开显示
          // 创作中心与会话状态；不随悬停自动收起。
          <aside
            className={`studio-nav-rail panel flex min-h-0 flex-col border-y-0 border-l-0${navRailExpanded ? " is-expanded" : ""}`}
          >
            <div className="studio-nav-header">
            <button
              type="button"
              className="studio-nav-toggle"
              aria-label={navRailExpanded ? "折叠导航栏" : "展开导航栏"}
              aria-expanded={navRailExpanded}
              onClick={() => {
                const next = !navRailExpanded;
                setNavRailExpanded(next);
                window.localStorage.setItem("lfn-nav-rail-expanded", next ? "1" : "0");
              }}
            >
              {navRailExpanded ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
            </button>
            {navRailExpanded && <b className="text-sm">创作中心</b>}
            </div>
            {navRailExpanded ? (
              <>
                <div className="studio-nav-links min-h-0 flex-1 overflow-y-auto">
                  {creativeCenterLinks}
                </div>
                {walletBlock}
              </>
            ) : (
              <nav className="tools-icon-rail" aria-label="功能入口">
                {(isAdmin
                  ? [...CREATIVE_CENTER_LINKS, { href: "/admin", label: "管理", icon: <ShieldCheck size={16} /> }]
                  : CREATIVE_CENTER_LINKS
                ).map((link) => (
                  <Tooltip key={link.href} label={link.label}>
                    <Link href={link.href} className="tools-icon-rail-item" aria-label={link.label} data-label={link.label}>
                      {link.icon}
                    </Link>
                  </Tooltip>
                ))}
              </nav>
            )}
          </aside>
        )}
        <aside className="studio-controls-panel panel flex min-h-0 flex-col border-y-0 border-l-0">
          {controls}
          {sidebarPromptLayout && naiGenerationFooter}
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左侧面板宽度"
          aria-valuenow={leftWidth}
          aria-valuemin={replicaLayout ? 320 : 240}
          aria-valuemax={replicaLayout ? 560 : 520}
          tabIndex={0}
          className="panel-resizer block"
          onPointerDown={(event) => startResize("left", event)}
          onKeyDown={(event) => resizePanelWithKeyboard("left", event)}
          onDoubleClick={() => { const value = naiLayout ? 447 : nlwLayout ? 400 : 310; setLeftWidth(value); savePanelWidths(value, rightWidth); }}
        />
        <section className="studio-canvas flex min-h-0 flex-col" data-layout-module="canvas">
          {!sidebarPromptLayout &&
            (promptModes.has(operation) || operation === "suggest-tags") && (
              <div data-tutorial="prompt" className="grid shrink-0 gap-3 border-b border-[var(--line)] bg-[#f2f0ea] p-3 xl:grid-cols-2">
                <Prompt
                  label={
                    operation.startsWith("director-") ? "工具提示" : "描述画面"
                  }
                  value={prompt}
                  onChange={setPrompt}
                  accent
                  placeholder={
                    promptTagMode
                      ? "Danbooru 标签，逗号分隔，如 1girl, white hair, crimson eyes"
                      : "自然语言描述画面，如 一个白发的女孩穿着和服站在窗边"
                  }
                  tools={promptToolbar("prompt")}
                  autocomplete={!naturalImageModel}
                  tagMode={!naturalImageModel && promptTagMode}
                  config={promptConfig}
                  relatedSamples={promptRelatedSamples}
                  natural={naturalImageModel}
                  onNotice={setNotice}
                  inlineChatTarget={{ kind: "prompt", label: "描述画面" }}
                  openInlineChatMenu={openInlineChatMenu}
                />
                {operation !== "suggest-tags" && (
                  <Prompt
                    label="排除内容"
                    value={negative}
                    onChange={setNegative}
                    placeholder="低质量、错误肢体、水印等不希望出现的内容"
                    tools={promptToolbar("negative")}
                    autocomplete={!naturalImageModel}
                    tagMode={!naturalImageModel && promptTagMode}
                    config={promptConfig}
                    relatedSamples={promptRelatedSamples}
                    natural={naturalImageModel}
                    onNotice={setNotice}
                    inlineChatTarget={{ kind: "negative", label: "排除内容" }}
                    openInlineChatMenu={openInlineChatMenu}
                  />
                )}
                {!naturalImageModel && operation !== "suggest-tags" && (
                  // 等级提示词预设（移植 Aaalice）：质量词→正向末尾，UC→负向前缀。
                  <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                    <div hidden={mediumEffort} className="block text-xs font-semibold text-[#4c5052]">
                      <span className="mb-2 block">质量词 <small className="font-normal text-[var(--muted)]">追加到提示词末尾</small></span>
                      <PopupSelect
                        value={qualityTier}
                        options={[
                          { value: "nai-default", label: QUALITY_TIER_LABELS["nai-default"] },
                          ...(isV5Model(model) ? [{ value: "light", label: QUALITY_TIER_LABELS.light }] : []),
                          { value: "none", label: QUALITY_TIER_LABELS.none },
                          ...(customQuality.trim() ? [{ value: "custom", label: `自定义 · ${customQuality.trim().slice(0, 24)}…` }] : []),
                        ]}
                        onChange={(next) => setQualityTier(next as QualityTier)}
                        ariaLabel="质量词等级"
                        emptyText="没有匹配项"
                      />
                    </div>
                    <div className="block text-xs font-semibold text-[#4c5052]">
                      <span className="mb-2 block">负面预设 (UC) <small className="font-normal text-[var(--muted)]">添加到排除内容前缀</small></span>
                      <PopupSelect
                        value={ucType}
                        options={(Object.keys(UC_PRESET_LABELS) as Array<Exclude<UcPresetType, "custom"> | "custom">)
                          .filter((type) => type !== "custom" || customUc.trim())
                          .map((type) => ({ value: type, label: UC_PRESET_LABELS[type] }))}
                        onChange={(next) => setUcType(next as typeof ucType)}
                        ariaLabel="负面提示词预设"
                        emptyText="没有匹配项"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          <div
            ref={positionOverlayRef}
            className={`studio-preview relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-5${replicaLayout ? " replica-preview-host" : ""}`}
          >
            {modelCapabilities.characters && charactersEnabled && !aiAutoPosition && ["generate", "img2img", "inpainting"].includes(operation) && (
              // 手动定位坐标系：X 轴=水平滑块，Y 轴=垂直滑块，多角色多色十字线，
              // 圆点可拖动（与滑块双向同步）。
              <div className="character-position-overlay" aria-hidden={false}>
                <span className="character-position-axis-x">X 轴 →</span>
                <span className="character-position-axis-y">Y 轴 ↓</span>
                {characters.map((character, index) => (
                  <span key={character.id} className={`char-color-${index % 6}`}>
                    <span
                      className="char-pos-line char-pos-line-v"
                      style={{ left: `${character.centerX * 100}%` }}
                    />
                    <span
                      className="char-pos-line char-pos-line-h"
                      style={{ top: `${character.centerY * 100}%` }}
                    />
                    <span
                      className="char-pos-dot"
                      style={{ left: `${character.centerX * 100}%`, top: `${character.centerY * 100}%` }}
                      title={`角色 ${index + 1} · 拖动调整位置`}
                      onPointerDown={(event) => startCharacterDrag(event, character.id)}
                    >
                      {index + 1}
                    </span>
                  </span>
                ))}
              </div>
            )}
            <div className="studio-mode-picker" ref={modePickerRef}>
              <button
                type="button"
                className={`studio-mode-badge${operation !== "generate" ? " is-edit-mode" : ""}`}
                aria-label={`当前${modes.find((item) => item.id === operation)?.label || "文生图"}，点击选择生成模式`}
                title="点击选择生成模式"
                aria-haspopup="dialog"
                aria-expanded={modePickerOpen}
                aria-controls="studio-mode-picker-menu"
                data-current-operation={operation}
                disabled={generating}
                onClick={() => setModePickerOpen((open) => !open)}
              >
                <strong aria-live="polite" aria-atomic="true"><Sparkles size={14} aria-hidden="true" />当前：{modes.find((item) => item.id === operation)?.label || "文生图"}</strong>
                <span>{width}×{height} · {count} 张</span>
                <span className="studio-mode-toggle-hint">点击选择模式</span>
              </button>
              {modePickerOpen && (
                <div className="studio-mode-picker-menu" id="studio-mode-picker-menu" role="dialog" aria-label="选择生成模式">
                  <div className="studio-mode-picker-heading">
                    <strong>选择生成模式</strong>
                    <span>当前模型不支持的模式会禁用，不会自动切换档位</span>
                  </div>
                  <div className="studio-mode-picker-options">
                    {modePickerOptions.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`studio-mode-option${operation === item.id ? " is-active" : ""}`}
                        aria-pressed={operation === item.id}
                        disabled={!modelCapabilities.operations.includes(item.id)}
                        onClick={() => {
                          selectOperation(item.id);
                          setModePickerOpen(false);
                        }}
                      >
                        <ImagePlus size={18} aria-hidden="true" />
                        <span>
                          <b>{item.label}</b>
                          <small>{item.detail}</small>
                          {!modelCapabilities.operations.includes(item.id) && <small>当前模型不支持此模式</small>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
            ) : replicaLayout ? (
              <ReplicaMedia variant={replicaVariant} images={displayedImages} width={width} height={height} seed={seed}
                progress={generating ? streamProgress || batchProgress || "正在生成…" : undefined}
                onOpen={setLightboxIndex} onUse={(image, value) => applyImageAsSource(image, value as Operation)} />
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
                    <ImageDownloadMenu src={displayedImages[0]} filename="lfn-1" className="workspace-result-download" title="下载主图" />
                  </div>}
                </div>
                {displayedImages.length > 1 && <div className="workspace-result-list">
                  {displayedImages.slice(1).map((image, index) => (
                    <div key={`${image.slice(-24)}-${index}`} className={`workspace-result-item${selectedImageIndex === index + 1 ? " is-selected" : ""}`} style={{ aspectRatio: `${width} / ${height}` }}>
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
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[#fffefa] p-3">
              {modelCapabilities.seed && <SeedModeNotice seed={seed} onRandom={() => setSeed("")} />}
              {operation !== "suggest-tags" && signedIn && (
                pricingDetails(<>
                  {providerId !== "newapi" ? (
                    <span>个人 Key · 费用以提供方账单为准</span>
                  ) : canUseAffEstimate ? (
                    <>
                      <div>
                        预计消耗{" "}
                        <b className="text-[var(--ink)]">
                          {formatAff(estimatedAffCost)} AFF
                        </b>
                      </div>
                      {estimatedPackageCost > 0 && (
                        <div>
                          图包额度{" "}
                          <b className="text-[var(--ink)]">
                            -{formatAff(estimatedPackageCost)} AFF
                          </b>
                        </div>
                      )}
                      {estimatedPersonalCost > 0 && (
                        <div>
                          个人 AFF{" "}
                          <b className="text-[var(--ink)]">
                            -{formatAff(estimatedPersonalCost)} AFF
                          </b>
                        </div>
                      )}
                      {requiresLocalBilling && localAffShortfall > 0 && <div className="text-[var(--rose)]">个人 AFF 尚缺 {localAffShortfall} · NewAPI 余额不适用于此模型</div>}
                      <div>
                        图包 / 个人余量{" "}
                        <b className="text-[var(--ink)]">
                          {formatAff(wallet?.aff?.packageBalance ?? 0)} /{" "}
                          {formatAff(wallet?.aff?.balance ?? 0)}
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
                        当前请求按 NewAPI 自身价格与余额计费
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
                <small>查看定价与阶梯</small></>, "credit-pricing-summary")
              )}
              <button
                data-studio-generate={generating ? undefined : true} data-studio-cancel={generating || undefined} aria-label={generating ? "取消当前生成" : undefined}
                onClick={generating ? () => cancelImageGeneration() : handleStudioGenerationClick}
                disabled={!generating && !model}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded bg-[var(--rose)] text-sm font-semibold text-white disabled:opacity-60 sm:h-12 sm:text-base"
              >
                <Sparkles size={18} />{generating && <span>取消当前生成</span>}
                {generating
                  ? batchProgress
                    ? `生成中 ${batchProgress}…`
                    : "处理中，请稍候..."
                  : generationModes.has(operation)
                    ? `生成 ${count} 张图像`
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
            aria-valuemax={replicaLayout ? 520 : 460}
            tabIndex={0}
            className="panel-resizer block"
            onPointerDown={(event) => startResize("right", event)}
            onKeyDown={(event) => resizePanelWithKeyboard("right", event)}
            onDoubleClick={() => { const value = 280; setRightWidth(value); savePanelWidths(leftWidth, value); }}
          />
        <aside
          className={`studio-tools-panel panel flex min-h-0 flex-col border-y-0 border-r-0${aaaliceDock ? " is-replica-dock" : ""}`}
        >
          {aaaliceDock ? <ReplicaRightDock
            history={replicaHistoryPanel}
            assistant={assistantPanel}
            historyEnabled={historyEnabled}
            assistantEnabled={assistantEnabled}
            assistantOpenRequest={replicaAssistantOpenRequest}
            expansionRequest={customDockExpansionRequest}
            onCollapsedChange={setReplicaDockCollapsed} onUserInteraction={() => { customDockInteractionRevision.current += 1; }}
          /> : toolsPanel}
        </aside>
      </div>
      {typeof document !== "undefined" && inlineChatMenu && createPortal(
        <InlineChatMenu
          position={inlineChatMenu.position}
          targetLabel={inlineChatMenu.target.label}
          onPick={pickInlineChatMenuItem}
          onCopy={() => void copyInlineSelection()}
          onPaste={() => void pasteInlineSelection()}
          canCopy={Boolean(inlineChatMenu.selection.text)}
          canUseAi={signedIn && Boolean(inlineChatMenu.selection.text)}
          onClose={() => setInlineChatMenu(null)}
        />,
        document.body,
      )}
      {typeof document !== "undefined" && inlineChat && createPortal(
        <InlineChatZone
          session={inlineChat}
          model={assistantModel}
          assistantProviderId={assistantProviderId} assistantGroup={assistantGroup}
          imageModel={model}
          modelProtocol={imageProtocol}
          operation={operation}
          onKeep={keepInlineChatResult}
          onClose={() => setInlineChat(null)}
        />,
        document.body,
      )}
      {lightboxIndex !== null && displayedImages[lightboxIndex] && (
        <Lightbox
          images={displayedImages}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={setLightboxIndex}
        />
      )}
      {agentPreview && (
        <Lightbox
          images={[agentPreview]}
          index={0}
          onClose={() => setAgentPreview(null)}
          onNavigate={() => {}}
        />
      )}
      {(replicaLayout || customWorkspace) && menuOpen && (
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
                {userId ? <UserAvatar userId={userId} name={userName} size={40} /> : (userName || "游").slice(0, 1).toUpperCase()}
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
            <Link href="/profile" onClick={() => setMenuOpen(false)} className="nai-menu-item">
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
            <Link href="/stories" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <BookOpen size={16} /> 故事工作台
            </Link>
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
                openAssistantPanel();
                window.setTimeout(() => {
                  const panel = document.querySelector(".studio-tools-panel");
                  panel?.querySelector<HTMLTextAreaElement>('textarea[aria-label="标签助手输入"]')
                    ?.focus();
                }, 60);
              }}
            >
              <Sparkles size={16} /> 标签助手
            </button>

            <p className="nai-menu-label">设置</p>
            <Link href="/settings#appearance" onClick={() => setMenuOpen(false)} className="nai-menu-item">
              <Paintbrush size={16} /> 外观设置
            </Link>
            <Link href="/settings#models" onClick={() => setMenuOpen(false)} className="nai-menu-item">
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
              href="/profile"
              target="_blank"
              rel="noreferrer"
              className="nai-menu-item"
            >
              <ExternalLink size={16} /> 账号中心
            </a>

            <p className="nai-menu-foot">
              图片历史、导演工具等创作入口已收入此菜单。
            </p>
          </aside>
        </div>
      )}
      {generationConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setGenerationConfirmation(null)}>
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="generation-confirmation-title"
            aria-describedby="generation-confirmation-details"
            className="w-full max-w-md rounded-xl bg-[var(--panel)] p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="generation-confirmation-title" className="text-lg font-semibold">确认生成与费用</h2>
            <p id="generation-confirmation-details" className="mt-3 whitespace-pre-line text-sm leading-6 text-[var(--muted)]">
              {generationConfirmation}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setGenerationConfirmation(null)} className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm">取消</button>
              <button
                type="button"
                onClick={() => {
                  const approved = generationConfirmation;
                  setGenerationConfirmation(null);
                  const queuedApproval = queuedGenerationApprovalRef.current; queuedGenerationApprovalRef.current = null; if (queuedApproval) queuedApproval(); else void runOperation(approved);
                }}
                className="rounded-lg bg-[var(--rose)] px-4 py-2 text-sm font-semibold text-white"
              >
                确认并生成
              </button>
            </div>
          </section>
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
                applyImageAsSource(dataUrl, replicaLayout ? replicaGalleryOperation : "img2img");
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
    </PromptVersionProvider>
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
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <section className={`panel-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="panel-section-head"
        aria-expanded={open}
        onClick={() => { setOpen(!open); onOpenChange?.(!open); }}
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
          <ImageDownloadMenu src={images[index]} filename={`lfn-${index + 1}`} className="lightbox-download" title="下载图片" />
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
  ariaLabel,
  value,
  setValue,
  min,
  max,
  step,
}: {
  ariaLabel?: string;
  value: number;
  setValue: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <WheelNumberInput
      ariaLabel={ariaLabel}
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
    <div className="upload-field-stack" data-tutorial="source">
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
  placeholder,
  tools,
  autocomplete = false,
  tagMode = false,
  config,
  relatedSamples = [],
  natural = false,
  onNotice,
  inlineChatTarget,
  openInlineChatMenu,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accent?: boolean;
  placeholder?: string;
  tools?: React.ReactNode;
  autocomplete?: boolean;
  tagMode?: boolean;
  config?: ReplicaPromptConfig;
  relatedSamples?: string[];
  natural?: boolean;
  onNotice?: (message: string) => void;
  // VSCode 内联聊天：文本域右键弹出 AI 操作菜单。
  inlineChatTarget?: InlineChatTarget;
  openInlineChatMenu?: (
    event: React.MouseEvent<HTMLTextAreaElement>,
    target: InlineChatTarget,
  ) => void;
}) {
  // 外层用 div：工具按钮放进 <label> 时，label 的隐式控件变成第一个
  // button（骰子），点 Tag/清空会被 label 激活行为连带触发骰子。
  const fieldId = useId();
  const shouldAutocomplete = autocomplete && (config?.settings.autocomplete ?? true);
  const copyHandler: React.ClipboardEventHandler<HTMLTextAreaElement> | undefined = config?.settings.resolveAliasesOnCopy
    ? (event) => {
      const selected = value.slice(event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
      if (!selected) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", resolvePromptAliases(selected, config.library));
    }
    : undefined;
  const blurHandler: React.FocusEventHandler<HTMLTextAreaElement> | undefined = config
    ? (event) => {
      const result = transformModelPromptOnBlur(event.currentTarget.value, config, natural);
      if (result.text !== event.currentTarget.value) onChange(result.text);
      if (result.error) onNotice?.(result.error);
    }
    : undefined;
  return (
    <div
      className={`rounded border bg-white p-3 ${accent ? "border-[#c99ba3]" : "border-[var(--line)]"}`}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
        <label htmlFor={fieldId} className="flex items-center gap-2">
          {accent && <Sparkles size={13} className="text-[var(--rose)]" />}
          {label}
        </label>
        {tools && <span className="ml-auto flex items-center gap-1.5 font-normal">{tools}</span>}
      </div>
      {tagMode ? (
        <div className="rounded border border-[var(--line)] bg-[#faf9f5] p-2 min-h-14">
          <TagChipEditor value={value} onChange={onChange} zhOf={tagZh} autocomplete={shouldAutocomplete}
            library={config?.library ?? []} cooccurrence={config?.settings.cooccurrence ?? false} relatedSamples={relatedSamples}
            resolveCopy={config?.settings.resolveAliasesOnCopy ? (text) => resolvePromptAliases(text, config.library) : undefined} />
        </div>
      ) : (
        <PromptAutocompleteTextarea
          id={fieldId}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autocomplete={shouldAutocomplete}
          library={config?.library ?? []}
          cooccurrence={config?.settings.cooccurrence ?? false}
          relatedSamples={relatedSamples}
          onCopy={copyHandler}
          onFeedback={onNotice}
          highlight={Boolean(config?.settings.highlight && !natural)}
          onBlur={blurHandler}
          onContextMenu={
            inlineChatTarget && openInlineChatMenu
              ? (event) => openInlineChatMenu(event, inlineChatTarget)
              : undefined
          }
          // 默认高度即最小高度，用户可拖右下角调整；不低于默认值。
          className="min-h-14 w-full resize-y text-sm leading-6 outline-none sm:min-h-16"
        />
      )}
    </div>
  );
}
