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
  Search,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
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
function estimateAff(model: string, width: number, height: number, steps: number, samples: number): number {
  if (model.toLowerCase().includes("-limit"))
    return model.toLowerCase().includes("nai-v5") ? Math.ceil(1.5 * samples) : samples;
  const pixels = Math.max(width * height, 65_536);
  let perSample = Math.ceil(2.951823174884865e-6 * pixels + 5.753298233447344e-7 * pixels * steps);
  if (model.toLowerCase().includes("nai-v5")) perSample *= 2;
  return Math.max(1, Math.ceil(perSample * samples));
}
// NewAPI 侧费用（实测校准，与生产计费配置一致）：
// V5 非 limit: token 价 150000$/1M × Draw 分组 0.5 → Anlas(含×2) × $3.75
// V4.5 非 limit: token 价 100000$/1M × 0.5 → Anlas × $2.5
// V4.5-limit 免费实扣 $0；V5-limit 固定价 $10 × 0.5 = $5/张
function estimateNewApiCost(model: string, width: number, height: number, steps: number, samples: number): number {
  const name = model.toLowerCase();
  if (name.includes("-limit")) {
    if (name.includes("nai-v5")) return Number((5 * samples).toFixed(2));
    return 0;
  }
  const anlas = estimateAff(model, width, height, steps, samples);
  return Number((anlas * (name.includes("nai-v5") ? 3.75 : 2.5)).toFixed(2));
}
type Me = { user?: { balance: number | null; group: string } };
type Aff = { balance: number };
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

