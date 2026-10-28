import type { CameraState, EditorDocument, GenerationViewport, MaskStroke, RgbaImage } from "@/lib/image-editor";

export type EditorHistoryReference = { editorDraftId?: string; editorNodeId?: string; editorBranchId?: string };
export type PersistentStudioSource = { data: string; name: string } & EditorHistoryReference;
export type EditorHistoryOperation = "inpaint" | "canvas" | "tiled-upscale" | "upscale";
export const EDITOR_HISTORY_OPERATION_LABELS: Record<EditorHistoryOperation, string> = {
  inpaint: "局部重绘", canvas: "无限画布", "tiled-upscale": "分块超分", upscale: "图像超分",
};
export type EditorHistoryWorkspace = {
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
export type EditorHistoryBranch = {
  id: string;
  draftId: string;
  name: string;
  headId: string;
  createdAt: number;
  updatedAt: number;
};
export type EditorHistoryNode = {
  version?: 2;
  id: string;
  draftId: string;
  branchId: string;
  parentId: string | null;
  imageId: string;
  mode: "inpaint" | "canvas" | "tiled-upscale";
  tileScale: 2 | 3 | 4 | 5 | 6;
  document: Omit<EditorDocument, "image">;
  workspace: EditorHistoryWorkspace;
  label: string;
  thumbnail: string;
  createdAt: number;
  resultOperation?: EditorHistoryOperation;
  imageWidth?: number;
  imageHeight?: number;
};
export type EditorHistorySnapshot = {
  document: EditorDocument;
  workspace: EditorHistoryWorkspace;
  mode: "inpaint" | "canvas" | "tiled-upscale";
  tileScale: 2 | 3 | 4 | 5 | 6;
};
export type LoadedEditorHistoryNode = EditorHistoryNode & { image: RgbaImage };

const DB_NAME = "lfn-image-editor-history-v1";
const DB_VERSION = 2;
const SOURCE_STORE = "studio-source";
const BRANCH_STORE = "branches";
const NODE_STORE = "nodes";
const IMAGE_STORE = "images";
const PROJECT_STORE = "projects";

type StoredStudioSource = { id: "active"; name: string; image: Blob; updatedAt: number } & EditorHistoryReference;
export type EditorHistoryProjectMetadata = { id: string; name?: string; updatedAt: number; deleted?: boolean; legacyImported?: boolean; importedInto?: string };
export type EditorHistoryProject = {
  id: string; name: string; sourceName: string; createdAt: number; updatedAt: number;
  latestResult: EditorHistoryNode; operations: EditorHistoryOperation[];
  nodes: EditorHistoryNode[]; results: EditorHistoryNode[]; branches: EditorHistoryBranch[];
};
type StoredHistoryImage = { id: string; width: number; height: number; data: Uint8ClampedArray };

export function editorHistoryOperation(value?: string): EditorHistoryOperation | null {
  if (value === "inpainting" || value === "edits" || value === "editor-composite" || value === "inpaint") return "inpaint";
  if (value === "canvas" || value === "outpaint") return "canvas";
  return value === "upscale" || value === "tiled-upscale" ? value : null;
}

export function editorHistoryResultOperation(node: EditorHistoryNode, parentImageId?: string): EditorHistoryOperation | null {
  if (node.resultOperation && node.resultOperation in EDITOR_HISTORY_OPERATION_LABELS) return node.resultOperation;
  // Older v2 editor builds wrote applied-result labels but omitted resultOperation.
  // Keep recognizing those nodes so existing browser histories remain visible.
  if (/^分块超分\s+\d+[×x]\s*·/.test(node.label)) return "tiled-upscale";
  if (/^(?:扩图|无限画布)\s*·/.test(node.label)) return "canvas";
  if (/^(?:局部重绘|精确重绘|重绘)\s*·/.test(node.label)) return "inpaint";
  // Older editor nodes did not always label applied outputs consistently. The
  // source image hash changes only when an output is applied, while mask and
  // parameter autosaves keep the same image hash.
  if (node.parentId && parentImageId && node.imageId !== parentImageId)
    return node.mode === "canvas" ? "canvas" : node.mode === "tiled-upscale" ? "tiled-upscale" : "inpaint";
  return null;
}

export function buildEditorHistoryProjects(
  nodes: EditorHistoryNode[], branches: EditorHistoryBranch[], metadata: EditorHistoryProjectMetadata[] = [],
): EditorHistoryProject[] {
  const names = new Map(metadata.map((item) => [item.id, item]));
  const grouped = new Map<string, EditorHistoryNode[]>();
  for (const node of nodes) {
    if (names.get(node.draftId)?.deleted) continue;
    const list = grouped.get(node.draftId) || [];
    list.push(node);
    grouped.set(node.draftId, list);
  }
  const projects: EditorHistoryProject[] = [];
  for (const [id, entries] of grouped) {
    const byId = new Map(entries.map((node) => [node.id, node]));
    const ordered = [...entries]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((node) => {
        const parentImageId = node.parentId ? byId.get(node.parentId)?.imageId : undefined;
        const resultOperation = editorHistoryResultOperation(node, parentImageId);
        return resultOperation && !node.resultOperation ? { ...node, resultOperation } : node;
      });
    const results = ordered.filter((node) => editorHistoryResultOperation(node));
    if (!results.length) continue;
    const latestResult = results[results.length - 1];
    const sourceName = ordered[0].document.source?.name || "重绘作品";
    const projectBranches = branches.filter((branch) => branch.draftId === id).sort((a, b) => b.updatedAt - a.updatedAt);
    projects.push({
      id, name: names.get(id)?.name || sourceName, sourceName,
      createdAt: ordered[0].createdAt,
      updatedAt: Math.max(ordered[ordered.length - 1].createdAt, names.get(id)?.updatedAt || 0, ...projectBranches.map((branch) => branch.updatedAt)),
      latestResult, results, nodes: ordered, branches: projectBranches,
      operations: [...new Set(results.map((node) => editorHistoryResultOperation(node)!))],
    });
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function editorHistoryBranchNodes(project: Pick<EditorHistoryProject, "nodes" | "branches">, branchId: string): EditorHistoryNode[] {
  if (!branchId) return project.nodes;
  const branch = project.branches.find((item) => item.id === branchId);
  if (!branch) return [];
  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const ids = new Set(project.nodes.filter((node) => node.branchId === branchId).map((node) => node.id));
  let current = byId.get(branch.headId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ids.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return project.nodes.filter((node) => ids.has(node.id));
}

export function filterEditorHistoryProjects(projects: EditorHistoryProject[], query: string, operation = "all"): EditorHistoryProject[] {
  const term = query.trim().toLocaleLowerCase();
  return projects.filter((project) => {
    if (operation !== "all" && !project.operations.includes(operation as EditorHistoryOperation)) return false;
    return !term || [project.name, project.sourceName, ...project.branches.map((branch) => branch.name),
      ...project.nodes.flatMap((node) => [node.label, node.document.prompt || "", node.document.generation?.model || ""]),
    ].some((value) => value.toLocaleLowerCase().includes(term));
  });
}

export function editorHistoryEditHref(node: EditorHistoryNode, branchId = node.branchId): string {
  const returnTo = `/image/editor/history?${new URLSearchParams({ draftId: node.draftId, branchId, nodeId: node.id })}`;
  return `/image/editor?${new URLSearchParams({ draftId: node.draftId, mode: node.mode, nodeId: node.id, branchId, returnTo }).toString()}`;
}

export function editorHistoryChanged(): void {
  window.dispatchEvent(new Event("lfn-editor-history-changed"));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SOURCE_STORE)) db.createObjectStore(SOURCE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BRANCH_STORE)) db.createObjectStore(BRANCH_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(NODE_STORE)) db.createObjectStore(NODE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      const transaction = request.transaction!;
      const nodes = transaction.objectStore(NODE_STORE);
      for (const key of ["draftId", "imageId"]) if (!nodes.indexNames.contains(key)) nodes.createIndex(key, key);
      const branches = transaction.objectStore(BRANCH_STORE);
      if (!branches.indexNames.contains("draftId")) branches.createIndex("draftId", "draftId");
      const cursorRequest = nodes.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const node = cursor.value as EditorHistoryNode;
        const operation = editorHistoryResultOperation(node);
        if (operation && !node.resultOperation) cursor.update({ ...node, resultOperation: operation });
        cursor.continue();
      };
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error || new Error("打开图像编辑历史存储失败"));
    request.onblocked = () => reject(new Error("图像编辑历史存储被其他页面占用"));
  });
}

