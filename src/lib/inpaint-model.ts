import { resolveImageModelCapabilities, type ImageProviderProtocol } from "./image-model-capabilities";

/** Keep the source family and limit tier when entering either image editor. */
export function inpaintModelFor(model: string, protocol?: ImageProviderProtocol): string | null {
  const caps = resolveImageModelCapabilities(model, protocol);
  if (caps.family !== "nai") return caps.edit ? model : null;
  const match = model.match(/^nai-(v5|v4\.5|v3)(-furry)?(?:-full|-curated|-inpaint)?(-limit)?$/);
  if (!match || (match[2] && match[1] !== "v3")) return null;
  return `nai-${match[1]}${match[2] || ""}-inpaint${match[3] || ""}`;
}
