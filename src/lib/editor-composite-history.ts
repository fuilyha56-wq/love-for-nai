import { isImageProviderProtocol, type ImageProviderProtocol } from "./image-model-capabilities";

export type ImageHistoryMetadata = {
  providerId?: string;
  imageProtocol?: ImageProviderProtocol;
  quality?: string;
  imageSize?: string;
  background?: string;
};

export type CompositeHistoryInput = ImageHistoryMetadata & {
  image: string;
  model: string;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: string;
  strength: number;
  seed?: number;
};

/** History can contain older entries; only recognized, non-secret output options are reused. */
export function parseImageHistoryMetadata(input: Record<string, unknown>): ImageHistoryMetadata {
  return {
    ...(typeof input.providerId === "string" && /^[\w-]{1,128}$/.test(input.providerId) ? { providerId: input.providerId } : {}),
    ...(isImageProviderProtocol(input.imageProtocol) ? { imageProtocol: input.imageProtocol } : {}),
    ...(typeof input.quality === "string" && ["auto", "low", "medium", "high", "xhigh", "max"].includes(input.quality) ? { quality: input.quality } : {}),
    ...(typeof input.imageSize === "string" && ["512", "1K", "2K", "4K"].includes(input.imageSize) ? { imageSize: input.imageSize } : {}),
    ...(typeof input.background === "string" && ["auto", "opaque", "transparent"].includes(input.background) ? { background: input.background } : {}),
  };
}

export function imageHistoryReuseHref(id: string, parameters: Record<string, unknown>): string {
  const query = new URLSearchParams({ historyId: id });
  for (const [key, value] of Object.entries(parseImageHistoryMetadata(parameters))) query.set(key, value);
  return `/image?${query}`;
}

/** Persist the final full-sized composite, never the generated ROI patch. */
export async function saveEditorComposite(input: CompositeHistoryInput): Promise<string> {
  const response = await fetch("/api/history/editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => ({})) as { id?: unknown; message?: string };
  if (!response.ok || typeof result.id !== "string" || !result.id)
    throw new Error(result.message || "完整合成图未写入历史");
  return result.id;
}
