import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorDocument, createRgbaImage } from "@/lib/image-editor";
import {
  createEditorHistoryBranch, createEditorHistoryRoot, deleteEditorHistoryBranch, deleteEditorHistoryNode, deleteEditorHistoryProject, editorHistoryBranchNodes,
  editorHistoryEditHref, filterEditorHistoryProjects, getEditorHistoryProjectMetadata, listEditorHistory,
  listEditorHistoryProjects, loadEditorHistoryNode, renameEditorHistoryBranch, renameEditorHistoryNode,
  renameEditorHistoryProject, saveEditorHistoryCheckpoint, type EditorHistoryNode, type EditorHistorySnapshot,
} from "@/lib/image-editor-history";
import { editorHistoryNodeDraft, importLegacyEditorHistory, recordStudioImageEdit } from "@/lib/image-editor-record";
import { saveLocalImageHistory } from "@/lib/local-image-history";

function canvas() {
  const element = {
    width: 2, height: 2, pixels: new Uint8ClampedArray(16),
    getContext: () => ({
      imageSmoothingQuality: "high",
      putImageData: (image: { data: Uint8ClampedArray }) => { element.pixels = new Uint8ClampedArray(image.data); },
      drawImage: (image: { data?: Uint8ClampedArray; pixels?: Uint8ClampedArray }) => { element.pixels = new Uint8ClampedArray(image.data || image.pixels || element.pixels); },
      getImageData: () => ({ data: element.pixels }),
    }),
    toDataURL: () => "data:image/jpeg;base64,AA==",
    toBlob: (callback: (value: Blob) => void) => callback(new Blob([JSON.stringify({ width: element.width, height: element.height, data: [...element.pixels] })])),
  };
  return element;
}
function snapshot(red = 0, mode: EditorHistorySnapshot["mode"] = "inpaint"): EditorHistorySnapshot {
  const image = createRgbaImage(2, 2);
  image.data.set([red, 1, 2, 255]);
  const viewport = { x: -2, y: 3, width: 2, height: 2 };
  return {
    mode, tileScale: 3, document: createEditorDocument(image, viewport, { source: { name: "源图片.png" }, prompt: "soft moonlight", generation: { model: "nai-v5-full", strength: .4 } }),
    workspace: { viewport, camera: { x: -4, y: 2, zoom: .6 }, strokes: [{ points: [{ x: 1, y: 2 }], radius: 8 }], undone: [], tool: "brush", brushSize: 40, maskColor: "#fff", maskOpacity: 50, showMaskPreview: true, canvasBackground: "checker" },
  };
}
function bitmapBlob(red: number) {
  return new Blob([JSON.stringify({ width: 2, height: 2, data: [red, 1, 2, 255, ...new Array(12).fill(0)] })]);
}
async function sourceUrl(red: number) {
  return `data:application/json;base64,${Buffer.from(await bitmapBlob(red).text()).toString("base64")}`;
}

