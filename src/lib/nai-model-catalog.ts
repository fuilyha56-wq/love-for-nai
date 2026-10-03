/**
 * Canonical NAI model directory shared by the studio, editor, pricing and
 * public catalog. Keep provider aliases (nai-diffusion-*) out of the image
 * model list; they are transport names used only by the native API.
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
  { id: "nai-v5-full-limit", label: "nai-v5-full-limit", kind: "image", inpaint: false },
  { id: "nai-v5-curated-limit", label: "nai-v5-curated-limit", kind: "image", inpaint: false },
  { id: "nai-v5-inpaint-limit", label: "nai-v5-inpaint-limit", kind: "image", inpaint: true },
  { id: "nai-v4.5-full", label: "nai-v4.5-full", kind: "image", inpaint: false },
  { id: "nai-v4.5-curated", label: "nai-v4.5-curated", kind: "image", inpaint: false },
  { id: "nai-v4.5-inpaint", label: "nai-v4.5-inpaint", kind: "image", inpaint: true },
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
export const NAI_IMAGE_MODEL_OPTIONS = IMAGE_MODELS.map(({ id, label }) => ({ value: id, label }));

export const NAI_INPAINT_MODEL_OPTIONS = IMAGE_MODELS
  .filter(({ inpaint }) => inpaint)
  .map(({ id }) => [id, id.includes("v3-furry") ? "V3 兽人局部重绘" : `${id.startsWith("nai-v5") ? "V5" : id.startsWith("nai-v4.5") ? "V4.5" : "V3"} 局部重绘${id.endsWith("-limit") ? " · 受限" : ""}`] as const);

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
  return validModels.includes(candidate) ? candidate : validModels[0] || fallback;
}
