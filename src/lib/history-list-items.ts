import type { LocalImageHistorySummary } from "@/lib/local-image-history";
import { localHistoryImageSource } from "@/lib/local-history-image-source";

export type HistoryListItem = {
  id: string;
  createdAt: string;
  imageUrl: string;
  thumbnailUrl?: string;
  requestId?: string;
  imageSha256?: string;
  parameters: Record<string, string | number>;
  localId?: string;
  account?: boolean;
};

/** Keep older browser copies even after server retention expires. Match image IDs, not batch request IDs. */
export function mergeHistoryListItems(remote: HistoryListItem[], local: LocalImageHistorySummary[], ownerId: number) {
  const remoteIds = new Set(remote.map(item => item.id));
  const merged = new Map<string, HistoryListItem>();
  const localSources: Record<string, string> = {};
  for (const item of local) {
    const id = item.remoteId || item.id;
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0 ||
      (item.ownerId !== ownerId && !(item.ownerId === undefined && remoteIds.has(id)))) continue;
    const parameters = item.parameters || {};
    if (parameters._lfnHistoryVisibility === "intermediate" || parameters._lfnEditorIntermediate === true ||
      parameters.editor_composite === true || item.operation === "editor-tile" || item.operation === "editor-patch" ||
      item.prompt?.includes("continue details naturally across the crop edges")) continue;
    const source = localHistoryImageSource(item.id);
    localSources[id] = source;
    merged.set(id, {
      id, localId: item.id, account: false, createdAt: new Date(item.createdAt).toISOString(),
      imageUrl: source, thumbnailUrl: localHistoryImageSource(item.id, true), requestId: item.requestId,
      parameters: { prompt: item.prompt || "", negative_prompt: item.negative || "", model: item.model || "", operation: item.operation || "generate", ...parameters } as HistoryListItem["parameters"],
    });
  }
  for (const item of remote) {
    const copy = merged.get(item.id);
    merged.set(item.id, { ...item, localId: copy?.localId, account: true, thumbnailUrl: copy?.thumbnailUrl || item.thumbnailUrl || `${item.imageUrl}?variant=thumbnail` });
  }
  return { items: [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), localSources };
}
