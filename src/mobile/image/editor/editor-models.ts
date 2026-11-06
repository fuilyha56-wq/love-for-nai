import { resolveImageModelCapabilities, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { filterInpaintModelOptions, filterTiledUpscaleModelOptions, generationModelFor, type ImageModelOption } from "@/lib/inpaint-model";
import { filterNaiModelOptions, type ModelPolicy } from "@/lib/model-policy";
import { canonicalImageModelId, imageModelLabel, normalizeImageModelOptions } from "@/lib/nai-model-catalog";

type MobileEditorMode = "inpaint" | "canvas" | "tiled-upscale";

export function resolveMobileEditorModels({
  mode, catalog, savedModel, protocol, policy,
}: {
  mode: MobileEditorMode;
  catalog: readonly ImageModelOption[];
  savedModel?: string;
  protocol?: ImageProviderProtocol;
  policy: ModelPolicy;
}): ImageModelOption[] {
  const source = catalog.length ? catalog : savedModel ? [{ value: savedModel, label: imageModelLabel(savedModel) }] : [];
  if (mode === "tiled-upscale") return filterTiledUpscaleModelOptions(source, "", protocol, policy);
  if (mode === "inpaint") return filterInpaintModelOptions(source, protocol, policy);
  return filterNaiModelOptions(normalizeImageModelOptions(source), policy)
    .filter(({ value }) => resolveImageModelCapabilities(value, protocol).edit);
}

export function mobileEditorGenerationModel(model: string, providerId: string, catalog: readonly ImageModelOption[]): string | undefined {
  const base = generationModelFor(model);
  if (providerId === "newapi" || providerId === "novelai") return base;
  if (canonicalImageModelId(model) === base) return model;
  return catalog.find(({ value }) => canonicalImageModelId(value) === base)?.value;
}
