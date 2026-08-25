"use client";

import {
  Aperture,
  Brush,
  Check,
  ChevronsUpDown,
  Code2,
  Download,
  Eraser,
  ImagePlus,
  Images,
  Menu,
  PawPrint,
  Search,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = { userName: string; authenticated: boolean };
type Me = { user?: { balance: number | null; group: string } };
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
type SelectOption = { value: string; label: string };
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
  const [cfgRescale, setCfgRescale] = useState(1);
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
  const [me, setMe] = useState<Me | null>(null);
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [tagResults, setTagResults] = useState<DanbooruTag[]>([]);
  const [tagSearching, setTagSearching] = useState(false);
  const [assistantModels, setAssistantModels] = useState<SelectOption[]>([]);
  const [assistantModel, setAssistantModel] = useState("");
  const [assistantRequest, setAssistantRequest] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantSuggestion, setAssistantSuggestion] =
    useState<AssistantSuggestion | null>(null);

  useEffect(() => {
    if (authenticated)
      fetch("/api/me")
        .then((response) => response.json())
        .then(setMe)
        .catch(() => setMe(null));
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
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
  }, [authenticated]);

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

  async function searchDanbooru() {
    if (tagQuery.trim().length < 2) {
      setNotice("请输入至少 2 个字符的标签关键词。");
      return;
    }
    setTagSearching(true);
    try {
      const response = await fetch(
        `/api/tags?q=${encodeURIComponent(tagQuery)}`,
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "标签搜索失败");
      setTagResults(result.tags || []);
      if (!result.tags?.length) setNotice("没有找到匹配的 Danbooru 标签。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "标签搜索失败");
    } finally {
      setTagSearching(false);
    }
  }

  async function askTagAssistant() {
    if (!assistantModel) {
      setNotice("当前账户没有可用的非 NAI 文本模型。");
      return;
    }
    if (!assistantRequest.trim()) {
      setNotice("请先描述需要模型整理的画面或标签。");
      return;
    }
    setAssistantLoading(true);
    setAssistantSuggestion(null);
    try {
      const response = await fetch("/api/assistant/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: assistantModel,
          request: assistantRequest,
          currentPrompt: prompt,
          currentNegativePrompt: negative,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "智能助手调用失败");
      setAssistantSuggestion(result.suggestion);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "智能助手调用失败");
    } finally {
      setAssistantLoading(false);
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

  function applyAllSuggestions() {
    if (!assistantSuggestion) return;
    const changes = [
      assistantSuggestion.prompt && "正向提示词",
      assistantSuggestion.negativePrompt && "负向提示词",
      assistantSuggestion.tags.length && "Danbooru 标签",
      Object.keys(assistantSuggestion.parameters).length && "生成参数",
    ].filter(Boolean);
    if (!window.confirm(`确认应用以下变化：${changes.join("、")}？`)) return;
    if (assistantSuggestion.prompt) setPrompt(assistantSuggestion.prompt);
    if (assistantSuggestion.negativePrompt)
      setNegative(assistantSuggestion.negativePrompt);
    assistantSuggestion.tags.forEach((tag) => appendTag(tag.name));
    applySuggestedParameters(assistantSuggestion.parameters);
    setAssistantSuggestion(null);
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
    if (!authenticated) {
      setNotice("体验模式不会发送真实请求。登录后可通过你的 NewAPI 钱包调用。");
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
      cfg_rescale: cfgRescale,
      response_format: "b64_json",
      quality_tags: true,
    };
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
      if (!response.ok) throw new Error(result.message || "操作失败");
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
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "操作失败，请稍后重试",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="flex h-screen min-h-[700px] flex-col overflow-hidden bg-[var(--paper)]">
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
          <span
            className={`hidden px-2 py-1 text-xs sm:inline ${authenticated ? "text-emerald-700" : "text-amber-700"}`}
          >
            {authenticated ? "NewAPI 已连接" : "体验模式"}
          </span>
          <button className="flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm">
            <UserRound size={16} />
            {userName}
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[310px_minmax(420px,1fr)_230px]">
        <aside className="panel hidden min-h-0 border-y-0 border-l-0 lg:flex lg:flex-col">
          {controls}
        </aside>
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
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
            <div className="absolute left-4 top-3 text-xs text-[var(--muted)]">
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
              <div className="grid max-h-full w-full max-w-5xl grid-cols-1 gap-3 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
                {images.map((image, index) => (
                  <div
                    key={`${image.slice(-24)}-${index}`}
                    className="relative overflow-hidden border border-[var(--line)] bg-white"
                  >
                    <Image
                      src={image}
                      alt={`NAI 结果 ${index + 1}`}
                      width={width}
                      height={height}
                      unoptimized
                      className="h-auto w-full object-contain"
                    />
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
              <div className="flex aspect-[4/5] max-h-[calc(100vh-330px)] w-full max-w-lg flex-col items-center justify-center border border-[var(--line)] bg-[#ebe9e2] px-8 text-center shadow-[0_20px_70px_rgba(50,45,40,.12)]">
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
            <div className="mx-4 mb-3 flex items-start justify-between rounded border border-[#e4c991] bg-[#fff8e8] px-4 py-3 text-sm text-[#77531e]">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] bg-[#fffefa] p-3">
            <button
              onClick={runOperation}
              disabled={generating}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded bg-[var(--rose)] font-semibold text-white disabled:opacity-60"
            >
              <Sparkles size={18} />
              {generating
                ? "处理中，请稍候..."
                : `执行${modes.find((item) => item.id === operation)?.label}`}
            </button>
          </div>
        </section>
        <aside className="panel hidden min-h-0 flex-col border-y-0 border-r-0 lg:flex">
          <div className="border-b border-[var(--line)] p-4">
            <b className="text-sm">创作中心</b>
            <nav className="mt-3 grid grid-cols-2 gap-2">
              <FeatureLink
                href="/history"
                label="图片历史"
                icon={<Images size={15} />}
              />
              <FeatureLink
                href="/profile"
                label="个人资料"
                icon={<UserRound size={15} />}
              />
              <FeatureLink
                href="/usage"
                label="使用记录"
                icon={<SlidersHorizontal size={15} />}
              />
              <FeatureLink
                href="/wallet"
                label="余额钱包"
                icon={<Aperture size={15} />}
              />
              <FeatureLink
                href="/models"
                label="可用模型"
                icon={<Sparkles size={15} />}
              />
              <FeatureLink
                href="/keys"
                label="API 密钥"
                icon={<Code2 size={15} />}
              />
            </nav>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border-b border-[var(--line)] p-4">
            <b className="text-sm">Danbooru 标签检索</b>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              支持中文常用词和规范英文标签。
            </p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                searchDanbooru();
              }}
            >
              <input
                className="field min-w-0 flex-1 px-2 text-xs"
                value={tagQuery}
                onChange={(event) => setTagQuery(event.target.value)}
                placeholder="如：白发"
                aria-label="Danbooru 标签关键词"
              />
              <button
                type="submit"
                disabled={tagSearching}
                className="grid h-10 w-10 shrink-0 place-items-center rounded bg-[#292d2c] text-white disabled:opacity-50"
                title="搜索标签"
              >
                <Search size={16} />
              </button>
            </form>
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
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <b className="text-sm">LLM 智能检索</b>
              <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                由你的 NewAPI 模型整理需求，再用 Danbooru 官方数据校验。
              </p>
              {authenticated ? (
                <div className="mt-3 space-y-2">
                  {assistantModels.length ? (
                    <PopupSelect
                      value={assistantModel}
                      options={assistantModels}
                      onChange={setAssistantModel}
                      ariaLabel="智能助手模型"
                      searchable
                    />
                  ) : (
                    <p className="text-[11px] text-[var(--muted)]">
                      正在读取可用文本模型…
                    </p>
                  )}
                  <textarea
                    className="field min-h-20 w-full resize-y p-2 text-xs"
                    value={assistantRequest}
                    onChange={(event) =>
                      setAssistantRequest(event.target.value)
                    }
                    placeholder="例如：雨夜里的白发少女，霓虹灯和电影感构图"
                    aria-label="智能标签创作需求"
                  />
                  <button
                    type="button"
                    onClick={askTagAssistant}
                    disabled={assistantLoading || !assistantModel}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <WandSparkles size={15} />
                    {assistantLoading ? "模型分析中…" : "生成并校验建议"}
                  </button>
                </div>
              ) : (
                <p className="mt-3 rounded border border-[var(--line)] bg-white p-2 text-[11px] leading-5 text-[var(--muted)]">
                  登录后可选择自己的 NewAPI 文本模型。模型调用会按原规则计费。
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
                  {authenticated
                    ? me?.user?.balance == null
                      ? "读取中"
                      : me.user.balance.toFixed(2)
                    : "体验模式"}
                </b>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">分组</span>
                <b>{me?.user?.group || "-"}</b>
              </div>
            </div>
            <Link
              href="/sign-in"
              className="mt-5 flex h-9 items-center justify-center rounded bg-[#292d2c] text-xs font-semibold text-white"
            >
              {authenticated ? "切换账户" : "登录使用真实余额"}
            </Link>
          </div>
        </aside>
      </div>
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
function PopupSelect({
  value,
  options,
  onChange,
  ariaLabel,
  searchable,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const visible =
    searchable && query.trim()
      ? options.filter((option) =>
          `${option.label} ${option.value}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
      : options;

  function positionMenu() {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const gap = 6;
    const availableBelow = window.innerHeight - trigger.bottom - gap - 8;
    const availableAbove = trigger.top - gap - 8;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    setMenuStyle({
      position: "fixed",
      left: trigger.left,
      top: openAbove ? undefined : trigger.bottom + gap,
      bottom: openAbove ? window.innerHeight - trigger.top + gap : undefined,
      width: trigger.width,
      maxHeight: Math.max(
        120,
        Math.min(360, openAbove ? availableAbove : availableBelow),
      ),
    });
  }

  useLayoutEffect(() => {
    if (open) positionMenu();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const scrollContainer = rootRef.current?.closest(
      ".settings-scroll",
    ) as HTMLElement | null;
    const previousOverflow = scrollContainer?.style.overflowY || "";
    if (scrollContainer) scrollContainer.style.overflowY = "hidden";
    function close(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionMenu);
    return () => {
      if (scrollContainer) scrollContainer.style.overflowY = previousOverflow;
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open]);

  function select(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  const selected = options.find((option) => option.value === value);

  return (
    <div className="popup-select" ref={rootRef}>
      <button
        type="button"
        className="popup-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const current = options.findIndex((option) => option.value === value);
          const direction = event.key === "ArrowDown" ? 1 : -1;
          select(
            options[(current + direction + options.length) % options.length],
          );
        }}
      >
        <span>{selected?.label || value}</span>
        <span className="popup-select-chevrons" aria-hidden="true">
          <ChevronsUpDown size={12} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            id={listboxId}
            ref={menuRef}
            className="popup-select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            onWheel={(event) => event.stopPropagation()}
          >
            {searchable && (
              <div className="popup-select-search">
                <Search size={12} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索模型"
                  aria-label="搜索模型"
                  autoFocus
                />
              </div>
            )}
            <div className="popup-select-options">
              {visible.length === 0 ? (
                <p className="popup-select-empty">没有匹配的模型</p>
              ) : (
                visible.map((option) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className="popup-select-option"
                    key={option.value}
                    onClick={() => select(option)}
                  >
                    <Check
                      size={13}
                      className={
                        option.value === value ? "opacity-100" : "opacity-0"
                      }
                    />
                    <span>{option.label}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
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
        className="h-16 w-full resize-none text-sm leading-6 outline-none"
      />
    </label>
  );
}
