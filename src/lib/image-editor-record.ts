import { createEditorDocument, createRgbaImage, type EditorGenerationSettings, type RgbaImage } from "@/lib/image-editor";
import { createEditorDraft, type EditorDraft } from "@/lib/image-editor-store";
import {
  createEditorHistoryId, createEditorHistoryRoot, editorHistoryChanged, EDITOR_HISTORY_OPERATION_LABELS,
  findEditorHistoryImageNode, getEditorHistoryProjectMetadata, listEditorHistory, loadEditorHistoryNode,
  saveEditorHistoryCheckpoint, type EditorHistoryOperation, type EditorHistoryReference,
  type EditorHistorySnapshot, type LoadedEditorHistoryNode,
  markLegacyEditorHistoryImported, editorHistoryOperation,
  fingerprintEditorHistoryImage,
} from "@/lib/image-editor-history";
import { listLocalImageHistory } from "@/lib/local-image-history";

export function editorHistoryNodeDraft(node: LoadedEditorHistoryNode, branchId = node.branchId): EditorDraft {
  return {
    ...createEditorDraft(node.draftId, node.mode === "canvas" ? "canvas" : "inpaint", { ...node.document, image: node.image }),
    workspace: node.workspace, historyNodeId: node.id, historyBranchId: branchId, historyTileScale: node.tileScale,
  };
}

export async function decodeEditorHistoryImage(value: string | Blob): Promise<RgbaImage> {
  const blob = typeof value === "string" ? await (await fetch(value)).blob() : value;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法读取重绘记录图片");
    context.drawImage(bitmap, 0, 0);
    return createRgbaImage(canvas.width, canvas.height, context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally { bitmap.close(); }
}

export function editorHistoryImageBlob(image: RgbaImage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("无法预览重绘历史图片"));
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法导出历史图片")), "image/png"));
}

function snapshot(image: RgbaImage, operation: EditorHistoryOperation, name: string, generation?: EditorGenerationSettings, prompt = "", negative = ""): EditorHistorySnapshot {
  const viewport = { x: 0, y: 0, width: image.width, height: image.height };
  return {
    document: createEditorDocument(image, viewport, { source: { name, mimeType: "image/png" }, prompt, negativePrompt: negative, generation }),
    mode: operation === "canvas" ? "canvas" : operation === "tiled-upscale" ? "tiled-upscale" : "inpaint", tileScale: 2,
    workspace: { viewport, camera: { x: 0, y: 0, zoom: 0.5 }, strokes: [], undone: [], tool: "pan", brushSize: 80, maskColor: "#a83a4c", maskOpacity: 52, showMaskPreview: true, canvasBackground: "checker" },
  };
}

export type RecordImageEditOptions = EditorHistoryReference & {
  image: string | Blob; sourceImage?: string; name?: string; operation: EditorHistoryOperation;
  generation?: EditorGenerationSettings; prompt?: string; negative?: string;
  recordId?: string; createdAt?: number; legacy?: boolean;
};

/** Record only completed transformations. Importing a source or opening the editor never calls this. */
let studioRecordQueue: Promise<void> = Promise.resolve();
export function recordStudioImageEdit(options: RecordImageEditOptions): Promise<EditorHistoryReference> {
  const task = studioRecordQueue.catch(() => undefined).then(() => recordStudioImageEditNow(options));
  studioRecordQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function recordStudioImageEditNow(options: RecordImageEditOptions): Promise<EditorHistoryReference> {
  const image = await decodeEditorHistoryImage(options.image);
  const migrationId = options.legacy && options.recordId ? `legacy-edit-${options.recordId}` : "";
  const migration = migrationId ? await getEditorHistoryProjectMetadata(migrationId) : null;
  if (migration?.deleted || migration?.legacyImported) return {};
  if (options.legacy) {
    const existing = await findEditorHistoryImageNode(image, true);
    if (existing) {
      if (migrationId) await markLegacyEditorHistoryImported(migrationId, existing.draftId);
      return { editorDraftId: existing.draftId, editorBranchId: existing.branchId, editorNodeId: existing.id };
    }
  }
  const original = options.sourceImage ? await decodeEditorHistoryImage(options.sourceImage) : null;
  let sourceNode = options.editorNodeId ? await loadEditorHistoryNode(options.editorNodeId) : null;
  if (sourceNode && options.editorDraftId && sourceNode.draftId !== options.editorDraftId) sourceNode = null;
  const matchedNode = sourceNode || (original ? await findEditorHistoryImageNode(original) : null);
  const linkedDraftId = matchedNode?.draftId || options.editorDraftId;
  const deleted = linkedDraftId && (await getEditorHistoryProjectMetadata(linkedDraftId))?.deleted;
  let draftId = (!deleted && linkedDraftId) || migrationId || (original
    ? `editor-image-${(await fingerprintEditorHistoryImage(original)).replace(":", "-")}`
    : createEditorHistoryId("studio-edit-"));
  if ((await getEditorHistoryProjectMetadata(draftId))?.deleted) draftId = createEditorHistoryId("studio-edit-");
  const history = await listEditorHistory(draftId);
  let branch = history.branches.find((item) => item.id === options.editorBranchId)
    || history.branches.find((item) => item.id === matchedNode?.branchId)
    || [...history.branches].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  let parentId = matchedNode?.id || branch?.headId;
  const now = options.createdAt ?? Date.now();
  const name = options.name || "重绘作品.png";
  if (!branch) {
    const root = await createEditorHistoryRoot(draftId, snapshot(original || image, options.operation, name, options.generation, options.prompt, options.negative), now - 1);
    branch = root.branch; parentId = root.node.id;
  }
  const model = options.generation?.model || "";
  const label = [EDITOR_HISTORY_OPERATION_LABELS[options.operation], model, options.prompt?.replace(/\s+/g, " ").slice(0, 45)].filter(Boolean).join(" · ");
  const node = await saveEditorHistoryCheckpoint(draftId, branch.id, parentId!, snapshot(image, options.operation, name, options.generation, options.prompt, options.negative), label, { resultOperation: options.operation, createdAt: now });
  if (migrationId) await markLegacyEditorHistoryImported(migrationId, draftId);
  editorHistoryChanged();
  return { editorDraftId: draftId, editorNodeId: node.id, editorBranchId: node.branchId };
}

export async function importLegacyEditorHistory(): Promise<number> {
  const items = await listLocalImageHistory(Number.MAX_SAFE_INTEGER);
  let failures = 0;
  for (const item of items) {
    const operation = editorHistoryOperation(item.operation);
    if (!operation) continue;
    const previous = await getEditorHistoryProjectMetadata(`legacy-edit-${item.id}`);
    if (previous?.deleted || previous?.legacyImported) continue;
    try {
      await recordStudioImageEdit({ image: item.image, operation, recordId: item.id, createdAt: item.createdAt, legacy: true,
        name: `${EDITOR_HISTORY_OPERATION_LABELS[operation]}作品.png`, prompt: item.prompt, negative: item.negative,
        generation: { model: item.model, ...(item.parameters || {}), ...(typeof item.parameters?.noise_schedule === "string" ? { noiseSchedule: item.parameters.noise_schedule } : {}) } });
    } catch { failures += 1; }
  }
  return failures;
}
