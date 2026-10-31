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
  const value = `${model}:${unit(information, 1)}:`;
  const input = new TextEncoder().encode(asset.data);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    return subtle.digest("SHA-256", input).then((buffer) => `${value}${Array.from(new Uint8Array(buffer), (item) => item.toString(16).padStart(2, "0")).join("")}`);
  }

  // Some embedded/web-workbench contexts expose `crypto` without the Web
  // Crypto `subtle` implementation. The digest is only a local cache key, so
  // keep reference uploads usable with a deterministic non-cryptographic
  // fallback instead of failing while a reference is being added.
  let first = 0x811c9dc5;
  let second = 0x9e3779b1;
  let third = 0x85ebca6b;
  let fourth = 0xc2b2ae35;
  for (const byte of input) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x27d4eb2d);
    third = Math.imul(third ^ byte, 0x165667b1);
    fourth = Math.imul(fourth ^ byte, 0x9e3779b1);
  }
  const fallback = [first, second, third, fourth]
    .map((item) => (item >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return Promise.resolve(`${value}${fallback}`);
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