beforeEach(() => {
  const factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("window", { indexedDB: factory, document: { createElement: canvas }, setTimeout, dispatchEvent: vi.fn() });
  vi.stubGlobal("document", { createElement: canvas });
  vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const value = JSON.parse(await blob.text());
    return { ...value, data: new Uint8ClampedArray(value.data), close: () => undefined };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("dedicated redraw history", () => {
  it("excludes imported images and ordinary checkpoints until a transformation result is saved", async () => {
    const root = await createEditorHistoryRoot("project-a", snapshot());
    const edit = await saveEditorHistoryCheckpoint("project-a", root.branch.id, root.node.id, snapshot(), "修改提示词");
    await renameEditorHistoryNode(edit.id, "自动保存 · 修改提示词");
    expect(await listEditorHistoryProjects()).toEqual([]);
    await saveEditorHistoryCheckpoint("project-a", root.branch.id, edit.id, snapshot(45), "完成重绘", { resultOperation: "inpaint" });
    const [project] = await listEditorHistoryProjects();
    expect(project.nodes).toHaveLength(3);
    expect(project.results).toHaveLength(1);
    expect(project.operations).toEqual(["inpaint"]);
  });

  it("shows applied results saved by older v2 editors even when they lack an operation field", async () => {
    const root = await createEditorHistoryRoot("legacy-v2", snapshot());
    const oldResult = await saveEditorHistoryCheckpoint("legacy-v2", root.branch.id, root.node.id, snapshot(19), "局部重绘 · nai-v5-full");
    const automatic = await saveEditorHistoryCheckpoint("legacy-v2", root.branch.id, oldResult.id, snapshot(25), "自动保存 · 12:34:56");
    expect(oldResult.version).toBe(2);
    expect(oldResult.resultOperation).toBeUndefined();
    expect(automatic.version).toBe(2);
    const [project] = await listEditorHistoryProjects();
    expect(project.results.map((node) => node.id)).toEqual([oldResult.id, automatic.id]);
    expect(project.operations).toEqual(["inpaint"]);
  });

  it("recovers older applied results from changed image data but ignores later autosaves", async () => {
    const root = await createEditorHistoryRoot("legacy-image-diff", snapshot());
    const applied = await saveEditorHistoryCheckpoint("legacy-image-diff", root.branch.id, root.node.id, snapshot(19), "保存 · 13:45");
    const afterApply = await saveEditorHistoryCheckpoint("legacy-image-diff", root.branch.id, applied.id, snapshot(19), "自动保存 · 13:46");
    const [project] = await listEditorHistoryProjects();
    expect(project.results.map((node) => node.id)).toEqual([applied.id]);
    expect(project.results[0].resultOperation).toBe("inpaint");
    expect(afterApply.imageId).toBe(applied.imageId);
  });

  it("recovers legacy applied images even when their checkpoint label says autosave", async () => {
    const root = await createEditorHistoryRoot("legacy-auto-result", snapshot());
    const applied = await saveEditorHistoryCheckpoint("legacy-auto-result", root.branch.id, root.node.id, snapshot(19), "自动保存 · 12:34:56");
    const [project] = await listEditorHistoryProjects();
    expect(project.results.map((node) => node.id)).toEqual([applied.id]);
    expect(project.results[0].resultOperation).toBe("inpaint");
  });

  it("restores exact image pixels, mask, viewport, parameters and selected branch for further editing", async () => {
    const original = snapshot(27, "canvas");
    const root = await createEditorHistoryRoot("project-a", original);
    const result = await saveEditorHistoryCheckpoint("project-a", root.branch.id, root.node.id, original, "扩图结果", { resultOperation: "canvas" });
    original.document.image.data[0] = 99;
    original.workspace.strokes[0].points[0].x = 100;
    const loaded = await loadEditorHistoryNode(result.id);
    expect(loaded?.image.data[0]).toBe(27);
    expect(loaded?.workspace.strokes[0].points[0].x).toBe(1);
    expect(loaded?.workspace.viewport).toEqual({ x: -2, y: 3, width: 2, height: 2 });
    const draft = editorHistoryNodeDraft(loaded!, "selected-branch");
    expect(draft).toMatchObject({ mode: "canvas", historyNodeId: result.id, historyBranchId: "selected-branch", historyTileScale: 3 });
    expect(draft.document.generation?.strength).toBe(.4);
    const url = new URL(editorHistoryEditHref(result, "selected-branch"), "http://localhost");
    expect(url.searchParams.get("nodeId")).toBe(result.id);
    expect(url.searchParams.get("branchId")).toBe("selected-branch");
  });

  it("preserves the original branch head when continuing an older node, including simultaneous results", async () => {
    const root = await createEditorHistoryRoot("project-a", snapshot());
    const results = await Promise.all([10, 20].map((red) => saveEditorHistoryCheckpoint("project-a", root.branch.id, root.node.id, snapshot(red), "重绘", { resultOperation: "inpaint" })));
    const history = await listEditorHistory("project-a");
    expect(history.branches).toHaveLength(2);
    expect(new Set(results.map((node) => node.branchId)).size).toBe(2);
    expect(history.branches.find((branch) => branch.id === root.branch.id)?.headId).toBe(results[0].id);
    const [project] = await listEditorHistoryProjects();
    const forkNodes = editorHistoryBranchNodes(project, results[1].branchId);
    expect(forkNodes.map((node) => node.id)).toEqual([root.node.id, results[1].id]);
    expect(forkNodes.some((node) => node.id === results[0].id)).toBe(false);
  });

  it("allows named branches from shared ancestors and searches image, branch and node names", async () => {
    const root = await createEditorHistoryRoot("project-a", snapshot());
    const branch = await createEditorHistoryBranch("project-a", "角色细化", root.node.id);
    const result = await saveEditorHistoryCheckpoint("project-a", branch.id, root.node.id, snapshot(32), "结果", { resultOperation: "tiled-upscale" });
    await renameEditorHistoryProject("project-a", "月夜头像");
    await renameEditorHistoryBranch(branch.id, "3倍精修");
    await renameEditorHistoryNode(result.id, "最终细节");
    const projects = await listEditorHistoryProjects();
    for (const query of ["月夜", "3倍", "最终", "moonlight", "nai-v5"]) expect(filterEditorHistoryProjects(projects, query)).toHaveLength(1);
    expect(filterEditorHistoryProjects(projects, "", "inpaint")).toHaveLength(0);
    expect(filterEditorHistoryProjects(projects, "", "tiled-upscale")).toHaveLength(1);
    expect(projects[0].results[0].resultOperation).toBe("tiled-upscale");
  });

  it("rejects cross-project parents without leaving partial nodes or branches", async () => {
    const a = await createEditorHistoryRoot("project-a", snapshot());
    const b = await createEditorHistoryRoot("project-b", snapshot());
    await expect(saveEditorHistoryCheckpoint("project-a", a.branch.id, b.node.id, snapshot(12), "wrong parent", { resultOperation: "inpaint" })).rejects.toThrow();
    const history = await listEditorHistory("project-a");
    expect(history.nodes).toHaveLength(1);
    expect(history.branches).toHaveLength(1);
  });

  it("deletes a project without deleting shared image bytes from another project", async () => {
    const a = await createEditorHistoryRoot("project-a", snapshot(14));
    const b = await createEditorHistoryRoot("project-b", snapshot(14));
    await saveEditorHistoryCheckpoint("project-a", a.branch.id, a.node.id, snapshot(14), "a", { resultOperation: "inpaint" });
    const resultB = await saveEditorHistoryCheckpoint("project-b", b.branch.id, b.node.id, snapshot(14), "b", { resultOperation: "upscale" });
    await deleteEditorHistoryProject("project-a");
    expect((await listEditorHistoryProjects()).map((project) => project.id)).toEqual(["project-b"]);
    expect((await loadEditorHistoryNode(resultB.id))?.image.data[0]).toBe(14);
    expect((await getEditorHistoryProjectMetadata("project-a"))?.deleted).toBe(true);
  });

  it("deletes a node while reconnecting descendants and retaining the image data they need", async () => {
    const root = await createEditorHistoryRoot("delete-node", snapshot());
    const first = await saveEditorHistoryCheckpoint("delete-node", root.branch.id, root.node.id, snapshot(12), "first", { resultOperation: "inpaint" });
    const second = await saveEditorHistoryCheckpoint("delete-node", root.branch.id, first.id, snapshot(24), "second", { resultOperation: "inpaint" });
    await deleteEditorHistoryNode(first.id);
    const history = await listEditorHistory("delete-node");
    expect(history.nodes.map((node) => node.id)).toEqual([root.node.id, second.id]);
    expect(history.nodes.find((node) => node.id === second.id)?.parentId).toBe(root.node.id);
    expect(history.branches[0].headId).toBe(second.id);
    expect((await loadEditorHistoryNode(second.id))?.image.data[0]).toBe(24);
  });

  it("deletes only nodes unique to a branch and keeps shared ancestry", async () => {
    const root = await createEditorHistoryRoot("delete-branch", snapshot());
    const mainResult = await saveEditorHistoryCheckpoint("delete-branch", root.branch.id, root.node.id, snapshot(12), "main result", { resultOperation: "inpaint" });
    const branch = await createEditorHistoryBranch("delete-branch", "extra", root.node.id);
    const branchResult = await saveEditorHistoryCheckpoint("delete-branch", branch.id, root.node.id, snapshot(30), "branch result", { resultOperation: "canvas" });
    await deleteEditorHistoryBranch(branch.id);
    const history = await listEditorHistory("delete-branch");
    expect(history.branches.map((item) => item.id)).toEqual([root.branch.id]);
    expect(history.nodes.map((node) => node.id)).toEqual([root.node.id, mainResult.id]);
    expect(await loadEditorHistoryNode(branchResult.id)).toBeNull();
  });

  it("records workbench redraw and native upscale outputs on the source image's branches", async () => {
    const sourceImage = await sourceUrl(1);
    const [first, second] = await Promise.all([
      recordStudioImageEdit({ image: bitmapBlob(20), sourceImage, operation: "inpaint", generation: { model: "nai-v5-full" } }),
      recordStudioImageEdit({ image: bitmapBlob(30), sourceImage, operation: "upscale", generation: { model: "nai-v5-full" } }),
    ]);
    expect(first.editorDraftId).toBe(second.editorDraftId);
    expect(first.editorBranchId).not.toBe(second.editorBranchId);
    const [project] = await listEditorHistoryProjects();
    expect(project.results).toHaveLength(2);
    expect(project.operations.sort()).toEqual(["inpaint", "upscale"]);
  });

  it("migrates only actual edited local images, deduplicates known results and does not resurrect deletions", async () => {
    await saveLocalImageHistory({ id: "text", createdAt: 1, image: bitmapBlob(1), operation: "generate" });
    await saveLocalImageHistory({ id: "resize", createdAt: 2, image: bitmapBlob(2), operation: "upscale" });
    expect(await importLegacyEditorHistory()).toBe(0);
    const [project] = await listEditorHistoryProjects();
    expect(project.operations).toEqual(["upscale"]);
    expect(project.results).toHaveLength(1);
    expect(await importLegacyEditorHistory()).toBe(0);
    expect((await listEditorHistoryProjects())[0].results).toHaveLength(1);
    await deleteEditorHistoryProject(project.id);
    await importLegacyEditorHistory();
    expect(await listEditorHistoryProjects()).toEqual([]);
  });

  it("upgrades the previous database while preserving existing branches and recognizing applied result labels", async () => {
    const state = snapshot(18, "canvas");
    const { image, ...document } = state.document;
    const root: EditorHistoryNode = { id: "old-root", draftId: "old-project", branchId: "old-main", parentId: null, imageId: "old-image", mode: "canvas", tileScale: 2, document, workspace: state.workspace, label: "初始版本", thumbnail: "data:image/jpeg;base64,AA==", createdAt: 1 };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("lfn-image-editor-history-v1", 1);
      request.onupgradeneeded = () => { for (const key of ["studio-source", "branches", "nodes", "images"]) request.result.createObjectStore(key, { keyPath: "id" }); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["nodes", "branches", "images"], "readwrite");
        tx.objectStore("nodes").put(root);
        tx.objectStore("nodes").put({ ...root, id: "old-result", parentId: root.id, label: "扩图 · nai-v5-inpaint", createdAt: 2 });
        tx.objectStore("branches").put({ id: "old-main", draftId: "old-project", name: "main", headId: "old-result", createdAt: 1, updatedAt: 2 });
        tx.objectStore("images").put({ id: "old-image", ...image });
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
    const [project] = await listEditorHistoryProjects();
    expect(project.results.map((node) => node.id)).toEqual(["old-result"]);
    expect((await loadEditorHistoryNode("old-result"))?.resultOperation).toBe("canvas");
    expect(project.branches[0].headId).toBe("old-result");
  });
});
