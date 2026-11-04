import { resolveImageModelCapabilities, type ImageProviderProtocol } from "./image-model-capabilities";
import { isNaiMediumModel } from "./nai-native-request";
import { filterNaiModelOptions, isNaiModelEnabledForPolicy, type ModelPolicy } from "./model-policy";
import { canonicalImageModelId, imageModelLabel, normalizeImageModelOptions } from "./nai-model-catalog";

export type ImageModelOption = { value: string; label: string };

/** Use advertised infill IDs where present, otherwise let the operation select infill. */
export function filterInpaintModelOptions(
  options: readonly ImageModelOption[],
  protocol: ImageProviderProtocol | undefined,
  policy: ModelPolicy,
): ImageModelOption[] {
  const available = filterNaiModelOptions(normalizeImageModelOptions(options), policy);
  return available.filter(({ value }) => {
    const infill = inpaintModelFor(value, protocol);
    if (!infill) return false;
    return canonicalImageModelId(value) === canonicalImageModelId(infill) ||
      !available.some((option) => canonicalImageModelId(option.value) === canonicalImageModelId(infill));
  });
}

/** Only offer models that support image-to-image, while honoring the live model policy. */
export function filterTiledUpscaleModelOptions(
  options: readonly ImageModelOption[],
  currentModel: string,
  protocol: ImageProviderProtocol | undefined,
  policy: ModelPolicy,
): ImageModelOption[] {
  const supported = filterNaiModelOptions(normalizeImageModelOptions(options), policy)
    .filter(({ value }) => resolveImageModelCapabilities(value, protocol).family === "nai" &&
      !/-(?:inpaint|inpainting)(?:-|$)/i.test(value) &&
      resolveImageModelCapabilities(value, protocol).operations.includes("img2img"));
  if (
    currentModel &&
    resolveImageModelCapabilities(currentModel, protocol).family === "nai" &&
    !/-(?:inpaint|inpainting)(?:-|$)/i.test(currentModel) &&
    isNaiModelEnabledForPolicy(currentModel, policy) &&
    resolveImageModelCapabilities(currentModel, protocol).operations.includes("img2img") &&
    !supported.some(({ value }) => canonicalImageModelId(value) === canonicalImageModelId(currentModel))
  ) supported.unshift({ value: currentModel, label: imageModelLabel(currentModel) });
  return supported;
}

/** Keep the source family and limit tier when entering either image editor. */
export function inpaintModelFor(model: string, protocol?: ImageProviderProtocol): string | null {
  model = canonicalImageModelId(model);
  if (model === "nai-v4-curated" || model === "nai-diffusion-4-curated-inpainting") return "nai-diffusion-4-curated-inpainting";
  if (model === "nai-v4-full" || model === "nai-diffusion-4-full-inpainting") return "nai-diffusion-4-full-inpainting";
  if (model === "nai-v4.5-curated" || model === "nai-v4.5-curated-inpaint") return "nai-v4.5-curated-inpaint";
  if (isNaiMediumModel(model)) return "nai-v5-inpaint-medium";
  const caps = resolveImageModelCapabilities(model, protocol);
  if (caps.family !== "nai") return caps.edit ? model : null;
  const match = model.match(/^nai-(v5|v4\.5|v3)(-furry)?(?:-full|-curated|-inpaint)?(-limit)?$/);
  if (!match || (match[2] && match[1] !== "v3")) return null;
  return `nai-${match[1]}${match[2] || ""}-inpaint${match[3] || ""}`;
}

/** Return a generation model when leaving NAI's dedicated inpainting models. */
export function generationModelFor(model: string): string {
  model = canonicalImageModelId(model);
  if (model === "nai-diffusion-4-curated-inpainting") return "nai-v4-curated";
  if (model === "nai-diffusion-4-full-inpainting") return "nai-v4-full";
  if (model === "nai-v4.5-curated-inpaint") return "nai-v4.5-curated";
  const match = model.match(/^nai-(v5|v4\.5|v3)(-furry)?-inpaint(-medium|-limit)?$/i);
  if (match) return `nai-${match[1]}${match[2] || ""}${match[1] === "v3" ? "" : "-full"}${match[3] || ""}`;
  return model.replace(/-inpainting$/i, "");
}