function transactionFailure(transaction: IDBTransaction, message: string): Error {
  return transaction.error || new Error(message);
}

function cloneWorkspace(workspace: EditorHistoryWorkspace): EditorHistoryWorkspace {
  const cloneStroke = (stroke: MaskStroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) });
  return {
    ...workspace,
    viewport: { ...workspace.viewport },
    camera: { ...workspace.camera },
    strokes: workspace.strokes.map(cloneStroke),
    undone: workspace.undone.map(cloneStroke),
  };
}

export function createEditorHistoryId(prefix = "editor-"): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function fingerprintEditorHistoryImage(image: RgbaImage): Promise<string> {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const chunkSize = 1_048_576;
  for (let start = 0; start < image.data.length; start += chunkSize) {
    const end = Math.min(image.data.length, start + chunkSize);
    for (let index = start; index < end; index += 1) {
      const value = image.data[index];
      first = Math.imul(first ^ value, 0x01000193);
      second = Math.imul(second ^ value, 0x85ebca6b);
    }
    if (end < image.data.length) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  return `${image.width}x${image.height}:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function createThumbnail(image: RgbaImage): string {
  const longest = Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * Math.min(1, 320 / longest)));
  const height = Math.max(1, Math.round(image.height * Math.min(1, 320 / longest)));
  const source = window.document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("无法生成历史节点缩略图");
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const thumbnail = window.document.createElement("canvas");
  thumbnail.width = width;
  thumbnail.height = height;
  const thumbnailContext = thumbnail.getContext("2d");
  if (!thumbnailContext) throw new Error("无法生成历史节点缩略图");
  thumbnailContext.imageSmoothingQuality = "high";
  thumbnailContext.drawImage(source, 0, 0, width, height);
  return thumbnail.toDataURL("image/jpeg", 0.72);
}

function buildHistoryNode(
  draftId: string,
  branchId: string,
  parentId: string | null,
  snapshot: EditorHistorySnapshot,
  imageId: string,
  label: string,
  now: number,
): EditorHistoryNode {
  const { image: ignoredImage, ...document } = snapshot.document;
  void ignoredImage;
  return {
    version: 2,
    id: createEditorHistoryId("edit-node-"),
    draftId,
    branchId,
    parentId,
    imageId,
    mode: snapshot.mode,
    tileScale: snapshot.tileScale,
    document: {
      ...document,
      worldRect: { ...document.worldRect },
      source: document.source && { ...document.source },
      generation: document.generation && { ...document.generation },
    },
    workspace: cloneWorkspace(snapshot.workspace),
    label: label.trim().slice(0, 80) || "自动保存",
    thumbnail: createThumbnail(snapshot.document.image),
    createdAt: now,
    imageWidth: snapshot.document.image.width,
    imageHeight: snapshot.document.image.height,
  };
}

export async function savePersistentStudioSource(source: PersistentStudioSource): Promise<void> {
  const response = await fetch(source.data);
  const image = await response.blob();
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SOURCE_STORE, "readwrite");
      transaction.objectStore(SOURCE_STORE).put({ id: "active", name: source.name.slice(0, 200), image, editorDraftId: source.editorDraftId, editorNodeId: source.editorNodeId, editorBranchId: source.editorBranchId, updatedAt: Date.now() } satisfies StoredStudioSource);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionFailure(transaction, "保存工作台源图失败"));
      transaction.onabort = () => reject(transactionFailure(transaction, "保存工作台源图失败"));
    });
  } finally {
    db.close();
  }
}

export async function loadPersistentStudioSource(): Promise<PersistentStudioSource | null> {
  const db = await openDatabase();
  try {
    const source = await new Promise<StoredStudioSource | null>((resolve, reject) => {
      const transaction = db.transaction(SOURCE_STORE, "readonly");
      const request = transaction.objectStore(SOURCE_STORE).get("active");
      request.onsuccess = () => resolve((request.result as StoredStudioSource | undefined) || null);
      request.onerror = () => reject(request.error || new Error("读取工作台源图失败"));
    });
    if (!source) return null;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("读取工作台源图失败"));
      reader.readAsDataURL(source.image);
    });
    return { data, name: source.name, editorDraftId: source.editorDraftId, editorNodeId: source.editorNodeId, editorBranchId: source.editorBranchId };
  } finally {
    db.close();
  }
}

export async function clearPersistentStudioSource(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SOURCE_STORE, "readwrite");
      transaction.objectStore(SOURCE_STORE).delete("active");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionFailure(transaction, "清除工作台源图失败"));
      transaction.onabort = () => reject(transactionFailure(transaction, "清除工作台源图失败"));
    });
  } finally {
    db.close();
  }
}

export async function listEditorHistory(draftId: string): Promise<{ branches: EditorHistoryBranch[]; nodes: EditorHistoryNode[] }> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([BRANCH_STORE, NODE_STORE], "readonly");
      const branchRequest = transaction.objectStore(BRANCH_STORE).index("draftId").getAll(draftId);
      const nodeRequest = transaction.objectStore(NODE_STORE).index("draftId").getAll(draftId);
      let branches: EditorHistoryBranch[] = [];
      let nodes: EditorHistoryNode[] = [];
      branchRequest.onsuccess = () => { branches = (branchRequest.result as EditorHistoryBranch[]).filter((item) => item.draftId === draftId); };
      nodeRequest.onsuccess = () => { nodes = (nodeRequest.result as EditorHistoryNode[]).filter((item) => item.draftId === draftId).sort((a, b) => a.createdAt - b.createdAt); };
      transaction.oncomplete = () => resolve({ branches, nodes });
      transaction.onerror = () => reject(transactionFailure(transaction, "读取编辑历史失败"));
    });
  } finally {
    db.close();
  }
}

export async function createEditorHistoryRoot(draftId: string, snapshot: EditorHistorySnapshot, now = Date.now()): Promise<{ branch: EditorHistoryBranch; node: EditorHistoryNode }> {
  const imageId = await fingerprintEditorHistoryImage(snapshot.document.image);
  const branchId = createEditorHistoryId("edit-branch-");
  const branch: EditorHistoryBranch = { id: branchId, draftId, name: "main", headId: "", createdAt: now, updatedAt: now };
  const node = buildHistoryNode(draftId, branchId, null, snapshot, imageId, "初始版本", now);
  branch.headId = node.id;
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([BRANCH_STORE, NODE_STORE, IMAGE_STORE, PROJECT_STORE], "readwrite");
      const branches = transaction.objectStore(BRANCH_STORE);
      const request = branches.index("draftId").getAll(draftId);
      let result: { branch: EditorHistoryBranch; node: EditorHistoryNode } | null = null;
      request.onsuccess = () => {
        const existing = (request.result as EditorHistoryBranch[]).find((item) => item.draftId === draftId);
        if (existing) {
          const existingNodeRequest = transaction.objectStore(NODE_STORE).index("draftId").getAll(draftId);
          existingNodeRequest.onsuccess = () => {
            const entries = existingNodeRequest.result as EditorHistoryNode[];
            const existingNode = entries.find((item) => !item.parentId) || entries.find((item) => item.id === existing.headId);
            if (existingNode) result = { branch: existing, node: existingNode };
          };
          return;
        }
        transaction.objectStore(IMAGE_STORE).put({ id: imageId, width: snapshot.document.image.width, height: snapshot.document.image.height, data: new Uint8ClampedArray(snapshot.document.image.data) } satisfies StoredHistoryImage);
        branches.put(branch);
        transaction.objectStore(NODE_STORE).put(node);
        result = { branch, node };
      };
      transaction.oncomplete = () => {
        if (result) resolve(result);
        else reject(new Error("初始化编辑历史失败"));
      };
      transaction.onerror = () => reject(transactionFailure(transaction, "初始化编辑历史失败"));
    });
  } finally {
    db.close();
  }
}

export async function saveEditorHistoryCheckpoint(
  draftId: string,
  branchId: string,
  parentId: string | null,
  snapshot: EditorHistorySnapshot,
  label: string,
  options: { resultOperation?: EditorHistoryOperation; createdAt?: number } = {},
): Promise<EditorHistoryNode> {
  const imageId = await fingerprintEditorHistoryImage(snapshot.document.image);
  const now = options.createdAt ?? Date.now();
  const node = buildHistoryNode(draftId, branchId, parentId, snapshot, imageId, label, now);
  node.resultOperation = options.resultOperation;
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([BRANCH_STORE, NODE_STORE, IMAGE_STORE, PROJECT_STORE], "readwrite");
      const branches = transaction.objectStore(BRANCH_STORE);
      const request = branches.get(branchId);
      if (options.resultOperation) {
        const projects = transaction.objectStore(PROJECT_STORE);
        const metadataRequest = projects.get(draftId);
        metadataRequest.onsuccess = () => projects.put({ ...metadataRequest.result, id: draftId, deleted: false, updatedAt: now });
      }
      request.onsuccess = () => {
        const branch = request.result as EditorHistoryBranch | undefined;
        if (!branch || branch.draftId !== draftId) {
          transaction.abort();
          return;
        }
        const parentRequest = transaction.objectStore(NODE_STORE).get(parentId || "");
        parentRequest.onsuccess = () => {
          const parent = parentRequest.result as EditorHistoryNode | undefined;
          if (!parent || parent.draftId !== draftId) { transaction.abort(); return; }
          // Continuing an older revision must keep the existing branch head reachable.
          const targetBranch = branch.headId === parentId ? branch : {
            ...branch, id: createEditorHistoryId("edit-branch-"),
            name: `${branch.name.slice(0, 45)} · 分支 ${node.id.slice(-5)}`, createdAt: now,
          };
          node.branchId = targetBranch.id;
          targetBranch.headId = node.id;
          targetBranch.updatedAt = now;
          branches.put(targetBranch);
          const images = transaction.objectStore(IMAGE_STORE);
          const imageRequest = images.get(imageId);
          imageRequest.onsuccess = () => {
            if (!imageRequest.result) images.put({ id: imageId, width: snapshot.document.image.width, height: snapshot.document.image.height, data: new Uint8ClampedArray(snapshot.document.image.data) } satisfies StoredHistoryImage);
          };
          transaction.objectStore(NODE_STORE).put(node);
        };
      };
      transaction.oncomplete = () => resolve(node);
      transaction.onerror = () => reject(transactionFailure(transaction, "保存编辑历史节点失败"));
      transaction.onabort = () => reject(transactionFailure(transaction, "保存编辑历史节点失败"));
    });
  } finally {
    db.close();
  }
}

export async function createEditorHistoryBranch(draftId: string, name: string, fromNodeId: string): Promise<EditorHistoryBranch> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([BRANCH_STORE, NODE_STORE], "readwrite");
      const nodeRequest = transaction.objectStore(NODE_STORE).get(fromNodeId);
      let result: EditorHistoryBranch | null = null;
      nodeRequest.onsuccess = () => {
        const node = nodeRequest.result as EditorHistoryNode | undefined;
        if (!node || node.draftId !== draftId) { transaction.abort(); return; }
        const now = Date.now();
        result = { id: createEditorHistoryId("edit-branch-"), draftId, name: name.trim().slice(0, 64) || "分支", headId: fromNodeId, createdAt: now, updatedAt: now };
        transaction.objectStore(BRANCH_STORE).put(result);
      };
      transaction.oncomplete = () => result ? resolve(result) : reject(new Error("创建历史分支失败"));
      transaction.onerror = () => reject(transactionFailure(transaction, "创建历史分支失败"));
      transaction.onabort = () => reject(transactionFailure(transaction, "历史节点不存在，无法创建分支"));
    });
  } finally {
    db.close();
  }
}

export async function renameEditorHistoryBranch(branchId: string, name: string): Promise<EditorHistoryBranch> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(BRANCH_STORE, "readwrite");
      const store = transaction.objectStore(BRANCH_STORE);
      const request = store.get(branchId);
      let result: EditorHistoryBranch | null = null;
      request.onsuccess = () => {
        const branch = request.result as EditorHistoryBranch | undefined;
        if (!branch) { transaction.abort(); return; }
        branch.name = name.trim().slice(0, 64) || branch.name;
        branch.updatedAt = Date.now();
        result = branch;
        store.put(branch);
      };
      transaction.oncomplete = () => result ? resolve(result) : reject(new Error("历史分支不存在"));
      transaction.onerror = () => reject(transactionFailure(transaction, "重命名历史分支失败"));
      transaction.onabort = () => reject(new Error("历史分支不存在"));
    });
  } finally {
    db.close();
  }
}

export async function renameEditorHistoryNode(nodeId: string, label: string): Promise<EditorHistoryNode> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(NODE_STORE, "readwrite");
      const store = transaction.objectStore(NODE_STORE);
      const request = store.get(nodeId);
      let result: EditorHistoryNode | null = null;
      request.onsuccess = () => {
        const node = request.result as EditorHistoryNode | undefined;
        if (!node) { transaction.abort(); return; }
        node.label = label.trim().slice(0, 80) || node.label;
        result = node;
        store.put(node);
      };
      transaction.oncomplete = () => result ? resolve(result) : reject(new Error("历史节点不存在"));
      transaction.onerror = () => reject(transactionFailure(transaction, "重命名历史节点失败"));
      transaction.onabort = () => reject(new Error("历史节点不存在"));
    });
  } finally {
    db.close();
  }
}

/** Delete one history node, reconnecting its children to its parent and pruning unreachable nodes. */
export async function deleteEditorHistoryNode(nodeId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([BRANCH_STORE, NODE_STORE, IMAGE_STORE, PROJECT_STORE], "readwrite");
      const branchesStore = transaction.objectStore(BRANCH_STORE);
      const nodesStore = transaction.objectStore(NODE_STORE);
      const branchesRequest = branchesStore.getAll();
      const nodesRequest = nodesStore.getAll();
      let branches: EditorHistoryBranch[] | null = null;
      let nodes: EditorHistoryNode[] | null = null;
      const apply = () => {
        if (!branches || !nodes) return;
        const target = nodes.find((node) => node.id === nodeId);
        if (!target) { transaction.abort(); return; }
        const directChildren = nodes.filter((node) => node.draftId === target.draftId && node.parentId === target.id);
        const draftNodes = nodes.filter((node) => node.draftId === target.draftId && node.id !== target.id)
          .map((node) => node.parentId === target.id ? { ...node, parentId: target.parentId } : node);
        const draftBranches = branches.filter((branch) => branch.draftId === target.draftId).map((branch) => {
          if (branch.headId !== target.id) return branch;
          const child = directChildren.filter((node) => node.branchId === branch.id)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          const fallback = child || draftNodes.find((node) => node.id === target.parentId);
          return fallback ? { ...branch, headId: fallback.id, updatedAt: Date.now() } : null;
        }).filter((branch): branch is EditorHistoryBranch => Boolean(branch));
        const reachable = new Set<string>();
        const byId = new Map(draftNodes.map((node) => [node.id, node]));
        for (const branch of draftBranches) {
          let current = byId.get(branch.headId);
          while (current && !reachable.has(current.id)) {
            reachable.add(current.id);
            current = current.parentId ? byId.get(current.parentId) : undefined;
          }
        }
        const keptDraftNodes = draftNodes.filter((node) => reachable.has(node.id));
        const removed = nodes.filter((node) => node.draftId === target.draftId && !reachable.has(node.id));
        for (const node of keptDraftNodes) nodesStore.put(node);
        for (const node of removed) nodesStore.delete(node.id);
        for (const branch of branches.filter((item) => item.draftId === target.draftId)) branchesStore.delete(branch.id);
        for (const branch of draftBranches) branchesStore.put(branch);
        const removedIds = new Set(removed.map((node) => node.id));
        const keepImageIds = new Set(nodes.filter((node) => !removedIds.has(node.id)).map((node) => node.imageId));
        for (const node of keptDraftNodes) keepImageIds.add(node.imageId);
        const imageStore = transaction.objectStore(IMAGE_STORE);
        for (const node of removed) if (!keepImageIds.has(node.imageId)) imageStore.delete(node.imageId);
        if (!draftBranches.length || !keptDraftNodes.length) {
          transaction.objectStore(PROJECT_STORE).put({ id: target.draftId, deleted: true, updatedAt: Date.now() } satisfies EditorHistoryProjectMetadata);
        }
      };
      branchesRequest.onsuccess = () => { branches = branchesRequest.result as EditorHistoryBranch[]; apply(); };
      nodesRequest.onsuccess = () => { nodes = nodesRequest.result as EditorHistoryNode[]; apply(); };
      transaction.oncomplete = () => { editorHistoryChanged(); resolve(); };
      transaction.onerror = () => reject(transactionFailure(transaction, "删除历史节点失败"));
      transaction.onabort = () => reject(transaction.error || new Error("历史节点不存在，无法删除"));
    });
  } finally { db.close(); }
}

/** Remove a branch and all nodes that are no longer reachable from another branch head. */
export async function deleteEditorHistoryBranch(branchId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([BRANCH_STORE, NODE_STORE, IMAGE_STORE, PROJECT_STORE], "readwrite");
      const branchesStore = transaction.objectStore(BRANCH_STORE);
      const nodesStore = transaction.objectStore(NODE_STORE);
      const branchesRequest = branchesStore.getAll();
      const nodesRequest = nodesStore.getAll();
      let branches: EditorHistoryBranch[] | null = null;
      let nodes: EditorHistoryNode[] | null = null;
      const apply = () => {
        if (!branches || !nodes) return;
        const target = branches.find((branch) => branch.id === branchId);
        if (!target) { transaction.abort(); return; }
        const keptBranches = branches.filter((branch) => branch.draftId === target.draftId && branch.id !== branchId);
        const byId = new Map(nodes.filter((node) => node.draftId === target.draftId).map((node) => [node.id, node]));
        const reachable = new Set<string>();
        for (const branch of keptBranches) {
          let current = byId.get(branch.headId);
          while (current && !reachable.has(current.id)) {
            reachable.add(current.id);
            current = current.parentId ? byId.get(current.parentId) : undefined;
          }
        }
        const removed = nodes.filter((node) => node.draftId === target.draftId && !reachable.has(node.id));
        branchesStore.delete(branchId);
        const imageStore = transaction.objectStore(IMAGE_STORE);
        const keepImageIds = new Set(nodes.filter((node) => node.draftId !== target.draftId || reachable.has(node.id)).map((node) => node.imageId));
        for (const node of removed) {
          nodesStore.delete(node.id);
          if (!keepImageIds.has(node.imageId)) imageStore.delete(node.imageId);
        }
        if (!keptBranches.length) {
          transaction.objectStore(PROJECT_STORE).put({ id: target.draftId, deleted: true, updatedAt: Date.now() } satisfies EditorHistoryProjectMetadata);
        }
      };
      branchesRequest.onsuccess = () => { branches = branchesRequest.result as EditorHistoryBranch[]; apply(); };
      nodesRequest.onsuccess = () => { nodes = nodesRequest.result as EditorHistoryNode[]; apply(); };
      transaction.oncomplete = () => { editorHistoryChanged(); resolve(); };
      transaction.onerror = () => reject(transactionFailure(transaction, "删除历史分支失败"));
      transaction.onabort = () => reject(transaction.error || new Error("历史分支不存在，无法删除"));
    });
  } finally { db.close(); }
}

export async function loadEditorHistoryNode(nodeId: string): Promise<LoadedEditorHistoryNode | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([NODE_STORE, IMAGE_STORE], "readonly");
      const nodeRequest = transaction.objectStore(NODE_STORE).get(nodeId);
      let node: EditorHistoryNode | null = null;
      let image: StoredHistoryImage | null = null;
      const finish = () => {
        if (!node || !image) return;
        resolve({ ...node, document: { ...node.document, worldRect: { ...node.document.worldRect }, source: node.document.source && { ...node.document.source }, generation: node.document.generation && { ...node.document.generation } }, workspace: cloneWorkspace(node.workspace), image: { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) } });
      };
      nodeRequest.onsuccess = () => {
        node = (nodeRequest.result as EditorHistoryNode | undefined) || null;
        if (node) {
          const imageRequest = transaction.objectStore(IMAGE_STORE).get(node.imageId);
          imageRequest.onsuccess = () => { image = (imageRequest.result as StoredHistoryImage | undefined) || null; finish(); };
          imageRequest.onerror = () => reject(imageRequest.error || new Error("读取历史图片失败"));
        }
      };
      nodeRequest.onerror = () => reject(nodeRequest.error || new Error("读取历史节点失败"));
      transaction.oncomplete = () => { if (!node) resolve(null); else if (!image) reject(new Error("历史节点图片丢失")); };
      transaction.onerror = () => reject(transactionFailure(transaction, "读取历史节点失败"));
    });
  } finally {
    db.close();
  }
}

export async function listEditorHistoryProjects(): Promise<EditorHistoryProject[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([NODE_STORE, BRANCH_STORE, PROJECT_STORE], "readonly");
      const nodes = transaction.objectStore(NODE_STORE).getAll();
      const branches = transaction.objectStore(BRANCH_STORE).getAll();
      const metadata = transaction.objectStore(PROJECT_STORE).getAll();
      transaction.oncomplete = () => resolve(buildEditorHistoryProjects(nodes.result, branches.result, metadata.result));
      transaction.onerror = () => reject(transactionFailure(transaction, "读取重绘作品列表失败"));
    });
  } finally { db.close(); }
}

export async function getEditorHistoryProjectMetadata(draftId: string): Promise<EditorHistoryProjectMetadata | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).get(draftId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("读取重绘作品信息失败"));
    });
  } finally { db.close(); }
}

export async function findEditorHistoryImageNode(image: RgbaImage, resultsOnly = false): Promise<EditorHistoryNode | null> {
  const imageId = await fingerprintEditorHistoryImage(image);
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(NODE_STORE, "readonly").objectStore(NODE_STORE).index("imageId").getAll(imageId);
      request.onsuccess = () => resolve((request.result as EditorHistoryNode[])
        .filter((node) => !resultsOnly || editorHistoryResultOperation(node))
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null);
      request.onerror = () => reject(request.error || new Error("查找重绘源图失败"));
    });
  } finally { db.close(); }
}

export async function renameEditorHistoryProject(draftId: string, name: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PROJECT_STORE, "readwrite");
      const store = transaction.objectStore(PROJECT_STORE);
      const request = store.get(draftId);
      request.onsuccess = () => {
        const previous = request.result as EditorHistoryProjectMetadata | undefined;
        if (previous?.deleted) { transaction.abort(); return; }
        store.put({ ...previous, id: draftId, name: name.trim().slice(0, 100) || previous?.name, updatedAt: Date.now() });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionFailure(transaction, "重命名重绘作品失败"));
      transaction.onabort = () => reject(new Error("重绘作品已删除"));
    });
    editorHistoryChanged();
  } finally { db.close(); }
}

export async function markLegacyEditorHistoryImported(id: string, projectId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PROJECT_STORE, "readwrite");
      const store = transaction.objectStore(PROJECT_STORE);
      const request = store.get(id);
      request.onsuccess = () => store.put({ ...request.result, id, legacyImported: true, importedInto: projectId, updatedAt: Date.now() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionFailure(transaction, "保存旧重绘记录迁移状态失败"));
    });
  } finally { db.close(); }
}

export async function deleteEditorHistoryProject(draftId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([NODE_STORE, BRANCH_STORE, IMAGE_STORE, PROJECT_STORE], "readwrite");
      const nodes = transaction.objectStore(NODE_STORE);
      const request = nodes.getAll();
      request.onsuccess = () => {
        const all = request.result as EditorHistoryNode[];
        const keepImages = new Set(all.filter((node) => node.draftId !== draftId).map((node) => node.imageId));
        for (const node of all.filter((item) => item.draftId === draftId)) {
          nodes.delete(node.id);
          if (!keepImages.has(node.imageId)) transaction.objectStore(IMAGE_STORE).delete(node.imageId);
        }
      };
      const branchStore = transaction.objectStore(BRANCH_STORE);
      const branches = branchStore.index("draftId").getAll(draftId);
      branches.onsuccess = () => { for (const branch of branches.result as EditorHistoryBranch[]) branchStore.delete(branch.id); };
      // Keep a tombstone so importing old general history cannot resurrect a deleted project.
      transaction.objectStore(PROJECT_STORE).put({ id: draftId, deleted: true, updatedAt: Date.now() } satisfies EditorHistoryProjectMetadata);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionFailure(transaction, "删除重绘作品失败"));
      transaction.onabort = () => reject(transactionFailure(transaction, "删除重绘作品失败"));
    });
    editorHistoryChanged();
  } finally { db.close(); }
}
