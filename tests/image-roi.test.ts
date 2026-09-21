import { describe, expect, it } from "vitest";
import {
  ROI_MAX_PIXELS,
  alignRectToMultiple,
  clampPoint,
  expandRect,
  normalizeRect,
  selectionToPatch,
  validateRoi,
} from "@/lib/image-roi";

describe("image ROI geometry", () => {
  it("clamps pointer coordinates to image edges", () => {
    expect(clampPoint({ x: -10, y: 1300 }, { width: 832, height: 1216 })).toEqual({
      x: 0,
      y: 1216,
    });
    expect(clampPoint({ x: 400, y: 600 }, { x: 10, y: 20, width: 100, height: 200 })).toEqual({
      x: 110,
      y: 220,
    });
  });

  it("normalizes reverse drags and expands without mutating the input", () => {
    const original = { x: 300, y: 250, width: -128, height: -64 };
    expect(normalizeRect(original)).toEqual({ x: 172, y: 186, width: 128, height: 64 });
    expect(normalizeRect({ x: 300, y: 250 }, { x: 172, y: 186 })).toEqual({
      x: 172,
      y: 186,
      width: 128,
      height: 64,
    });
    expect(expandRect(original, 32, { width: 832, height: 1216 })).toEqual({
      x: 140,
      y: 154,
      width: 192,
      height: 128,
    });
    expect(original).toEqual({ x: 300, y: 250, width: -128, height: -64 });
  });

  it("aligns a rectangle outward and clips it to image bounds", () => {
    expect(alignRectToMultiple({ x: 70, y: 130, width: 100, height: 100 })).toEqual({
      x: 64,
      y: 128,
      width: 128,
      height: 128,
    });
    expect(alignRectToMultiple({ x: 760, y: 1150, width: 100, height: 100 }, 64, {
      width: 832,
      height: 1216,
    })).toEqual({ x: 704, y: 1088, width: 128, height: 128 });
  });

  it("reports all applicable request-limit violations", () => {
    const result = validateRoi({ x: -1, y: 0, width: 32, height: 2000 }, {
      width: 832,
      height: 1216,
    }, { requireAligned: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "ROI 宽高必须是 64 的倍数",
      "ROI 宽高不能小于 64",
      "ROI 宽高不能超过 1600",
      "ROI 必须位于图像范围内",
    ]));
    expect(validateRoi({ x: 0, y: 0, width: 1600, height: 1600 }, undefined, {
      requireAligned: true,
    })).toMatchObject({ valid: true, area: ROI_MAX_PIXELS });
    expect(validateRoi({ x: 0, y: 0, width: 1600, height: 1536 }, undefined, {
      requireAligned: true,
    }).valid).toBe(true);
  });

  it("maps a selection to a context patch and preserves selection-relative coordinates", () => {
    const patch = selectionToPatch({
      selectionRect: { x: 300, y: 400, width: 128, height: 128 },
      imageSize: { width: 832, height: 1216 },
      context: 32,
    });
    expect(patch.cropRect).toEqual({ x: 256, y: 320, width: 256, height: 256 });
    expect(patch.selectionRect).toEqual({ x: 300, y: 400, width: 128, height: 128 });
    expect(patch.selectionInPatch).toEqual({ x: 44, y: 80, width: 128, height: 128 });
    expect(patch.width * patch.height).toBeLessThanOrEqual(ROI_MAX_PIXELS);
  });

  it("clips edge selections while keeping the patch aligned and valid", () => {
    const patch = selectionToPatch({ x: -10, y: -8, width: 100, height: 100 }, {
      width: 832,
      height: 1216,
    }, 64);
    expect(patch.selectionRect).toEqual({ x: 0, y: 0, width: 90, height: 92 });
    expect(patch.cropRect).toEqual({ x: 0, y: 0, width: 192, height: 192 });
    expect(patch.selectionInPatch).toEqual(patch.selectionRect);
    expect(validateRoi(patch.cropRect, { width: 832, height: 1216 }, {
      requireAligned: true,
    }).valid).toBe(true);
  });
});
