import { saveLocalImageHistory } from "@/lib/local-image-history";
import type { EditorDocument, PendingCandidate } from "@/lib/image-editor";
import { tiledResultDownloadUrl } from "@/lib/image-tile-upscale-browser";
import { downloadLocalTiledUpscaleResult, saveLocalTiledUpscaleResult } from "@/lib/local-tiled-upscale-result";

export async function saveEditorImageLocally({
  candidate, image, document, ownerId, operation, editorDraftId, prompt, negative, signal, onProgress,
}: {
  candidate: Pick<PendingCandidate, "id" | "createdAt" | "tiledResultId" | "seed">;
  image: Blob;
  document: EditorDocument;
  ownerId: number;
  operation: string;
  editorDraftId?: string;
  prompt: string;
  negative: string;
  signal?: AbortSignal;
  onProgress?: (progress: { bytes: number; total?: number }) => void;
}) {
  const archive = candidate.tiledResultId ? await saveLocalTiledUpscaleResult(
    candidate.tiledResultId, tiledResultDownloadUrl(candidate.tiledResultId), { signal, onProgress },
  ) : undefined;
  await saveLocalImageHistory({
    id: candidate.id,
    ownerId,
    createdAt: candidate.createdAt ?? Date.now(),
    image,
    archive,
    prompt,
    negative,
    model: document.generation?.model,
    operation,
    parameters: {
      ...document.generation,
      width: archive?.width ?? document.image.width,
      height: archive?.height ?? document.image.height,
      ...(editorDraftId ? { editorDraftId } : {}),
      ...(candidate.seed != null ? { seed: candidate.seed } : {}),
      _lfnEditorHistoryManaged: true,
    },
  });
}

export async function downloadEditorTiledResult(id: string, filename: string) {
  if (await downloadLocalTiledUpscaleResult(id, filename)) return;
  const link = document.createElement("a");
  link.href = tiledResultDownloadUrl(id);
  link.download = filename;
  link.click();
}
