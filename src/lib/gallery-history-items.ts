import type { GenerationParameters } from "@/lib/history";
import type { LocalImageHistorySummary } from "@/lib/local-image-history";
import { localHistoryImageSource } from "@/lib/local-history-image-source";
import { remoteStudioHistory, studioHistoryParameters } from "@/lib/studio-history";

export type GalleryHistoryImage = {
  key: string;
  historyId?: string;
  localId?: string;
  ownerId?: number;
  image: string;
  thumbnail: string;
  prompt: string;
  model: string;
  width: number;
  height: number;
  createdAt: number;
  origin: "account" | "local";
  file?: File;
};

export type RemoteGalleryHistoryImage = {
  id: string;
  createdAt: string;
  parameters: GenerationParameters;
};

/** Remote IDs deduplicate present records, not locally retained expired copies. */
export function galleryHistoryItems(remote: RemoteGalleryHistoryImage[], local: LocalImageHistorySummary[], ownerId?: number): GalleryHistoryImage[] {
  const remoteIds = new Set<string>();
  const items: GalleryHistoryImage[] = [];
  for (const item of remote) {
    if (typeof item.id !== "string" || !item.id || remoteIds.has(item.id)) continue;
    remoteIds.add(item.id);
    const image = `/api/history/${encodeURIComponent(item.id)}/image`;
    const normalized = remoteStudioHistory({ ...item, imageUrl: image });
    items.push({ key: `account:${item.id}`, historyId: item.id, image, thumbnail: `${image}?variant=thumbnail`, prompt: normalized.prompt, model: String(normalized.model || "未记录模型"), width: normalized.width, height: normalized.height, createdAt: normalized.createdAt, origin: "account" });
  }
  const localIdentities = new Set<string>();
  for (const item of local) {
    // Unknown legacy ownership cannot grant access to another account's originals.
    // Matching live remote IDs are already represented by authenticated rows above.
    if (!ownerId || item.ownerId !== ownerId || remoteIds.has(item.remoteId || item.id)) continue;
    if (item.imageType && !["image/png", "image/jpeg"].includes(item.imageType)) continue;
    const identity = item.remoteId || item.id;
    if (localIdentities.has(identity)) continue;
    localIdentities.add(identity);
    const normalized = studioHistoryParameters({ operation: item.operation || "generate", prompt: item.prompt, negative_prompt: item.negative, model: item.model, ...item.parameters });
    items.push({ key: `local:${item.id}`, localId: item.id, ownerId, image: localHistoryImageSource(item.id), thumbnail: localHistoryImageSource(item.id, true), prompt: normalized.prompt, model: String(normalized.model || "未记录模型"), width: normalized.width, height: normalized.height, createdAt: item.createdAt, origin: "local" });
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}
