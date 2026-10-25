import { resolveImageModelCapabilities, type ImageProviderProtocol } from "./image-model-capabilities";
import { isNaiMediumModel } from "./nai-native-request";
import { filterNaiModelOptions, isNaiModelEnabledForPolicy, type ModelPolicy } from "./model-policy";

export type ImageModelOption = { value: string; label: string };

/** Only offer models that support image-to-image, while honoring the live model policy. */
export function filterTiledUpscaleModelOptions(
  options: readonly ImageModelOption[],
  currentModel: string,
  protocol: ImageProviderProtocol | undefined,
  policy: ModelPolicy,
): ImageModelOption[] {
  const supported = filterNaiModelOptions(options, policy)
    .filter(({ value }) => resolveImageModelCapabilities(value, protocol).operations.includes("img2img"));
  if (
    currentModel &&
    isNaiModelEnabledForPolicy(currentModel, policy) &&
    resolveImageModelCapabilities(currentModel, protocol).operations.includes("img2img") &&
    !supported.some(({ value }) => value === currentModel)
  ) supported.unshift({ value: currentModel, label: currentModel });
  return supported;
}

/** Keep the source family and limit tier when entering either image editor. */
export function inpaintModelFor(model: string, protocol?: ImageProviderProtocol): string | null {
  if (isNaiMediumModel(model)) return "nai-v5-inpaint-medium";
  const caps = resolveImageModelCapabilities(model, protocol);
  if (caps.family !== "nai") return caps.edit ? model : null;
  const match = model.match(/^nai-(v5|v4\.5|v3)(-furry)?(?:-full|-curated|-inpaint)?(-limit)?$/);
  if (!match || (match[2] && match[1] !== "v3")) return null;
  return `nai-${match[1]}${match[2] || ""}-inpaint${match[3] || ""}`;
}

/** Return a generation model when leaving NAI's dedicated inpainting models. */
export function generationModelFor(model: string): string {
  const match = model.match(/^nai-(v5|v4\.5|v3)(-furry)?-inpaint(-medium|-limit)?$/i);
  if (match) return `nai-${match[1]}${match[2] || ""}${match[1] === "v3" ? "" : "-full"}${match[3] || ""}`;
  return model.replace(/-inpainting$/i, "");
}
