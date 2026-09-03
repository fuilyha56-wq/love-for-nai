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
  FileUp,
  ImagePlus,
  Images,
  Megaphone,
  Menu,
  Paintbrush,
  PawPrint,
  Plus,
  Search,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PopupSelect, type SelectOption } from "@/app/ui/popup-select";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Props = { userName: string; authenticated: boolean };

function clampPanel(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

import {
  estimateNewApiCost,
  newApiBalanceToCny,
  affCost as estimateAff,
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

const unsupportedOperations = new Set<Operation>(["upscale", "annotate"]);
const acceptedUploadTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_UPLOAD_SIZE = 15 * 1024 * 1024;
const ASSISTANT_POLL_INTERVAL_MS = 2_000;
const ASSISTANT_MAX_POLLS = 60;
const ASSISTANT_TIMEOUT_MS = 2 * 60 * 1_000;
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
  if (!Number.isInteger(count) || count < 1 || count > 6)
    return "生成张数必须是 1–6 之间的整数。";
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
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [negative, setNegative] = useState(defaultNegative);
  const [source, setSource] = useState<Upload | null>(null);
  const [mask, setMask] = useState<Upload | null>(null);
  const [charactersEnabled, setCharactersEnabled] = useState(false);
  const [characters, setCharacters] = useState<CharacterPromptUi[]>([
    { id: "char-1", prompt: "", centerX: 0.5, centerY: 0.5 },
  ]);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [referenceType, setReferenceType] = useState("character&style");
  const [controlModel, setControlModel] = useState("hed");
  const [notice, setNotice] = useState("");
  const [mobilePanel, setMobilePanel] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [aff, setAff] = useState<Aff | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<string[]>([]);
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
  const [leftWidth, setLeftWidth] = useState(310);
  const [rightWidth, setRightWidth] = useState(230);

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
    if (!mobilePanel && !mobileToolsOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMobilePanel(false);
      setMobileToolsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobilePanel, mobileToolsOpen]);

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
      if (parsed.left) setLeftWidth(clampPanel(parsed.left, 240, 520));
      if (parsed.right) setRightWidth(clampPanel(parsed.right, 200, 460));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
      window.localStorage.setItem(
        "lfn-layout",
        JSON.stringify({ left: latestLeft, right: latestRight }),
      );
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
    window.localStorage.setItem(
      "lfn-layout",
      JSON.stringify({ left: side === "left" ? next : leftWidth, right: side === "right" ? next : rightWidth }),
    );
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
          image: agentImage || undefined,
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

  // 从本地 NAI 图片提取生成参数并填充到工作台（浏览器端解析 PNG/JPEG 元数据）。
  async function importParametersFromFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) {
      setNotice("仅支持 15MB 以内的 PNG/JPEG 图片。");
      return;
    }
    try {
      const { parseNaiImageMetadata } = await import("@/lib/nai-metadata");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const metadata = parseNaiImageMetadata(bytes);
      if (!metadata) {
        setNotice("未能从图片中解析出 NAI 生成参数。");
        return;
      }
      const params = metadata.parameters;
      if (typeof params.prompt === "string" && params.prompt)
        setPrompt(params.prompt);
      const negative = params.negative_prompt ?? params.uc;
      if (typeof negative === "string" && negative) setNegative(negative);
      const numeric: Array<[string, (value: number) => void, number, number]> = [
        ["width", setWidth, 64, 1600],
        ["height", setHeight, 64, 1600],
        ["steps", setSteps, 1, 50],
        ["scale", setScale, 0, 10],
        ["cfg_rescale", setCfgRescale, 0, 1],
      ];
      numeric.forEach(([key, setter, min, max]) => {
        const value = Number(params[key]);
        if (Number.isFinite(value) && value >= min && value <= max)
          setter(value);
      });
      if (typeof params.sampler === "string" &&
        samplers.some(({ value }) => value === params.sampler))
        setSampler(params.sampler);
      if (typeof params.noise_schedule === "string" &&
        schedules.some(({ value }) => value === params.noise_schedule))
        setSchedule(params.noise_schedule);
      if (params.seed != null && Number.isFinite(Number(params.seed)))
        setSeed(String(params.seed));
      setNotice(`已从 ${file.name} 导入生成参数。`);
    } catch {
      setNotice("读取图片失败，请重试。");
    }
  }

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

  const controls = (
    <>
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <b className="flex items-center gap-2 text-sm">
          <SlidersHorizontal size={16} /> 图像设置
        </b>
        <button
          type="button"
          title="重置参数"
          aria-label="重置所有生成参数"
          disabled={generating}
          className="disabled:cursor-not-allowed disabled:opacity-50"
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
                setAdvancedOpen(false);
                setSuggestedTags([]);
                setImages([]);
                setNotice("");
              }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="settings-scroll space-y-5 p-4">
        <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]">
          <FileUp size={15} />
          <span className="truncate">从图片导入 NAI 参数</span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(event) => {
              importParametersFromFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
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
        <section className="nai-reference-section">
          <div className="nai-section-heading">参考图片</div>
          <button
            type="button"
            className={`nai-reference-card ${operation === "generate" ? "is-active" : ""}`}
            onClick={() => {
              setOperation("generate");
              setNotice("");
            }}
          >
            <ImagePlus size={18} />
            <span>
              <b>文生图</b>
              <small>根据提示词生成图片。</small>
            </span>
          </button>
          {referenceOperations.map((item) => (
            <button
              type="button"
              className={`nai-reference-card ${operation === item.id ? "is-active" : ""}`}
              key={item.id}
              onClick={() => {
                setOperation(item.id);
                setNotice("");
              }}
            >
              <ImagePlus size={18} />
              <span>
                <b>{item.label}</b>
                <small>{item.detail}</small>
              </span>
            </button>
          ))}
        </section>
        <Control label="图片工具">
          <PopupSelect
            value={
              toolOperations.some(({ value }) => value === operation)
                ? operation
                : "generate"
            }
            options={[
              { value: "generate", label: "不使用工具" },
              ...toolOperations,
            ]}
            onChange={(value) => {
              setOperation(value as Operation);
              setNotice("");
            }}
            ariaLabel="图片工具"
          />
        </Control>
        <Control label="自定义分辨率 · 64–1600">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <NumberField
              value={width}
              setValue={setWidth}
              min={64}
              max={1600}
              step={64}
            />
            <span>×</span>
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
        {generationModes.has(operation) && (
          <>
            <div className="nai-ai-settings">
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
            <div>
              <Control label="生成张数 · 1–6">
                <NumberField
                  value={count}
                  setValue={setCount}
                  min={1}
                  max={6}
                  step={1}
                />
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
                    每 0.5 秒发送一张（n=1），逐张出图。
                  </p>
                )}
              </Control>
            </div>
            {operation === "generate" && (
              <section className="rounded-md border border-[var(--line)] bg-white p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users size={14} className="text-[var(--rose)]" />
                    <b className="text-xs">多角色</b>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={charactersEnabled}
                      onChange={(event) => setCharactersEnabled(event.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--rose)]"
                    />
                    启用
                  </label>
                </div>
                {charactersEnabled && (
                  <div className="mt-3 space-y-3">
                    <p className="text-[10px] leading-4 text-[var(--muted)]">
                      为画面中的每个角色编写独立提示词，并用滑块摆放角色位置（0–1 归一化坐标）。主提示词描述整体场景。
                    </p>
                    {characters.map((character, index) => (
                      <div
                        key={character.id}
                        className="rounded border border-[var(--line)] bg-[#faf9f5] p-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <b className="text-[11px] text-[var(--rose)]">角色 {index + 1}</b>
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
                            <label key={axis} className="block text-[10px] text-[var(--muted)]">
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
            )}
          </>
        )}
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
            onChange={setSource}
            onError={setNotice}
          />
        )}
        {["inpainting", "edits"].includes(operation) && (
          <div className="space-y-2">
            <button
              type="button"
              className="flex h-11 w-full items-center justify-center gap-2 rounded bg-[#17191f] px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!source}
              onClick={() => setMaskEditorOpen(true)}
            >
              <Brush size={15} />
              {mask ? "继续编辑蒙版" : "绘制蒙版"}
            </button>
            <UploadField
              label={mask ? "蒙版已绘制，也可重新上传" : "或上传蒙版图片"}
              value={mask}
              onChange={setMask}
              onError={setNotice}
            />
          </div>
        )}
        {["upscale", "annotate"].includes(operation) && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            Gateway 端点存在，但尚无可审计的 usage
            计费映射，当前只展示完整入口并阻止零费用提交。
          </p>
        )}
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
    setGenerating(true);
    setImages([]);
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
      base.reference_strength = 0.6;
      base.reference_information_extracted = 1;
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
      base.image = source?.data;
      base.scale = 2;
    }
    if (operation.startsWith("director-")) {
      base.image = source?.data;
      base.defry = 1;
    }
    try {
      // 分批次：每 0.5 秒发送一张（n=1），逐张出图；一次性保持单请求 n 张。
      const sequential = batchMode === "sequential" && count > 1;
      const total = sequential ? count : 1;
      const collected: string[] = [];
      let usedNewApi = false;
      let failures = 0;
      let lastError = "";
      let partialMessage = "";
      for (let index = 0; index < total; index += 1) {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (total > 1) setBatchProgress(`${index + 1}/${total}`);
        const response = await fetch("/api/images/operate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sequential ? { ...base, n: 1 } : base),
        });
        const result = await response.json();
        if (!response.ok && !result.images) throw new Error(result.message || "操作失败");
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
        const newImages: string[] = result.images || (result.image ? [result.image] : []);
        if (sequential) {
          collected.push(...newImages);
          // 逐批上屏，先出先显示。
          setImages([...collected]);
        } else {
          setImages(newImages);
        }
        if (result.payment === "newapi") usedNewApi = true;
        if (result.partial) partialMessage = result.message || "部分批次生成失败。";
        if (sequential && !newImages.length) {
          failures += 1;
          lastError = result.message || "生成失败";
        }
      }
      await refreshWallet();
      if (sequential && failures) {
        if (!collected.length) throw new Error(lastError || "分批生成全部失败");
        setNotice(`分批生成完成 ${collected.length}/${total} 张${lastError ? `：${lastError}` : ""}。`);
      } else if (partialMessage) {
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
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "操作失败，请稍后重试",
      );
    } finally {
      setBatchProgress("");
      setGenerating(false);
    }
  }

  const activeCharacterCount =
    operation === "generate" && charactersEnabled
      ? characters.filter((character) => character.prompt.trim()).length
      : 0;
  const estimatedAffCost = estimateAff({
    model,
    operation,
    width,
    height,
    steps,
    samples: count,
    characterPromptCount: activeCharacterCount,
  });
  const packageRateImages = Math.min(
    count,
    wallet?.aff?.packageBalance && wallet.aff.packageRateLimitRemaining > 0
      ? wallet.aff.packageRateLimitRemaining
      : 0,
  );
  const estimatedPackageCost = wallet?.aff?.enabled
    ? Math.min(
        wallet.aff.packageBalance,
        Math.ceil((estimatedAffCost * packageRateImages) / Math.max(1, count)),
      )
    : 0;
  const estimatedPersonalCost = estimatedAffCost - estimatedPackageCost;
  const canUseAffEstimate = Boolean(
    wallet?.aff?.enabled &&
      wallet.aff.balance >= estimatedPersonalCost &&
      wallet.aff.packageBalance >= estimatedPackageCost,
  );

  // 右侧功能区：创作中心 + 标签助手 + 会话状态（桌面侧栏与移动抽屉共用）。
  const toolsPanel = (
    <>
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
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white disabled:opacity-50"
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
                  className="h-9 shrink-0 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]"
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

  return (
    <main className="flex h-[100dvh] min-h-[560px] flex-col overflow-hidden bg-[var(--paper)]">
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
      <div
        className="studio-layout grid min-h-0 flex-1"
        style={
          {
            "--lfn-left": `${leftWidth}px`,
            "--lfn-right": `${rightWidth}px`,
          } as React.CSSProperties
        }
      >
        <aside className="panel hidden min-h-0 border-y-0 border-l-0 lg:flex lg:flex-col">
          {controls}
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
          onDoubleClick={() => setLeftWidth(310)}
        />
        <section className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3 lg:hidden">
            <button
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
              onClick={() => setMobileToolsOpen(true)}
              className="flex items-center gap-2 text-sm"
            >
              <Images size={18} />
              功能区
            </button>
          </div>
          {(promptModes.has(operation) || operation === "suggest-tags") && (
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
            ) : images.length ? (
              <div
                className={`grid w-full gap-3 overflow-auto ${
                  images.length === 1
                    ? "h-full max-w-none grid-cols-1 place-content-center place-items-center"
                    : "max-h-full max-w-5xl grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
                }`}
              >
                {images.map((image, index) => (
                  <div
                    key={`${image.slice(-24)}-${index}`}
                    className={`relative overflow-hidden border border-[var(--line)] bg-white ${
                      images.length === 1
                        ? "flex h-full max-h-full w-full max-w-full items-center justify-center"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(index)}
                      className={`block w-full cursor-zoom-in ${
                        images.length === 1
                          ? "flex h-full max-h-full items-center justify-center"
                          : ""
                      }`}
                      title="点击放大查看"
                    >
                      <Image
                        src={image}
                        alt={`NAI 结果 ${index + 1}`}
                        width={width}
                        height={height}
                        unoptimized
                        className={
                          images.length === 1
                            ? "h-full max-h-full w-auto max-w-full object-contain"
                            : "h-auto w-full object-contain"
                        }
                      />
                    </button>
                    <a
                      href={image}
                      download={`lfn-${index + 1}.png`}
                      title="下载图片"
                      className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded bg-black/70 text-white"
                    >
                      <Download size={17} />
                    </a>
                  </div>
                ))}
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
              <button onClick={() => setNotice("")} aria-label="关闭提示" className="shrink-0">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] bg-[#fffefa] p-3">
            {operation !== "suggest-tags" && signedIn && (
              <div className="hidden shrink-0 text-right text-[10px] leading-4 text-[var(--muted)] sm:block">
                {canUseAffEstimate ? (
                  <>
                    <div>预计消耗 <b className="text-[var(--ink)]">{estimatedAffCost} AFF</b></div>
                    {estimatedPackageCost > 0 && (
                      <div>图包额度 <b className="text-[var(--ink)]">-{estimatedPackageCost} AFF</b></div>
                    )}
                    {estimatedPersonalCost > 0 && (
                      <div>个人 AFF <b className="text-[var(--ink)]">-{estimatedPersonalCost} AFF</b></div>
                    )}
                    <div>图包 / 个人余量 <b className="text-[var(--ink)]">{wallet?.aff?.packageBalance ?? 0} / {wallet?.aff?.balance ?? 0}</b></div>
                  </>
                ) : (
                  <>
                    <div>预计消耗 <b className="text-[var(--ink)]">¥{newApiBalanceToCny(estimateNewApiCost(modelPricing, { model, operation, width, height, steps, samples: count, characterPromptCount: activeCharacterCount })).toFixed(2)}</b></div>
                    {modelPricing && (
                      <div>{modelPricing.effectiveGroup} × {modelPricing.groupRatio} 倍率</div>
                    )}
                    <div>图包/个人 AFF 不足或服务未启用，将使用 NewAPI 余额</div>
                    <div>NewAPI 余额 <b className="text-[var(--ink)]">{me?.user?.balance != null ? `$${me.user.balance.toFixed(2)}` : "--"}</b></div>
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
          onDoubleClick={() => setRightWidth(230)}
        />
        <aside className="panel hidden min-h-0 flex-col border-y-0 border-r-0 lg:flex">
          {toolsPanel}
        </aside>
      </div>
      {lightboxIndex !== null && images[lightboxIndex] && (
        <Lightbox
          images={images}
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
            className="panel flex h-full w-[min(90vw,350px)] flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] px-4">
              <b className="flex items-center gap-2 text-sm">
                <SlidersHorizontal size={15} className="text-[var(--rose)]" /> 图像设置
              </b>
              <button
                onClick={() => setMobilePanel(false)}
                aria-label="关闭图像设置"
              >
                <X size={18} />
              </button>
            </div>
            {controls}
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
      {maskEditorOpen && source && (
        <MaskEditor
          source={source}
          initialMask={mask}
          onClose={() => setMaskEditorOpen(false)}
          onSave={(nextMask) => {
            setMask(nextMask);
            setMaskEditorOpen(false);
          }}
        />
      )}
    </main>
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

function MaskEditor({
  source,
  initialMask,
  onClose,
  onSave,
}: {
  source: Upload;
  initialMask: Upload | null;
  onClose: () => void;
  onSave: (mask: Upload) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brushSize, setBrushSize] = useState(32);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [imageRatio, setImageRatio] = useState(1);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new window.Image();
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      setImageRatio(image.naturalWidth / image.naturalHeight);
      if (!initialMask) return;
      const existingMask = new window.Image();
      existingMask.onload = () => {
        canvas
          .getContext("2d")
          ?.drawImage(existingMask, 0, 0, canvas.width, canvas.height);
      };
      existingMask.src = initialMask.data;
    };
    image.src = source.data;
  }, [initialMask, source.data]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const point = pointFromEvent(event);
    const previous = lastPointRef.current;
    if (!canvas || !point || !previous) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    context.save();
    context.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = "#000";
    context.lineWidth = brushSize * scale;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
    lastPointRef.current = point;
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    draw(event);
  }

  function stopDrawing() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearMask() {
    const canvas = canvasRef.current;
    if (canvas)
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function saveMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave({ data: canvas.toDataURL("image/png"), name: "绘制蒙版.png" });
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
            title="画笔"
          >
            <Brush size={18} /> <span>画笔</span>
          </button>
          <label>
            <span>笔刷大小：{brushSize}</span>
            <input
              type="range"
              min="4"
              max="120"
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="mask-editor-actions">
          <button type="button" onClick={saveMask} className="primary">
            <Save size={17} /> 保存并关闭
          </button>
          <button type="button" onClick={onClose} title="关闭蒙版编辑器">
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="mask-editor-stage">
        <div
          className="mask-editor-canvas-wrap"
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
            ref={canvasRef}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            aria-label="蒙版绘制画布"
          />
        </div>
      </div>
      <div className="mask-editor-bottombar">
        <button
          type="button"
          className={tool === "brush" ? "is-active" : ""}
          onClick={() => setTool("brush")}
          title="画笔"
        >
          <Brush size={18} />
        </button>
        <button
          type="button"
          className={tool === "eraser" ? "is-active" : ""}
          onClick={() => setTool("eraser")}
          title="橡皮擦"
        >
          <Eraser size={18} />
        </button>
        <button type="button" onClick={clearMask} title="清空蒙版">
          <Trash2 size={18} />
        </button>
      </div>
    </div>,
    document.body,
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
        <input
          className="nai-number-input"
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setValue(Number(event.target.value))}
        />
        <input
          className="range min-w-0 flex-1"
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
    <input
      className="field h-10 px-2 text-center"
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => setValue(Number(event.target.value))}
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
    if (!file.type.startsWith("image/")) {
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
    <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[var(--line)] bg-white px-3 text-xs">
      <ImagePlus size={16} />
      <span className="truncate">{value?.name || label}</span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => read(event.target.files?.[0])}
      />
    </label>
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
