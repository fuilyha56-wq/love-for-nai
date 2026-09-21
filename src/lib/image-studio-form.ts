export const IMAGE_STUDIO_FORM_STORAGE_KEY = "lfn-image-studio-form-v1";
export const IMAGE_EDITOR_PROMPT_HANDOFF_KEY = "lfn-image-editor-prompt-handoff-v1";
export const IMAGE_STUDIO_FORM_VERSION = 1 as const;

export type ImageEditorPromptHandoff = {
  version: 1;
  draftId: string;
  prompt: string;
  negative: string;
  updatedAt: number;
};

export type ImageStudioCharacterSnapshot = {
  prompt: string;
  centerX: number;
  centerY: number;
};

export type ImageStudioFormSnapshot = {
  version: typeof IMAGE_STUDIO_FORM_VERSION;
  operation: string;
  contentMode: "anime" | "furry";
  model: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  count: number;
  batchMode: "once" | "sequential";
  sampler: string;
  schedule: string;
  cfgRescale: number;
  seed: string;
  strength: number;
  vibeStrength: number;
  vibeInformationExtracted: number;
  referenceType: string;
  controlModel: string;
  upscaleModel: string;
  charactersEnabled: boolean;
  characters: ImageStudioCharacterSnapshot[];
};

export const DEFAULT_IMAGE_STUDIO_FORM: ImageStudioFormSnapshot = {
  version: IMAGE_STUDIO_FORM_VERSION,
  operation: "generate",
  contentMode: "anime",
  model: "nai-v5-full",
  prompt: "masterpiece, best quality, 1girl, white hair, crimson eyes, intricate kimono, soft window light",
  negative: "lowres, bad anatomy, blurry, text, watermark",
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  count: 1,
  batchMode: "sequential",
  sampler: "k_euler_ancestral",
  schedule: "native",
  cfgRescale: 0,
  seed: "",
  strength: 0.7,
  vibeStrength: 0.6,
  vibeInformationExtracted: 1,
  referenceType: "character&style",
  controlModel: "hed",
  upscaleModel: "nai-diffusion-5-curated",
  charactersEnabled: false,
  characters: [{ prompt: "", centerX: 0.5, centerY: 0.5 }],
};

const OPERATIONS = new Set([
  "generate", "img2img", "inpainting", "edits", "vibe-transfer",
  "character-reference", "precise-reference", "annotate", "upscale",
  "director-declutter", "director-bg-remover", "director-lineart",
  "director-sketch", "director-colorize", "director-emotion", "suggest-tags",
]);
const MODELS = new Set([
  "nai-v5-full", "nai-v5-curated", "nai-v5-inpaint", "nai-v5-full-limit",
  "nai-v5-curated-limit", "nai-v5-inpaint-limit", "nai-v4.5-full",
  "nai-v4.5-curated", "nai-v4.5-inpaint", "nai-v4.5-full-limit",
  "nai-v4.5-curated-limit", "nai-v4.5-inpaint-limit", "nai-v4-curated",
  "nai-v3", "nai-v3-furry", "nai-v3-inpaint", "nai-v3-furry-inpaint",
]);
const SAMPLERS = new Set(["k_euler", "k_euler_ancestral", "k_dpmpp_2s_ancestral", "k_dpmpp_2m", "k_dpmpp_2m_sde", "k_dpmpp_sde", "ddim_v3"]);
const SCHEDULES = new Set(["native", "karras", "exponential", "polyexponential"]);
const REFERENCE_TYPES = new Set(["character", "style", "character&style"]);
const CONTROL_MODELS = new Set(["canny", "hed", "midas", "mlsd", "openpose", "uniformer", "fake_scribble"]);
const UPSCALE_MODELS = new Set(["nai-diffusion-5-full", "nai-diffusion-5-curated"]);

function stringValue(value: unknown, fallback: string, maxLength = 20_000): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}
function enumValue(value: unknown, allowed: Set<string>, fallback: string): string {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}
function numberValue(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = integer ? Math.round(value) : value;
  return Math.min(max, Math.max(min, normalized));
}
function alignedDimension(value: unknown, fallback: number): number {
  const normalized = numberValue(value, fallback, 64, 1600, true);
  return Math.max(64, Math.min(1600, Math.round(normalized / 64) * 64));
}

