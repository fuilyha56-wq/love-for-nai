import { describe, expect, it } from "vitest";
import { imageProductMode, isKnownImageModel, modelMatchesProductMode, nearestImageAspectRatio, nearestImageSize, normalizeImageModelSize, resolveImageModelCapabilities, resolveProviderImageProtocol } from "@/lib/image-model-capabilities";

describe("图像模型能力和协议选择", () => {
  it("NAI 保留标签、种子、采样和原生参考；GPT/Gemini 使用自然语言", () => {
    expect(resolveImageModelCapabilities("nai-v5-full")).toMatchObject({ family: "nai", protocol: "nai", promptStyle: "tags", acceptsNegative: true, seed: true, sampling: true, characters: true });
    expect(resolveImageModelCapabilities("gpt-image-1.5")).toMatchObject({ family: "gpt-image", protocol: "openai-images", promptStyle: "natural", nativeMask: true, acceptsNegative: false, seed: false, sampling: false });
    expect(resolveImageModelCapabilities("gemini-3.1-flash-image-preview", "gemini")).toMatchObject({ family: "gemini", protocol: "gemini", nativeMask: false, edit: true, maxBatch: 1 });
  });
  it("兼容网关默认 images 端点，原生 Google 地址和显式别名选择对应协议", () => {
    expect(resolveImageModelCapabilities("gemini-2.5-flash-image").protocol).toBe("openai-images");
    expect(resolveProviderImageProtocol("auto", "https://generativelanguage.googleapis.com")).toBe("gemini");
    expect(resolveProviderImageProtocol("openai-images", "https://generativelanguage.googleapis.com")).toBe("openai-images");
    expect(resolveImageModelCapabilities("banana-alias", "gemini").edit).toBe(true);
    expect(resolveImageModelCapabilities("nano-banana-pro")).toMatchObject({ family: "nano-banana", protocol: "gemini" });
    expect(resolveImageModelCapabilities("banana-alias", "openai-chat-images").protocol).toBe("openai-chat-images");
  });
  it("按产品模式区分 NAI、GPT 和 Nano Banana", () => {
    expect(imageProductMode("nai-v5-full")).toBe("nai");
    expect(imageProductMode("gpt-image-1.5")).toBe("gpt");
    expect(imageProductMode("nano-banana-pro")).toBe("nano-banana");
    expect(modelMatchesProductMode("gemini-3-pro-image-preview", "nano-banana")).toBe(true);
    expect(modelMatchesProductMode("nai-v5-full", "gpt")).toBe(false);
  });
  it("识别图像模型且不把普通聊天 Gemini 当作图像模型", () => {
    for (const model of ["gpt-image-2", "gemini-3-pro-image-preview", "nano-banana-pro", "nanobanana", "flux-dev"]) expect(isKnownImageModel(model)).toBe(true);
    for (const model of ["gemini-3-pro", "gemini-2.5-flash", "nai-chat", "gpt-4o"]) expect(isKnownImageModel(model)).toBe(false);
    expect(resolveImageModelCapabilities("unknown-model").operations).toEqual(["generate"]);
    expect(resolveImageModelCapabilities("dall-e-3").edit).toBe(false);
  });
  it("把原有自定义尺寸映射为模型支持的最接近横竖尺寸", () => {
    const sizes = resolveImageModelCapabilities("gpt-image-1").sizes;
    expect(nearestImageSize(832, 1216, sizes)).toBe("1024x1536");
    expect(nearestImageSize(1216, 832, sizes)).toBe("1536x1024");
    expect(nearestImageSize(1000, 1000, sizes)).toBe("1024x1024");
    expect(nearestImageAspectRatio(1600, 900)).toBe("16:9");
  });
  it("GPT2/2.5 自定义尺寸满足边长、面积、比例和16倍数约束", () => {
    expect(normalizeImageModelSize("gpt-image-2", 832, 1216)).toEqual({ width: 832, height: 1216 });
    for (const [width, height] of [[64, 64], [512, 1024], [1600, 64], [4096, 4096], [3839, 2161], [832, 1217]]) {
      const size = normalizeImageModelSize("gpt-image-2.5-sunburst", width, height);
      expect(size.width % 16).toBe(0);
      expect(size.height % 16).toBe(0);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(3840);
      expect(size.width * size.height).toBeGreaterThanOrEqual(655_360);
      expect(size.width * size.height).toBeLessThanOrEqual(8_294_400);
      expect(Math.max(size.width, size.height) / Math.min(size.width, size.height)).toBeLessThanOrEqual(3);
    }
    expect(resolveImageModelCapabilities("gpt-image-2.5-sunburst").qualityOptions).toContain("max");
    expect(resolveImageModelCapabilities("gpt-image-1.5").qualityOptions).not.toContain("max");
    expect(resolveImageModelCapabilities("gemini-3.1-flash-lite-image", "gemini").imageSizes).toEqual(["1K"]);
    expect(resolveImageModelCapabilities("gemini-3-pro-image-preview", "gemini").imageSizes).toEqual(["1K", "2K", "4K"]);
    expect(resolveImageModelCapabilities("gemini-3-pro-image-preview").imageSizes).toEqual([]);
    expect(resolveImageModelCapabilities("gpt-image-1.5", "openai-chat-images").qualityOptions).toEqual([]);
  });
});
