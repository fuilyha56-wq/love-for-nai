/** Shared by the studio, assistant and server adapters. Endpoint selection is explicit for gateways. */
export type ImageProviderProtocol = "auto" | "openai-images" | "gemini" | "openai-chat-images";
/** Canonical product families used by prompts/history; transport protocol stays independent. */
export type ImageModelFamily = "nai" | "gpt-image" | "nano-banana" | "gemini" | "openai-image";
export type ImageProductMode = "nai" | "gpt" | "nano-banana";
export type ImageModelCapabilities = {
  family: ImageModelFamily;
  promptStyle: "tags" | "natural";
  protocol: "nai" | Exclude<ImageProviderProtocol, "auto">;
  operations: readonly string[];
  edit: boolean;
  nativeMask: boolean;
  acceptsNegative: boolean;
  seed: boolean;
  sampling: boolean;
  characters: boolean;
  vibe: boolean;
  preciseReference: boolean;
  sizes: readonly string[];
  aspectRatios: readonly string[];
  qualityOptions: readonly string[];
  imageSizes: readonly string[];
  sizeConstraints: { multipleOf: number; minPixels: number; maxPixels: number; maxEdge: number; maxAspectRatio: number } | null;
  maxBatch: number;
};

const EDIT_OPERATIONS = ["generate", "img2img", "inpainting", "edits", "outpainting", "vibe-transfer", "character-reference", "precise-reference", "director-declutter", "director-bg-remover", "director-lineart", "director-sketch", "director-colorize", "director-emotion", "upscale"] as const;
const GEMINI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;

export function isImageProviderProtocol(value: unknown): value is ImageProviderProtocol {
  return value === "auto" || value === "openai-images" || value === "gemini" || value === "openai-chat-images";
}

export function isKnownImageModel(model: string): boolean {
  return /^(?:nai-(?!chat$)|gpt-image|chatgpt-image|dall-e|flux(?:\.|-|$)|stable-diffusion|sdxl|imagen|ideogram|recraft|midjourney|seedream|sd3(?:\.|-|$)|nano[-_ ]?banana)/i.test(model) || /^gemini-.*(?:image|imagen)/i.test(model);
}

function isNanoBananaModel(model: string): boolean {
  return /^nano[-_ ]?banana(?:$|[-_.])/i.test(model);
}

function isGeminiImageModel(model: string): boolean {
  return /^gemini-.*image/i.test(model);
}

export function imageProductMode(model: string): ImageProductMode {
  const caps = resolveImageModelCapabilities(model, "auto");
  if (caps.family === "nai") return "nai";
  if (caps.family === "nano-banana" || caps.family === "gemini") return "nano-banana";
  return "gpt";
}

export function productModeProtocol(mode: ImageProductMode): ImageProviderProtocol {
  return mode === "nai" ? "auto" : mode === "nano-banana" ? "gemini" : "openai-images";
}

export function modelMatchesProductMode(model: string, mode: ImageProductMode): boolean {
  return imageProductMode(model) === mode;
}

export function resolveImageModelCapabilities(model: string, protocol: ImageProviderProtocol = "auto"): ImageModelCapabilities {
  const nai = /^nai-(?!chat$)/i.test(model);
  const gpt = /^(?:gpt-image|chatgpt-image)/i.test(model);
  const nanoBanana = isNanoBananaModel(model);
  const gemini = isGeminiImageModel(model) || /^gemini-.*imagen/i.test(model) || nanoBanana || protocol === "gemini";
  // Nano Banana is a Google-native product alias. Auto selects Gemini for it,
  // while an explicit gateway protocol remains an intentional transport override.
  const transport = protocol === "auto" ? (nanoBanana ? "gemini" : "openai-images") : protocol;
  const edit = nai || gpt || gemini || protocol === "openai-chat-images" || /^dall-e-2$/i.test(model);
  const family = nai ? "nai" : gpt ? "gpt-image" : nanoBanana ? "nano-banana" : gemini ? "gemini" : "openai-image";
  const flexibleGpt = /^gpt-image-2(?:\.5)?(?:-|$)/i.test(model);
  const geminiHighResolution = /(?:gemini-3|nano[-_ ]?banana-(?:pro|2))/i.test(model) && !/lite/i.test(model);
  return {
    family,
    promptStyle: nai ? "tags" : "natural",
    protocol: nai ? "nai" : transport,
    operations: nai ? [...EDIT_OPERATIONS, "suggest-tags", "encode-vibe"] : edit ? EDIT_OPERATIONS : ["generate"],
    edit,
    nativeMask: nai || (transport === "openai-images" && (gpt || /^dall-e-2$/i.test(model))),
    acceptsNegative: nai,
    seed: nai,
    sampling: nai,
    characters: nai,
    vibe: nai,
    preciseReference: nai,
    sizes: nai || flexibleGpt ? [] : gpt ? ["1024x1024", "1536x1024", "1024x1536"] : /^dall-e-3$/i.test(model) ? ["1024x1024", "1792x1024", "1024x1792"] : /^dall-e-2$/i.test(model) ? ["256x256", "512x512", "1024x1024"] : [],
    aspectRatios: gemini ? GEMINI_RATIOS : [],
    qualityOptions: gpt && transport === "openai-images" ? ["auto", "low", "medium", "high", ...(/^gpt-image-2\.5(?:[.-]|$)/i.test(model) ? ["xhigh", "max"] : [])] : [],
    imageSizes: gemini && transport === "gemini" ? geminiHighResolution ? ["1K", "2K", "4K", ...(/(?:3\.1.*flash|banana-2)/i.test(model) ? ["512"] : [])] : ["1K"] : [],
    sizeConstraints: flexibleGpt ? { multipleOf: 16, minPixels: 655_360, maxPixels: 8_294_400, maxEdge: 3840, maxAspectRatio: 3 } : null,
    maxBatch: nai ? 8 : gemini || /^dall-e-3$/i.test(model) || transport === "openai-chat-images" ? 1 : 8,
  };
}

