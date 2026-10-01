import { describe, expect, it } from "vitest";
import { inpaintModelFor } from "@/lib/inpaint-model";

describe("重绘使用对应图像模型的正确模型名", () => {
  it.each(["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5", "gemini-2.5-flash-image", "gemini-3-pro-image-preview", "nano-banana", "nano_banana_pro", "dall-e-2"])("编辑模型 %s 保留原模型 ID", model => { expect(inpaintModelFor(model)).toBe(model); });
  it.each(["dall-e-3", "unknown-image-model", "flux-1.1-pro", "nai-chat"])("无编辑能力的模型 %s 不生成虚构重绘模型", model => { expect(inpaintModelFor(model)).toBeNull(); });
  it("显式 Gemini / 聊天图像协议可编辑网关的自定义别名", () => {
    expect(inpaintModelFor("my-image-model", "gemini")).toBe("my-image-model");
    expect(inpaintModelFor("my-image-model", "openai-chat-images")).toBe("my-image-model");
    expect(inpaintModelFor("my-image-model", "openai-images")).toBeNull();
  });
  it.each([
    ["nai-v5-full-limit", "nai-v5-inpaint-limit"],
    ["nai-v4.5-full", "nai-v4.5-inpaint"],
    ["nai-v4.5-curated-limit", "nai-v4.5-inpaint-limit"],
    ["nai-v3-furry-full-limit", "nai-v3-furry-inpaint-limit"],
    ["nai-v3-inpaint", "nai-v3-inpaint"],
  ])("NAI %s 保留模型系列和限量层级 -> %s", (model, expected) => { expect(inpaintModelFor(model)).toBe(expected); });
  it("不支持的 NAI 系列和毛绒组合继续返回空值", () => {
    expect(inpaintModelFor("nai-v4-curated")).toBeNull();
    expect(inpaintModelFor("nai-v5-furry-full")).toBeNull();
  });
});
