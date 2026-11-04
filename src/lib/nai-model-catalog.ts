import { naiUpstreamModel, naiUsageModel } from "./nai-native-request";

/**
 * Canonical NAI model directory shared by the studio, editor, pricing and
 * public catalog. Billing IDs remain stable while selectors display native
 * model names and collapse equivalent transport aliases.
 */
export type NaiModelKind = "image" | "chat";

export type NaiModelCatalogEntry = {
  id: string;
  kind: NaiModelKind;
  label: string;
  inpaint: boolean;
};

const IMAGE_MODELS: readonly NaiModelCatalogEntry[] = [
  { id: "nai-v5-full", label: "nai-v5-full", kind: "image", inpaint: false },
  { id: "nai-v5-curated", label: "nai-v5-curated", kind: "image", inpaint: false },
  { id: "nai-v5-inpaint", label: "nai-v5-inpaint", kind: "image", inpaint: true },
  { id: "nai-v5-full-medium", label: "nai-v5-full-medium", kind: "image", inpaint: false },
  { id: "nai-v5-inpaint-medium", label: "nai-v5-inpaint-medium", kind: "image", inpaint: true },
  { id: "nai-v5-full-limit", label: "nai-v5-full-limit", kind: "image", inpaint: false },
  { id: "nai-v5-curated-limit", label: "nai-v5-curated-limit", kind: "image", inpaint: false },
  { id: "nai-v5-inpaint-limit", label: "nai-v5-inpaint-limit", kind: "image", inpaint: true },
  { id: "nai-v4.5-full", label: "nai-v4.5-full", kind: "image", inpaint: false },
  { id: "nai-v4.5-curated", label: "nai-v4.5-curated", kind: "image", inpaint: false },
  { id: "nai-v4.5-inpaint", label: "nai-v4.5-inpaint", kind: "image", inpaint: true },
  { id: "nai-v4.5-curated-inpaint", label: "nai-v4.5-curated-inpaint", kind: "image", inpaint: true },
  { id: "nai-v4.5-full-limit", label: "nai-v4.5-full-limit", kind: "image", inpaint: false },
  { id: "nai-v4.5-curated-limit", label: "nai-v4.5-curated-limit", kind: "image", inpaint: false },
  { id: "nai-v4.5-inpaint-limit", label: "nai-v4.5-inpaint-limit", kind: "image", inpaint: true },
  { id: "nai-v4-curated", label: "nai-v4-curated", kind: "image", inpaint: false },
  { id: "nai-v3", label: "nai-v3", kind: "image", inpaint: false },
  { id: "nai-v3-furry", label: "nai-v3-furry", kind: "image", inpaint: false },
  { id: "nai-v3-inpaint", label: "nai-v3-inpaint", kind: "image", inpaint: true },
  { id: "nai-v3-furry-inpaint", label: "nai-v3-furry-inpaint", kind: "image", inpaint: true },
];

export const NAI_CHAT_MODEL_ID = "nai-chat" as const;

export const NAI_MODEL_CATALOG: readonly NaiModelCatalogEntry[] = [
  ...IMAGE_MODELS,
  { id: NAI_CHAT_MODEL_ID, label: NAI_CHAT_MODEL_ID, kind: "chat", inpaint: false },
];

export const NAI_IMAGE_MODEL_CATALOG = IMAGE_MODELS;
export const NAI_IMAGE_MODEL_IDS = IMAGE_MODELS.map(({ id }) => id);
export const NAI_IMAGE_MODEL_OPTIONS = IMAGE_MODELS.map(({ id }) => ({ value: id, label: imageModelLabel(id) }));

export const NAI_INPAINT_MODEL_OPTIONS = IMAGE_MODELS
  .filter(({ inpaint }) => inpaint)
  .map(({ id }) => [id, imageModelLabel(id)] as const);

/** A billing tier remains a distinct choice even when it uses the same native model. */
export function canonicalImageModelId(model: string): string {
  if (!/^nai-(?!chat$)/i.test(model)) return model;
  return naiUsageModel(model) + (/-limit$/i.test(model) ? "-limit" : "");
}

export function imageModelLabel(model: string): string {
  if (!/^nai-(?!chat$)/i.test(model)) return model;
  const limited = /-limit$/i.test(model);
  return naiUpstreamModel(model.replace(/-limit$/i, "")) + (limited ? "-limit" : "");
}

/** Deduplicate transport aliases without inventing IDs the provider did not advertise. */
export function normalizeImageModelOptions<T extends { value: string; label: string }>(options: readonly T[]): T[] {
  const unique = new Map<string, T>();
  for (const option of options) {
    const key = canonicalImageModelId(option.value);
    const existing = unique.get(key);
    // Prefer the site's billing ID when both forms are available.
    if (!existing || option.value === key) unique.set(key, {
      ...option, label: /^nai-(?!chat$)/i.test(option.value) ? imageModelLabel(option.value) : option.label,
    });
  }
  return [...unique.values()];
}

/** Native API names accepted by the standalone /ai/upscale endpoint. */
export const NAI_UPSCALE_MODEL_OPTIONS = [
  { value: "nai-diffusion-5-curated", label: "V5 Curated（推荐）" },
  { value: "nai-diffusion-5-full", label: "V5 Full" },
] as const;
export const NAI_UPSCALE_MODEL_IDS: readonly string[] = NAI_UPSCALE_MODEL_OPTIONS.map(({ value }) => value);

export function isNaiCatalogImageModel(model: unknown): boolean {
  return typeof model === "string" && IMAGE_MODELS.some((entry) => entry.id === model);
}

export function isNaiUpscaleModel(model: unknown): boolean {
  return typeof model === "string" && NAI_UPSCALE_MODEL_IDS.includes(model);
}

export function firstValidModel(
  current: unknown,
  validModels: readonly string[],
  fallback: string,
): string {
  const candidate = typeof current === "string" ? current : "";
  if (validModels.includes(candidate)) return candidate;
  const equivalent = validModels.find(model => canonicalImageModelId(model) === canonicalImageModelId(candidate));
  return equivalent || validModels[0] || fallback;
}
