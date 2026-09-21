import {
  cloneRgbaImage,
  type CameraState,
  type EditorDocument,
  type GenerationViewport,
  type MaskStroke,
  type ReviewSession,
  type RgbaImage,
} from "@/lib/image-editor";

export const IMAGE_EDITOR_DB_NAME = "lfn-image-editor-v1";
export const IMAGE_EDITOR_DB_VERSION = 1;
export const IMAGE_EDITOR_STORE_NAME = "drafts";
export const IMAGE_EDITOR_MAX_PIXELS = 16_000_000;
export const IMAGE_EDITOR_MAX_BYTES = 64 * 1024 * 1024;

export type EditorDraftMode = "inpaint" | "canvas";

export type EditorWorkspaceState = {
  viewport: GenerationViewport;
  camera: CameraState;
  strokes: MaskStroke[];
  undone: MaskStroke[];
  tool: "pan" | "brush" | "eraser" | "rectangle";
  brushSize: number;
  maskColor: string;
  maskOpacity: number;
  showMaskPreview: boolean;
  canvasBackground: "checker" | "white" | "dark";
};

export type EditorDraft = {
  id: string;
  version: 1;
  mode: EditorDraftMode;
  document: EditorDocument;
  workspace?: EditorWorkspaceState;
  review?: ReviewSession;
  createdAt: number;
  updatedAt: number;
};

export type SaveEditorDraftOptions = {
  now?: number;
  maxPixels?: number;
  maxBytes?: number;
};

function browserIndexedDb(): IDBFactory | null {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") return null;
  return window.indexedDB;
}

function cloneDraft(draft: EditorDraft): EditorDraft {
  return {
    ...draft,
    document: {
      ...draft.document,
      image: cloneRgbaImage(draft.document.image),
      worldRect: { ...draft.document.worldRect },
      source: draft.document.source && { ...draft.document.source },
      generation: draft.document.generation && { ...draft.document.generation },
    },
    workspace: draft.workspace && {
      ...draft.workspace,
      viewport: { ...draft.workspace.viewport },
      camera: { ...draft.workspace.camera },
      strokes: draft.workspace.strokes.map(cloneStroke),
      undone: draft.workspace.undone.map(cloneStroke),
    },
    review: draft.review && {
      ...draft.review,
      base: {
        ...draft.review.base,
        image: cloneRgbaImage(draft.review.base.image),
        worldRect: { ...draft.review.base.worldRect },
        source: draft.review.base.source && { ...draft.review.base.source },
      },
      candidate: {
        ...draft.review.candidate,
        patch: cloneRgbaImage(draft.review.candidate.patch),
        viewport: { ...draft.review.candidate.viewport },
        mask: draft.review.candidate.mask && (typeof draft.review.candidate.mask === "object" && "data" in draft.review.candidate.mask)
          ? { ...draft.review.candidate.mask, data: new Uint8ClampedArray(draft.review.candidate.mask.data) }
          : draft.review.candidate.mask && new Uint8ClampedArray(draft.review.candidate.mask),
      },
    },
  };
}

function imageBytes(image: RgbaImage): number {
  return image.data.byteLength;
}

function draftPixelCount(draft: EditorDraft): number {
  let pixels = draft.document.image.width * draft.document.image.height;
  if (draft.review) {
    pixels += draft.review.base.image.width * draft.review.base.image.height;
    pixels += draft.review.candidate.patch.width * draft.review.candidate.patch.height;
  }
  return pixels;
}

function draftByteCount(draft: EditorDraft): number {
  let bytes = imageBytes(draft.document.image);
  if (draft.review) {
    bytes += imageBytes(draft.review.base.image);
    bytes += imageBytes(draft.review.candidate.patch);
    if (draft.review.candidate.mask) {
      bytes += typeof draft.review.candidate.mask === "object" && "data" in draft.review.candidate.mask
        ? draft.review.candidate.mask.data.byteLength
        : draft.review.candidate.mask.byteLength;
    }
  }
  return bytes;
}

function validateDraft(draft: EditorDraft, options: SaveEditorDraftOptions = {}): void {
  if (!draft || draft.version !== 1 || typeof draft.id !== "string" || !draft.id) {
    throw new RangeError("编辑草稿格式无效");
  }
  if (draft.mode !== "inpaint" && draft.mode !== "canvas") throw new RangeError("编辑模式无效");
  const maxPixels = options.maxPixels ?? IMAGE_EDITOR_MAX_PIXELS;
  const maxBytes = options.maxBytes ?? IMAGE_EDITOR_MAX_BYTES;
  const pixels = draftPixelCount(draft);
  const bytes = draftByteCount(draft);
  if (pixels > maxPixels) throw new RangeError(`编辑草稿像素不能超过 ${maxPixels}`);
  if (bytes > maxBytes) throw new RangeError(`编辑草稿大小不能超过 ${maxBytes} 字节`);
}

function openEditorDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const indexedDB = browserIndexedDb();
    if (!indexedDB) {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(IMAGE_EDITOR_DB_NAME, IMAGE_EDITOR_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_EDITOR_STORE_NAME)) {
        request.result.createObjectStore(IMAGE_EDITOR_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开编辑草稿存储失败"));
    request.onblocked = () => reject(new Error("编辑草稿存储被其他页面占用"));
  });
}

function transactionError(transaction: IDBTransaction, fallback: string): Error {
  return transaction.error || new Error(fallback);
}

export function createEditorDraft(
  id: string,
  mode: EditorDraftMode,
  document: EditorDocument,
  review?: ReviewSession,
  now = Date.now(),
): EditorDraft {
  return { id, version: 1, mode, document: cloneDocument(document), review: review && cloneReview(review), createdAt: now, updatedAt: now };
}

function cloneStroke(stroke: MaskStroke): MaskStroke {
  return { ...stroke, points: stroke.points.map((point) => ({ ...point })) };
}

function cloneDocument(document: EditorDocument): EditorDocument {
  return { ...document, image: cloneRgbaImage(document.image), worldRect: { ...document.worldRect }, source: document.source && { ...document.source }, generation: document.generation && { ...document.generation } };
}

function cloneReview(review: ReviewSession): ReviewSession {
  return {
    ...review,
    base: cloneDocument(review.base),
    candidate: {
      ...review.candidate,
      patch: cloneRgbaImage(review.candidate.patch),
      viewport: { ...review.candidate.viewport },
      mask: review.candidate.mask && (typeof review.candidate.mask === "object" && "data" in review.candidate.mask)
        ? { ...review.candidate.mask, data: new Uint8ClampedArray(review.candidate.mask.data) }
        : review.candidate.mask && new Uint8ClampedArray(review.candidate.mask),
    },
  };
}

export async function saveEditorDraft(draft: EditorDraft, options: SaveEditorDraftOptions = {}): Promise<EditorDraft> {
  validateDraft(draft, options);
  const database = await openEditorDatabase();
  const value = cloneDraft({ ...draft, updatedAt: options.now ?? Date.now() });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_EDITOR_STORE_NAME, "readwrite");
      transaction.objectStore(IMAGE_EDITOR_STORE_NAME).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionError(transaction, "保存编辑草稿失败"));
      transaction.onabort = () => reject(transactionError(transaction, "保存编辑草稿失败"));
    });
    return cloneDraft(value);
  } finally {
    database.close();
  }
}

export async function loadEditorDraft(id: string): Promise<EditorDraft | null> {
  if (!browserIndexedDb()) return null;
  const database = await openEditorDatabase();
  try {
    return await new Promise<EditorDraft | null>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_EDITOR_STORE_NAME, "readonly");
      const request = transaction.objectStore(IMAGE_EDITOR_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result ? cloneDraft(request.result as EditorDraft) : null);
      request.onerror = () => reject(request.error || new Error("读取编辑草稿失败"));
    });
  } finally {
    database.close();
  }
}

export async function listEditorDrafts(): Promise<EditorDraft[]> {
  if (!browserIndexedDb()) return [];
  const database = await openEditorDatabase();
  try {
    return await new Promise<EditorDraft[]>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_EDITOR_STORE_NAME, "readonly");
      const request = transaction.objectStore(IMAGE_EDITOR_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as EditorDraft[]).map(cloneDraft));
      request.onerror = () => reject(request.error || new Error("读取编辑草稿列表失败"));
    });
  } finally {
    database.close();
  }
}

export async function deleteEditorDraft(id: string): Promise<void> {
  if (!browserIndexedDb()) return;
  const database = await openEditorDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_EDITOR_STORE_NAME, "readwrite");
      transaction.objectStore(IMAGE_EDITOR_STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionError(transaction, "清除编辑草稿失败"));
      transaction.onabort = () => reject(transactionError(transaction, "清除编辑草稿失败"));
    });
  } finally {
    database.close();
  }
}

export async function clearEditorDrafts(): Promise<void> {
  if (!browserIndexedDb()) return;
  const database = await openEditorDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(IMAGE_EDITOR_STORE_NAME, "readwrite");
      transaction.objectStore(IMAGE_EDITOR_STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionError(transaction, "清除编辑草稿失败"));
      transaction.onabort = () => reject(transactionError(transaction, "清除编辑草稿失败"));
    });
  } finally {
    database.close();
  }
}

export const readEditorDraft = loadEditorDraft;
export const writeEditorDraft = saveEditorDraft;
export const removeEditorDraft = deleteEditorDraft;
export const clearImageEditorDrafts = clearEditorDrafts;
