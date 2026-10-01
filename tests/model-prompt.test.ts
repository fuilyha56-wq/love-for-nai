import { describe, expect, it } from "vitest";
import { composeModelPrompt, transformModelPromptOnBlur } from "@/lib/model-prompt";
import { composeReplicaPrompt, DEFAULT_REPLICA_PROMPT_CONFIG, type FixedPromptTag, type ReplicaPromptConfig } from "@/lib/replica-prompt";

const config = (overrides: Partial<ReplicaPromptConfig> = {}): ReplicaPromptConfig => ({ ...structuredClone(DEFAULT_REPLICA_PROMPT_CONFIG), ...overrides });
const fixed = (overrides: Partial<FixedPromptTag> = {}): FixedPromptTag => ({ id: "fixed", name: "构图", content: "Use an eye-level view.", target: "positive", position: "prefix", weight: 1.8, enabled: true, category: "根目录", ...overrides });

describe("按图像模型保留提示词语义", () => {
  it.each(["gpt-image-1.5", "gemini-2.5-flash-image", "nano-banana", "custom-image-model"])("%s 原样保留自然语言、中文逗号、引号和换行，不注入 NAI 预设", model => {
    const prompt = 'A girl with blue hair，stands beside a sign reading "Hello, world".\n\nUse soft window light and keep (2 + 3) visible.';
    const negative = 'Avoid blurry hands，and preserve the word "Tomorrow".\nDo not crop the sign.';
    const result = composeModelPrompt(prompt, negative, model, config({ quality: "custom", qualityCustom: "NAI QUALITY MUST NOT APPEAR", uc: "custom", ucCustom: "NAI UC MUST NOT APPEAR" }));
    expect(result.prompt).toBe(prompt);
    expect(result.negative).toBe(negative);
    expect(result.positiveParts).toEqual([{ label: "场景描述", content: prompt, kind: "input" }]);
    expect(result.negativeParts).toEqual([{ label: "排除要求", content: negative, kind: "input" }]);
    expect(result.prompt).not.toContain("blue_hair");
    expect(result.prompt).not.toContain("very aesthetic");
  });

  it("自然语言按前缀、输入、透明背景、后缀顺序组合，保留固定词和词库引用但不生成 NAI 权重", () => {
    const settings = config({ transparent: true, library: [fixed({ name: "角色", content: 'A silver-haired woman wearing a jacket labeled "LFN".' })], fixedTags: [
      fixed({ content: "Portrait of <角色>" }),
      fixed({ id: "suffix", name: "照明", content: "Use cinematic lighting.", position: "suffix", weight: 0.5 }),
      fixed({ id: "negative", name: "限制", target: "negative", content: "Keep the background uncluttered." }),
      fixed({ id: "disabled", enabled: false, content: "DO NOT INCLUDE" }),
    ] });
    const result = composeModelPrompt("<角色>\nHold a red umbrella，with both hands.", "Avoid cropped faces.", "gpt-image-1", settings);
    expect(result.prompt).toBe('Portrait of A silver-haired woman wearing a jacket labeled "LFN".\nA silver-haired woman wearing a jacket labeled "LFN".\nHold a red umbrella，with both hands.\nUse a transparent background.\nUse cinematic lighting.');
    expect(result.negative).toBe("Keep the background uncluttered.\nAvoid cropped faces.");
    expect(result.positiveParts.map(part => part.kind)).toEqual(["fixed", "input", "transparent", "fixed"]);
    expect(result.prompt).not.toContain("::");
    expect(result.prompt).not.toContain("DO NOT INCLUDE");
  });

  it("自然语言失焦仅应用用户正则，自动格式化及 SD 转换开关不会改写句子", () => {
    const settings = config({ settings: { ...DEFAULT_REPLICA_PROMPT_CONFIG.settings, autoFormat: true, sdConvert: true }, regexRules: [{ id: "color", pattern: "blue", replacement: "silver", enabled: true, flags: "g" }] });
    expect(transformModelPromptOnBlur('A girl with (blue hair:1.2)，reads "blue sky".\nKeep the same face.', settings, true)).toEqual({ text: 'A girl with (silver hair:1.2)，reads "silver sky".\nKeep the same face.', error: null });
    const source = 'A girl with blue hair，reads "blue sky".\nKeep the same face.';
    expect(transformModelPromptOnBlur(source, config(), true)).toEqual({ text: source, error: null });
  });

  it("自然语言正则错误保持原文，避免按顺序部分修改", () => {
    const source = "A girl with blue hair.";
    const settings = config({ regexRules: [{ id: "valid", pattern: "blue", replacement: "red", enabled: true }, { id: "broken", pattern: "[", replacement: "", enabled: true }] });
    const result = transformModelPromptOnBlur(source, settings, true);
    expect(result.text).toBe(source);
    expect(result.error).toContain("正则表达式无效");
  });

  it("共用模型来源的非 NAI 协议设置不会给实际 NAI 模型改变提示词格式", () => {
    const prompt = "1girl, blue hair";
    const settings = config();
    expect(composeModelPrompt(prompt, "blurry", "nai-v5-full", settings, "openai-chat-images")).toEqual(composeReplicaPrompt(prompt, "blurry", "nai-v5-full", settings));
  });

  it("NAI 继续使用原有质量词、UC、固定词权重及完整合成顺序", () => {
    const settings = config({ transparent: true, fixedTags: [fixed({ content: "sunlight", weight: 1.2 }), fixed({ id: "negative", target: "negative", content: "bad hands" })] });
    const result = composeModelPrompt("1girl,\nwhite hair", "blurry", "nai-v5-full", settings);
    expect(result).toEqual(composeReplicaPrompt("1girl,\nwhite hair", "blurry", "nai-v5-full", settings));
    expect(result.prompt).toBe("1.20::sunlight::, 1girl,\nwhite hair, transparent background, very aesthetic, masterpiece, no text");
    expect(result.negative).toContain("bad hands");
    expect(result.negative).toContain("blurry");
    expect(result.positiveParts.map(part => part.kind)).toEqual(["fixed", "input", "transparent", "quality"]);
  });

  it("NAI 失焦继续按正则、SD 转换、自动格式化顺序处理", () => {
    const settings = config({ settings: { ...DEFAULT_REPLICA_PROMPT_CONFIG.settings, sdConvert: true }, regexRules: [{ id: "hair", pattern: "white hair", replacement: "silver hair", enabled: true }] });
    expect(transformModelPromptOnBlur("(white hair:1.2)，blue eyes\nred hair", settings, false)).toEqual({ text: "1.20::silver_hair::, blue_eyes\nred_hair", error: null });
  });
});