/** Google native URLs use Gemini REST; compatible gateways keep their selected protocol. */
export function resolveProviderImageProtocol(protocol: ImageProviderProtocol | undefined, baseUrl: string): ImageProviderProtocol {
  if (protocol && protocol !== "auto") return protocol;
  try { if (new URL(baseUrl).hostname === "generativelanguage.googleapis.com") return "gemini"; } catch { /* validation is performed server side */ }
  return "auto";
}

export function nearestImageSize(width: number, height: number, sizes: readonly string[]): string {
  if (!sizes.length) return `${width}x${height}`;
  const ratio = width / height;
  return sizes.reduce((best, size) => {
    const score = (candidate: string) => {
      const [w, h] = candidate.split("x").map(Number);
      return Math.abs(Math.log((w / h) / ratio)) + Math.abs(Math.log((w * h) / (width * height))) * 0.01;
    };
    return score(size) < score(best) ? size : best;
  }, sizes[0]);
}

export function nearestImageAspectRatio(width: number, height: number, ratios: readonly string[] = GEMINI_RATIOS): string {
  return ratios.reduce((best, ratio) => {
    const distance = (value: string) => { const [w, h] = value.split(":").map(Number); return Math.abs(Math.log((w / h) / (width / height))); };
    return distance(ratio) < distance(best) ? ratio : best;
  }, ratios[0] ?? "1:1");
}

/** Convert legacy dimensions/ROI patch sizes into valid model output dimensions. */
export function normalizeImageModelSize(model: string, width: number, height: number, protocol: ImageProviderProtocol = "auto"): { width: number; height: number } {
  const capabilities = resolveImageModelCapabilities(model, protocol);
  if (capabilities.sizes.length) {
    const [w, h] = nearestImageSize(width, height, capabilities.sizes).split("x").map(Number);
    return { width: w, height: h };
  }
  const constraints = capabilities.sizeConstraints;
  if (!constraints || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width, height };
  let w = width;
  let h = height;
  if (w / h > constraints.maxAspectRatio) h = w / constraints.maxAspectRatio;
  if (h / w > constraints.maxAspectRatio) w = h / constraints.maxAspectRatio;
  let scale = Math.min(1, constraints.maxEdge / Math.max(w, h), Math.sqrt(constraints.maxPixels / (w * h)));
  if (w * h * scale * scale < constraints.minPixels) scale = Math.sqrt(constraints.minPixels / (w * h));
  w = Math.max(constraints.multipleOf, Math.min(constraints.maxEdge, Math.round(w * scale / constraints.multipleOf) * constraints.multipleOf));
  h = Math.max(constraints.multipleOf, Math.min(constraints.maxEdge, Math.round(h * scale / constraints.multipleOf) * constraints.multipleOf));
  while (w * h < constraints.minPixels) { if (w <= h) w += constraints.multipleOf; else h += constraints.multipleOf; }
  while (w * h > constraints.maxPixels) { if (w >= h) w -= constraints.multipleOf; else h -= constraints.multipleOf; }
  if (w / h > constraints.maxAspectRatio) h = Math.ceil(w / constraints.maxAspectRatio / constraints.multipleOf) * constraints.multipleOf;
  if (h / w > constraints.maxAspectRatio) w = Math.ceil(h / constraints.maxAspectRatio / constraints.multipleOf) * constraints.multipleOf;
  return { width: w, height: h };
}
