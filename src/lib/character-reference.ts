import { naiUsageModel } from "./nai-native-request";
import { resolveImageModelCapabilities, type ImageProviderProtocol } from "./image-model-capabilities";

/** Local ownership only. This identifier is never an upstream character binding. */
export type CharacterReferenceBinding = { assetId: string; owner: string; strength: number; fidelity: number };
export type CharacterEditReference = CharacterReferenceBinding & { label: string };

export function parseCharacterReference(value: unknown): CharacterReferenceBinding | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (typeof v.assetId !== "string" || !/^[\w-]{1,160}$/.test(v.assetId) || typeof v.owner !== "string" || !/^(?:guest|[1-9]\d*)$/.test(v.owner)) return;
  const unit = (n: unknown, fallback: number) => typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  return { assetId: v.assetId, owner: v.owner, strength: unit(v.strength, .6), fidelity: unit(v.fidelity, 1) };
}

export function supportsCharacterReferenceEdit(model: string, protocol?: ImageProviderProtocol) {
  const normalized = naiUsageModel(model);
  return /^nai-v(?:4\.5|5)-/.test(normalized) && resolveImageModelCapabilities(normalized, protocol).preciseReference;
}
