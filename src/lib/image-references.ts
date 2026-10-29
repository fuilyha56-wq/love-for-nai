export const MAX_STUDIO_REFERENCES = 12;
export type ImageReferenceKind = "vibe-transfer" | "precise-reference";
export type ReferenceKind = "character&style" | "character" | "style";
export type ImageReferenceAsset = { id: string; name: string; data: string; createdAt: number };
export type ImageReferenceSelection = ImageReferenceAsset & {
  enabled: boolean;
  strength: number;
  information: number;
  fidelity: number;
  referenceType: ReferenceKind;
};
export type EncodedImageReference = { key: string; data: string; model: string; information: number; createdAt: number };
export type ImageReferenceBundle = { version: 1; kind: ImageReferenceKind; references: ImageReferenceSelection[] };

const unit = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export function isReferenceKind(value: unknown): value is ReferenceKind { return value === "character&style" || value === "character" || value === "style"; }
export function createImageReference(asset: ImageReferenceAsset): ImageReferenceSelection {
  return { ...asset, enabled: true, strength: 0.6, information: 1, fidelity: 1, referenceType: "character&style" };
}
export function parseImageReferenceBundle(input: unknown): ImageReferenceBundle {
  if (!input || typeof input !== "object") throw new Error("参考配置格式不正确。");
  const value = input as Record<string, unknown>;
  if (value.version !== 1 || (value.kind !== "vibe-transfer" && value.kind !== "precise-reference") || !Array.isArray(value.references) || value.references.length > MAX_STUDIO_REFERENCES) throw new Error("参考配置版本或数量不正确。");
  const references = value.references.map((raw): ImageReferenceSelection => {
    if (!raw || typeof raw !== "object") throw new Error("参考图内容不完整。");
    const item = raw as Record<string, unknown>;
    if (typeof item.data !== "string" || item.data.length > 24 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.data)) throw new Error("配置中包含不支持的参考图。");
    return {
      id: crypto.randomUUID(), name: typeof item.name === "string" ? item.name.slice(0, 160) : "导入参考图",
      data: item.data, createdAt: Date.now(), enabled: item.enabled !== false,
      strength: unit(item.strength, 0.6), information: unit(item.information, 1), fidelity: unit(item.fidelity, 1),
      referenceType: isReferenceKind(item.referenceType) ? item.referenceType : "character&style",
    };
  });
  return { version: 1, kind: value.kind, references };
}

export function referenceEncodingKey(asset: Pick<ImageReferenceAsset, "data">, model: string, information: number): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(asset.data)).then((buffer) => `${model}:${unit(information, 1)}:${Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, "0")).join("")}`);
}

export function buildImageReferenceParameters(kind: ImageReferenceKind, selections: readonly ImageReferenceSelection[], cache: Readonly<Record<string, EncodedImageReference | undefined>> = {}, model?: string) {
  const active = selections.filter((item) => item.enabled).slice(0, MAX_STUDIO_REFERENCES);
  if (kind === "precise-reference") return {
    references: active.map((item) => ({ reference_image: item.data, reference_type: item.referenceType, strength: item.strength, fidelity: item.fidelity })),
  };
  // Native Vibe generation accepts embeddings, never unencoded source images.
  const usable = (item: ImageReferenceSelection) => cache[item.id]?.information === item.information && (!model || cache[item.id]?.model === model);
  if (active.some((item) => !usable(item))) throw new Error("参考图尚未完成风格预处理。");
  return {
    reference_images: active.map((item) => cache[item.id]!.data),
    reference_strength_multiple: active.map((item) => item.strength),
    reference_information_extracted_multiple: active.map((item) => item.information),
  };
}
