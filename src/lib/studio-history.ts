import type { GenerationParameters } from "./history";
import type { LocalImageHistoryItem } from "./local-image-history";
import { localHistoryImageSource } from "./local-history-image-source";

type HistoryIdentity = { id?: string; localId?: string; image: string; historyId?: string; createdAt: number };

export function studioHistoryKey(item: HistoryIdentity): string {
  return item.historyId ? `account:${item.historyId}` : item.localId || item.id || item.image;
}

export function studioHistoryParameters(parameters: GenerationParameters = { operation: "generate" }) {
  return {
    ...parameters,
    prompt: String(parameters.prompt || ""), negative: String(parameters.negative_prompt || ""),
    operation: parameters.operation || "generate", width: Number(parameters.width) || 832,
    height: Number(parameters.height) || 1216, steps: Number(parameters.steps) || 28,
    scale: typeof parameters.scale === "number" ? parameters.scale : 5,
    sampler: String(parameters.sampler || "k_euler_ancestral"),
  };
}

export function remoteStudioHistory(item: { id: string; imageUrl: string; createdAt: string; requestId?: string; parameters: GenerationParameters }) {
  return { ...studioHistoryParameters(item.parameters), id: item.id, historyId: item.id,
    requestId: item.requestId, image: item.imageUrl, createdAt: Date.parse(item.createdAt) || 0 };
}

export function localStudioHistory(item: Omit<LocalImageHistoryItem, "image">, image = localHistoryImageSource(item.id, false, item.ownerId ?? 0)) {
  const imageOwnerId = item.ownerId ?? 0;
  return { ...studioHistoryParameters({ operation: item.operation || "generate", prompt: item.prompt,
    negative_prompt: item.negative, model: item.model, ...item.parameters }),
    id: item.id, localId: item.id, historyId: item.remoteId, requestId: item.requestId, archive: item.archive,
    image, imageOwnerId, previewImage: localHistoryImageSource(item.id, true, imageOwnerId), createdAt: item.createdAt };
}

/** Match persisted stream frames to their final response rows without merging identical samples. */
export function trackStudioStreamResults<T extends { image: string }>(save: (image: string) => Promise<T>) {
  const bySlot = new Map<number, T>();
  return {
    async onFinal(image: string, sampleIndex: number) {
      bySlot.set(sampleIndex, await save(image));
    },
    match(images: string[]) {
      const remaining = [...bySlot.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
      return images.map(image => {
        const index = remaining.findIndex(item => item.image === image);
        return index < 0 ? undefined : remaining.splice(index, 1)[0];
      });
    },
  };
}

/** New session results must remain visible while the account list is refreshing. */
export function mergeStudioHistory<T extends HistoryIdentity>(session: readonly T[], account: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...session, ...account].filter((item) => {
    const key = studioHistoryKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
