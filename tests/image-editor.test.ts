import { describe, expect, it } from "vitest";
import {
  addMaskStroke,
  alphaBounds,
  applyPendingCandidate,
  applyReviewSession,
  createEditorDocument,
  createMaskState,
  createRgbaImage,
  createReviewSession,
  createTransparentMask,
  discardReviewSession,
  moveViewport,
  resizeViewport,
  screenToWorld,
  toWhiteBackgroundExport,
  undoMaskStroke,
  worldToScreen,
  type PendingCandidate,
} from "@/lib/image-editor";
import {
  createEditorDraft,
  deleteEditorDraft,
  listEditorDrafts,
  loadEditorDraft,
  saveEditorDraft,
} from "@/lib/image-editor-store";

describe("image editor geometry and pixel helpers", () => {
  it("round-trips negative world coordinates through camera transforms", () => {
    const camera = { x: -120, y: 64, zoom: 2 };
    const world = { x: -80, y: 96 };
    const screen = worldToScreen(world, camera, { x: 10, y: 20 });
    expect(screen).toEqual({ x: 90, y: 84 });
    expect(screenToWorld(screen, camera, { x: 10, y: 20 })).toEqual(world);
  });

  it("moves and resizes a viewport while preserving its aspect ratio", () => {
    const initial = { x: 10, y: 20, width: 100, height: 50 };
    expect(moveViewport(initial, { x: -30, y: 8 })).toEqual({ x: -20, y: 28, width: 100, height: 50 });
    expect(resizeViewport(initial, "se", { x: 180, y: 100 }, { aspect: 2 })).toEqual({
      x: 10,
      y: 20,
      width: 170,
      height: 85,
    });
  });

  it("finds alpha bounds and turns transparent pixels into a mask", () => {
    const image = createRgbaImage(3, 2);
    image.data.set([
      0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 1, 2, 3, 128, 0, 0, 0, 0,
    ]);
    expect(alphaBounds(image, 0, { x: -4, y: 7 })).toEqual({ x: -3, y: 7, width: 1, height: 2 });
    expect(createTransparentMask(image).data).toEqual(new Uint8ClampedArray([255, 0, 255, 255, 0, 255]));
  });

  it("supports mask history and does not mutate the source document on candidate creation", () => {
    const state = addMaskStroke(createMaskState(), { points: [{ x: 1, y: 2 }], radius: 4 });
    expect(undoMaskStroke(state)).toMatchObject({ strokes: [], undone: [{ radius: 4 }] });

    const baseImage = createRgbaImage(2, 2);
    baseImage.data.set([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
    const document = createEditorDocument(baseImage);
    const patch = createRgbaImage(1, 1);
    patch.data.set([0, 0, 255, 255]);
    const candidate: PendingCandidate = { id: "candidate", patch, viewport: { x: 1, y: 1, width: 1, height: 1 } };
    const review = createReviewSession(document, candidate);
    expect(document.image.data[2]).toBe(0);
    const applied = applyReviewSession(review).document;
    expect(applied.image.data.slice(4, 8)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
    expect(applied.image.data.slice(12, 16)).toEqual(new Uint8ClampedArray([0, 0, 255, 255]));
    expect(discardReviewSession(review).status).toBe("discarded");
  });

  it("expands the world rect when applying an outpainting patch", () => {
    const document = createEditorDocument(createRgbaImage(2, 2));
    const patch = createRgbaImage(1, 1);
    patch.data.set([20, 30, 40, 255]);
    const result = applyPendingCandidate(document, { id: "outside", patch, viewport: { x: -1, y: -1, width: 1, height: 1 } });
    expect(result.worldRect).toEqual({ x: -1, y: -1, width: 3, height: 3 });
    expect(result.image.data.slice(0, 4)).toEqual(new Uint8ClampedArray([20, 30, 40, 255]));
  });

  it("scales a patch continuously across a larger world viewport", () => {
    const document = createEditorDocument(createRgbaImage(1, 1));
    const patch = createRgbaImage(1, 1);
    patch.data.set([12, 34, 56, 255]);
    const result = applyPendingCandidate(document, {
      id: "scaled",
      patch,
      viewport: { x: 1, y: 0, width: 3, height: 2 },
    });
    expect(result.worldRect).toEqual({ x: 0, y: 0, width: 4, height: 2 });
    for (const [x, y] of [[1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 1]]) {
      const offset = (y * result.image.width + x) * 4;
      expect(Array.from(result.image.data.slice(offset, offset + 4))).toEqual([12, 34, 56, 255]);
    }
  });

  it("composites transparent pixels onto a white export without changing the source", () => {
    const image = createRgbaImage(1, 1);
    image.data.set([100, 50, 0, 128]);
    expect(toWhiteBackgroundExport(image).data).toEqual(new Uint8ClampedArray([177, 152, 127, 255]));
    expect(image.data[3]).toBe(128);
  });
});

describe("image editor draft store browser guards", () => {
  it("does not require IndexedDB during server-side use", async () => {
    const document = createEditorDocument(createRgbaImage(1, 1));
    const draft = createEditorDraft("server-draft", "canvas", document);
    await expect(loadEditorDraft(draft.id)).resolves.toBeNull();
    await expect(listEditorDrafts()).resolves.toEqual([]);
    await expect(deleteEditorDraft(draft.id)).resolves.toBeUndefined();
    await expect(saveEditorDraft(draft)).rejects.toThrow("IndexedDB");
  });
});
