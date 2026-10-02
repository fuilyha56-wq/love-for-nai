import { describe, expect, it } from "vitest";
import {
  adaptAssistantSuggestion,
  assistantHistoryMatchesTarget,
  buildAssistantModelPrompt,
  buildInlineAssistantPrompt,
  resolveAssistantImageTarget,
} from "@/lib/assistant-model-prompts";
import { parseTagSuggestion } from "@/lib/tag-suggestion";

describe("model-specific image assistant", () => {
  it("keeps old clients on the NAI tag workflow and separates the image target from the LLM", () => {
    const old = resolveAssistantImageTarget({});
    expect(old.capabilities.promptStyle).toBe("tags");
    const target = resolveAssistantImageTarget({ imageModel: "gpt-image-1.5", operation: "inpaint" });
    expect(target.imageModel).toBe("gpt-image-1.5");
    expect(target.operation).toBe("inpainting");
    expect(target.capabilities.promptStyle).toBe("natural");
  });

  it("validates explicitly supplied image target fields", () => {
    expect(() => resolveAssistantImageTarget({ imageModel: "bad\nmodel" })).toThrow("模型 ID");
    expect(() => resolveAssistantImageTarget({ modelProtocol: "anything" })).toThrow("协议");
    expect(() => resolveAssistantImageTarget({ operation: "delete" })).toThrow("操作");
    expect(resolveAssistantImageTarget({ targetImageModel: "custom-image", modelProtocol: "gemini" }).capabilities.family).toBe("gemini");
  });

  it("uses natural scene and edit instructions with model capabilities for GPT and Gemini", () => {
    const gpt = buildAssistantModelPrompt(resolveAssistantImageTarget({ imageModel: "gpt-image-1.5", operation: "inpainting" }), "legacy NAI instructions");
    expect(gpt).not.toContain("legacy NAI instructions");
    expect(gpt).toContain('"allowedParameters":["width","height"]');
    expect(gpt).toContain("蒙版是模型的编辑指导");
    expect(gpt).toContain("改变什么");
    expect(gpt).toContain("绘制的文字原样保留");
    expect(gpt).toContain("tags 必须是空数组");
    const gemini = buildAssistantModelPrompt(resolveAssistantImageTarget({ imageModel: "gemini-2.5-flash-image" }), "legacy");
    expect(gemini).toContain("没有原生 mask 参数");
    expect(gemini).toContain('"supportedAspectRatios"');
  });

  it("does not allow natural-language models to apply diffusion parameters or NAI character slots", () => {
    const input = parseTagSuggestion(JSON.stringify({
      prompt: 'An evening portrait with a sign that reads "你好".',
      negativePrompt: "watermark",
      tags: ["some_unrecognized_natural_phrase"],
      characters: [{ prompt: "blue hair", center: { x: 0.25, y: 0.5 } }],
      parameters: { width: 832, height: 1216, steps: 28, scale: 5, sampler: "k_euler", noiseSchedule: "karras", seed: 123 },
    }));
    const output = adaptAssistantSuggestion(input, resolveAssistantImageTarget({ imageModel: "gpt-image-1" }));
    expect(output.prompt).toContain('"你好"');
    expect(output.prompt).toContain("Avoid: watermark");
    expect(output.negativePrompt).toBe("");
    expect(output.tags).toEqual([]);
    expect(output.characters).toBeUndefined();
    expect(output.parameters).toEqual({ width: 1024, height: 1536 });
  });

  it("does not emit incomplete native size pairs or non-finite dimensions", () => {
    const target = resolveAssistantImageTarget({ imageModel: "gpt-image-1" });
    expect(adaptAssistantSuggestion(parseTagSuggestion('{"parameters":{"width":1024}}'), target).parameters).toEqual({});
    expect(adaptAssistantSuggestion(parseTagSuggestion('{"parameters":{"width":-1,"height":8192}}'), target).parameters).toEqual({});
  });

  it("retains supported NAI tags, characters and valid sampling controls", () => {
    const input = parseTagSuggestion(JSON.stringify({ prompt: "1girl", negativePrompt: "blurry", tags: ["white_hair"], characters: [{ prompt: "1girl" }], parameters: { width: 835, height: 1216, steps: 28, scale: 5, sampler: "k_euler", noiseSchedule: "native", seed: 123 } }));
    const result = adaptAssistantSuggestion(input, resolveAssistantImageTarget({ imageModel: "nai-v5-full" }));
    expect(result.tags).toEqual(["white_hair"]);
    expect(result.characters).toHaveLength(1);
    expect(result.negativePrompt).toBe("blurry");
    expect(result.parameters).toEqual({ width: 832, height: 1216, steps: 28, scale: 5, sampler: "k_euler", noiseSchedule: "native", seed: 123 });
  });

  it("rejects hallucinated NAI sampler/schedule names and out-of-range controls", () => {
    const input = parseTagSuggestion(JSON.stringify({ parameters: { steps: 999, scale: -5, sampler: "imaginary_sampler", noiseSchedule: "made_up", seed: 4294967296, width: 2048, height: 2048 } }));
    expect(adaptAssistantSuggestion(input, resolveAssistantImageTarget({})).parameters).toEqual({});
  });

  it("only injects history from the same canonical image family", () => {
    const gemini = resolveAssistantImageTarget({ imageModel: "gemini-2.5-flash-image" });
    expect(assistantHistoryMatchesTarget({}, gemini)).toBe(false);
    expect(assistantHistoryMatchesTarget({ imageModel: "nai-v5-full" }, gemini)).toBe(false);
    expect(assistantHistoryMatchesTarget({ imageModel: "gpt-image-1" }, gemini)).toBe(false);
    expect(assistantHistoryMatchesTarget({ imageModel: "gemini-3-pro-image-preview" }, gemini)).toBe(true);
    const nano = resolveAssistantImageTarget({ imageModel: "nano-banana-pro" });
    expect(assistantHistoryMatchesTarget({ imageModel: "gemini-2.5-flash-image" }, nano)).toBe(false);
    expect(assistantHistoryMatchesTarget({ imageModel: "nano-banana-pro" }, nano)).toBe(true);
    expect(assistantHistoryMatchesTarget({ imageModel: "bad\nmodel" }, gemini)).toBe(false);
  });

  it("adapts inline editing without replacing the requested action", () => {
    const prompt = buildInlineAssistantPrompt("把选中内容翻译为英文。只输出译文。", resolveAssistantImageTarget({ imageModel: "nano-banana", operation: "img2img" }));
    expect(prompt).toContain("只输出译文");
    expect(prompt).toContain('"operation":"img2img"');
    expect(prompt).toContain("采用自然语言");
    expect(buildInlineAssistantPrompt("fix", resolveAssistantImageTarget({}))).toContain("NovelAI 英文标签");
  });
});