export function parseImageStudioForm(input: unknown): ImageStudioFormSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ...DEFAULT_IMAGE_STUDIO_FORM, characters: DEFAULT_IMAGE_STUDIO_FORM.characters.map((item) => ({ ...item })) };
  const record = input as Record<string, unknown>;
  if (record.version !== undefined && record.version !== IMAGE_STUDIO_FORM_VERSION) return { ...DEFAULT_IMAGE_STUDIO_FORM, characters: DEFAULT_IMAGE_STUDIO_FORM.characters.map((item) => ({ ...item })) };
  const rawCharacters = Array.isArray(record.characters) ? record.characters : [];
  const characters = rawCharacters.slice(0, 6).map((item) => {
    const character = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      prompt: stringValue(character.prompt, "", 4_000),
      centerX: numberValue(character.centerX, 0.5, 0, 1),
      centerY: numberValue(character.centerY, 0.5, 0, 1),
    };
  });
  return {
    version: IMAGE_STUDIO_FORM_VERSION,
    operation: enumValue(record.operation, OPERATIONS, DEFAULT_IMAGE_STUDIO_FORM.operation),
    contentMode: record.contentMode === "furry" ? "furry" : "anime",
    model: enumValue(record.model, MODELS, DEFAULT_IMAGE_STUDIO_FORM.model),
    prompt: stringValue(record.prompt, DEFAULT_IMAGE_STUDIO_FORM.prompt),
    negative: stringValue(record.negative, DEFAULT_IMAGE_STUDIO_FORM.negative),
    width: alignedDimension(record.width, DEFAULT_IMAGE_STUDIO_FORM.width),
    height: alignedDimension(record.height, DEFAULT_IMAGE_STUDIO_FORM.height),
    steps: numberValue(record.steps, 28, 1, 50, true),
    scale: numberValue(record.scale, 5, 0, 10),
    count: numberValue(record.count, 1, 1, 30, true),
    batchMode: record.batchMode === "once" ? "once" : "sequential",
    sampler: enumValue(record.sampler, SAMPLERS, DEFAULT_IMAGE_STUDIO_FORM.sampler),
    schedule: enumValue(record.schedule, SCHEDULES, DEFAULT_IMAGE_STUDIO_FORM.schedule),
    cfgRescale: numberValue(record.cfgRescale, 0, 0, 1),
    seed: stringValue(record.seed, "", 20),
    strength: numberValue(record.strength, 0.7, 0, 1),
    vibeStrength: numberValue(record.vibeStrength, 0.6, 0, 1),
    vibeInformationExtracted: numberValue(record.vibeInformationExtracted, 1, 0, 1),
    referenceType: enumValue(record.referenceType, REFERENCE_TYPES, DEFAULT_IMAGE_STUDIO_FORM.referenceType),
    controlModel: enumValue(record.controlModel, CONTROL_MODELS, DEFAULT_IMAGE_STUDIO_FORM.controlModel),
    upscaleModel: enumValue(record.upscaleModel, UPSCALE_MODELS, DEFAULT_IMAGE_STUDIO_FORM.upscaleModel),
    charactersEnabled: record.charactersEnabled === true,
    characters: characters.length ? characters : DEFAULT_IMAGE_STUDIO_FORM.characters.map((item) => ({ ...item })),
  };
}

export function loadImageStudioForm(): ImageStudioFormSnapshot {
  if (typeof window === "undefined") return parseImageStudioForm(null);
  try {
    const raw = window.localStorage.getItem(IMAGE_STUDIO_FORM_STORAGE_KEY);
    return raw ? parseImageStudioForm(JSON.parse(raw)) : parseImageStudioForm(null);
  } catch {
    return parseImageStudioForm(null);
  }
}

export function saveImageStudioForm(snapshot: ImageStudioFormSnapshot): ImageStudioFormSnapshot {
  const normalized = parseImageStudioForm(snapshot);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(IMAGE_STUDIO_FORM_STORAGE_KEY, JSON.stringify(normalized)); } catch { /* Storage may be unavailable or full. */ }
  }
  return normalized;
}

export function saveEditorPromptHandoff(
  draftId: string,
  prompt: string,
  negative: string,
): ImageEditorPromptHandoff | null {
  if (!draftId || typeof window === "undefined") return null;
  const handoff: ImageEditorPromptHandoff = {
    version: 1,
    draftId: draftId.slice(0, 100),
    prompt: prompt.slice(0, 20_000),
    negative: negative.slice(0, 20_000),
    updatedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(IMAGE_EDITOR_PROMPT_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    return null;
  }
  return handoff;
}

export function syncEditorPromptToStudioForm(
  draftId: string,
  prompt: string,
  negative: string,
): ImageEditorPromptHandoff | null {
  const handoff = saveEditorPromptHandoff(draftId, prompt, negative);
  if (typeof window !== "undefined") {
    const current = loadImageStudioForm();
    saveImageStudioForm({ ...current, prompt, negative });
  }
  return handoff;
}

export function loadEditorPromptHandoff(
  draftId?: string | null,
): ImageEditorPromptHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(IMAGE_EDITOR_PROMPT_HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ImageEditorPromptHandoff>;
    if (
      value.version !== 1 ||
      typeof value.draftId !== "string" ||
      typeof value.prompt !== "string" ||
      typeof value.negative !== "string" ||
      typeof value.updatedAt !== "number" ||
      (draftId && value.draftId !== draftId)
    ) return null;
    return {
      version: 1,
      draftId: value.draftId,
      prompt: value.prompt.slice(0, 20_000),
      negative: value.negative.slice(0, 20_000),
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

export function clearEditorPromptHandoff(): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(IMAGE_EDITOR_PROMPT_HANDOFF_KEY); } catch { /* Ignore private-mode storage errors. */ }
}

export function clearImageStudioForm(): void {
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(IMAGE_STUDIO_FORM_STORAGE_KEY); } catch { /* Ignore private-mode storage errors. */ }
  }
}