export default function ImageStudio({ userName, authenticated }: Props) {
  const [operation, setOperation] = useState<Operation>("generate");
  const [contentMode, setContentMode] = useState<"anime" | "furry">("anime");
  const [model, setModel] = useState(models[0].value);
  const [width, setWidth] = useState(832);
  const [height, setHeight] = useState(1216);
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(5);
  const [count, setCount] = useState(1);
  const [sampler, setSampler] = useState("k_euler_ancestral");
  const [schedule, setSchedule] = useState("native");
  // 0 表示关闭重缩放；非 0 会被 NovelAI 部分模型拒绝，因此默认不启用。
  const [cfgRescale, setCfgRescale] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const [strength, setStrength] = useState(0.7);
  const [prompt, setPrompt] = useState(
    "masterpiece, best quality, 1girl, white hair, crimson eyes, intricate kimono, soft window light",
  );
  const [negative, setNegative] = useState(
    "lowres, bad anatomy, blurry, text, watermark",
  );
  const [source, setSource] = useState<Upload | null>(null);
  const [mask, setMask] = useState<Upload | null>(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [referenceType, setReferenceType] = useState("character&style");
  const [controlModel, setControlModel] = useState("hed");
  const [notice, setNotice] = useState("");
  const [mobilePanel, setMobilePanel] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
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
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantSuggestion, setAssistantSuggestion] =
    useState<AssistantSuggestion | null>(null);
  const router = useRouter();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const [leftWidth, setLeftWidth] = useState(310);
  const [rightWidth, setRightWidth] = useState(230);

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

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/wallet", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (result.aff?.enabled) setAff({ balance: result.aff.balance });
      })
      .catch(() => undefined);
  }, [signedIn]);

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

  async function askTagAssistant(request: string) {
    if (!assistantModel) {
      setNotice("当前账户没有可用的文本模型，请改用直接检索。");
      return;
    }
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
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "智能助手调用失败");
      const jobId = String(result.jobId || "");
      if (!jobId) throw new Error("智能助手未返回任务编号");
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(
          `/api/assistant/tags?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const progress = await poll.json();
        if (!poll.ok) throw new Error(progress.message || "智能助手调用失败");
        if (Array.isArray(progress.steps) && progress.steps.length)
          setAgentSteps(progress.steps);
        if (progress.status === "done") {
          setAssistantSuggestion(progress.suggestion);
          break;
        }
        if (progress.status === "error")
          throw new Error(progress.message || "智能助手调用失败");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "智能助手调用失败");
    } finally {
      setAssistantLoading(false);
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
    if (parameters.seed != null) setSeed(String(parameters.seed));
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
    setAssistantSuggestion(null);
    setNotice("已应用助手的全部建议。");
  }

  const controls = (
    <>
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <b className="flex items-center gap-2 text-sm">
          <SlidersHorizontal size={16} /> 图像设置
        </b>
        <button
          title="重置参数"
          onClick={() => {
            setWidth(832);
            setHeight(1216);
            setSteps(28);
            setScale(5);
            setCount(1);
            setSchedule("native");
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
              </Control>
            </div>
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
    if (
      imageInputModes.has(operation) &&
      operation !== "suggest-tags" &&
      !source
    ) {
      setNotice("请先上传操作所需的图片。");
      return;
    }
    if (["inpainting", "edits"].includes(operation) && !mask) {
      setNotice("该模式需要源图片和蒙版图片。");
      return;
    }
    if (
      width % 64 ||
      height % 64 ||
      width < 64 ||
      height < 64 ||
      width > 1600 ||
      height > 1600
    ) {
      setNotice("宽高必须在 64–1600 之间，并且是 64 的倍数。");
      return;
    }
    setGenerating(true);
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
      const response = await fetch("/api/images/operate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(base),
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
      setImages(result.images || (result.image ? [result.image] : []));
      if (result.aff?.balance != null) setAff({ balance: result.aff.balance });
      if (result.partial) setNotice(result.message || "部分批次生成失败。");
      else if (result.payment === "newapi") {
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
      setGenerating(false);
    }
  }

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
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              模型会检索 Danbooru 与相关概念，并整理、校验生成标签。
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
                placeholder="白发　或　雨夜里的白发少女，霓虹灯和电影感构图"
                aria-label="标签助手输入"
              />
              <button
                type="submit"
                disabled={tagSearching || assistantLoading}
                className="flex h-9 w-full items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white disabled:opacity-50"
              >
                <Search size={15} />
                {tagSearching
                  ? "检索中…"
                  : assistantLoading
                    ? "模型分析中…"
                    : "让助手处理"}
              </button>
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
                <b>{signedIn ? (aff?.balance ?? "读取中") : "-"}</b>
              </div>
            </div>
            <Link
              href="/sign-in"
              className="mt-5 flex h-9 items-center justify-center rounded bg-[#292d2c] text-xs font-semibold text-white"
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
          className="panel-resizer hidden lg:block"
          onPointerDown={(event) => startResize("left", event)}
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
              <div className="flex aspect-[4/5] max-h-full w-full max-w-lg flex-col items-center justify-center overflow-hidden border border-[var(--line)] bg-[#ebe9e2] px-4 text-center shadow-[0_20px_70px_rgba(50,45,40,.12)] sm:px-8">
                <WandSparkles
                  className="mb-5 text-[var(--rose)]"
                  size={38}
                  strokeWidth={1.5}
                />
                <h2 className="font-[var(--font-display)] text-2xl">
                  画布等待你的想象
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  选择工具、配置参数并提交。所有入口使用 LFN
                  服务端代理，不向浏览器暴露密钥。
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
                {aff && aff.balance >= estimateAff(model, width, height, steps, count) ? (
                  <>
                    <div>预计消耗 <b className="text-[var(--ink)]">{estimateAff(model, width, height, steps, count)} AFF</b></div>
                    <div>AFF 余额 <b className="text-[var(--ink)]">{aff.balance} AFF</b></div>
                    <div>扣费后约 <b className="text-[var(--ink)]">{aff.balance - estimateAff(model, width, height, steps, count)} AFF</b></div>
                  </>
                ) : (
                  <>
                    <div>预计消耗 <b className="text-[var(--ink)]">${estimateNewApiCost(model, width, height, steps, count)}</b></div>
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
                ? "处理中，请稍候..."
                : `执行${modes.find((item) => item.id === operation)?.label}`}
            </button>
          </div>
        </section>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧面板宽度"
          className="panel-resizer hidden lg:block"
          onPointerDown={(event) => startResize("right", event)}
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
      {mobilePanel && (
        <div
          className="fixed inset-0 z-40 bg-black/35 lg:hidden"
          onClick={() => setMobilePanel(false)}
        >
          <aside
            className="panel flex h-full w-[min(90vw,350px)] flex-col"
            onClick={(event) => event.stopPropagation()}
          >
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
}: {
  label: string;
  value: Upload | null;
  onChange: (value: Upload | null) => void;
}) {
  async function read(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) return;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    onChange({ data, name: file.name });
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
