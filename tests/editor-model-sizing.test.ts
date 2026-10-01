import { describe, expect, it } from "vitest";
import { fitViewport, normalizeEditorOutputSize, viewportImage } from "@/app/image/editor/editor";
import { createEditorDocument, createRgbaImage, type EditorDocument } from "@/lib/image-editor";

describe("编辑器根据图像模型准备一致的输出和蒙版", () => {
  it("NAI 保留 64 网格和 1600 边长限制", () => {
    expect(normalizeEditorOutputSize("nai-v5-inpaint", 832, 1217)).toEqual({ width: 832, height: 1216 });
    expect(normalizeEditorOutputSize("nai-v5-inpaint", 3840, 2160)).toEqual({ width: 1600, height: 1600 });
    expect(normalizeEditorOutputSize("nai-v5-inpaint", 1, 1)).toEqual({ width: 64, height: 64 });
  });

  it("GPT 2 保留允许的高分辨率和 16 网格，并约束小图和过大尺寸", () => {
    expect(normalizeEditorOutputSize("gpt-image-2", 3840, 2160)).toEqual({ width: 3840, height: 2160 });
    expect(normalizeEditorOutputSize("gpt-image-2", 1376, 768)).toEqual({ width: 1376, height: 768 });
    for (const [width, height] of [[64, 64], [8000, 5000], [3840, 64]]) {
      const size = normalizeEditorOutputSize("gpt-image-2.5", width, height);
      expect(size.width % 16).toBe(0);
      expect(size.height % 16).toBe(0);
      expect(size.width * size.height).toBeGreaterThanOrEqual(655_360);
      expect(size.width * size.height).toBeLessThanOrEqual(8_294_400);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(3840);
      expect(Math.max(size.width, size.height) / Math.min(size.width, size.height)).toBeLessThanOrEqual(3);
    }
  });

  it("GPT 1.x 采用支持的固定尺寸，Gemini 保留大于 NAI 上限的请求尺寸", () => {
    expect(normalizeEditorOutputSize("gpt-image-1.5", 832, 1216)).toEqual({ width: 1024, height: 1536 });
    expect(normalizeEditorOutputSize("gemini-3.1-flash-image-preview", 3840, 2160, "gemini")).toEqual({ width: 3840, height: 2160 });
    const size = normalizeEditorOutputSize("gemini-3-pro-image-preview", 7680, 4320, "gemini");
    expect(size.width * size.height).toBeLessThanOrEqual(8_294_400);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 1);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
  });

  it("准备图片和蒙版使用归一化后的实际尺寸，避免再次截成 1600 或 64 网格", () => {
    const source = createRgbaImage(2, 2, new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255]));
    const document = createEditorDocument(source, { x: 0, y: 0, width: 2, height: 2 });
    const size = normalizeEditorOutputSize("gemini-3-pro-image-preview", 1936, 16, "gemini");
    const prepared = viewportImage(document, document.worldRect, size);
    expect(prepared.image.width).toBe(1936);
    expect(prepared.image.height).toBe(16);
    expect(prepared.mask.length).toBe(size.width * size.height);
    expect(prepared.image.data.slice(0, 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
    expect(prepared.image.data.slice(-4)).toEqual(new Uint8ClampedArray([255, 255, 255, 255]));
    expect(prepared.mask.every(value => value === 0)).toBe(true);
  });

  it("自然语言模型取景使用完整源图片；NAI 沿用原有 1600 取景行为", () => {
    const document: EditorDocument = { version: 1, revision: 0, image: { width: 4096, height: 3072, data: new Uint8ClampedArray() }, worldRect: { x: 100, y: 200, width: 4096, height: 3072 }, generation: { model: "gpt-image-2" } };
    expect(fitViewport(document, 3840, 2160)).toEqual({ x: 100, y: 584, width: 4096, height: 2304 });
    const legacy = fitViewport({ ...document, generation: { model: "nai-v5-inpaint" } }, 832, 1216);
    expect(legacy.width).toBeLessThanOrEqual(1600);
    expect(legacy.height).toBe(1600);
    expect(fitViewport({ ...document, image: { width: 1, height: 1, data: new Uint8ClampedArray() } }, 3840, 2160).height).toBe(1);
  });
});
