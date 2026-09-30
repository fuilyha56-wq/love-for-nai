import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  activePromptText, applyPromptWeight, composeReplicaPrompt, DEFAULT_REPLICA_PROMPT_CONFIG,
  parseReplicaPromptConfig, qualityPrompt, readTagWeight, resolvePromptAliases, splitPromptTags,
  supportsLightQuality, transformPromptOnBlur, ucPrompt, withSharedReplicaPresets, type FixedPromptTag, type ReplicaPromptConfig,
} from "@/lib/replica-prompt";
import { qualityTagsForTier, ucForModel } from "@/lib/nai-quality";
import { ReplicaPromptEditor } from "@/app/image/replica-prompt-editor";

const config = (overrides: Partial<ReplicaPromptConfig> = {}): ReplicaPromptConfig => ({
  ...structuredClone(DEFAULT_REPLICA_PROMPT_CONFIG), ...overrides,
});
const fixed = (overrides: Partial<FixedPromptTag> = {}): FixedPromptTag => ({
  id: "fixed-1", name: "", content: "a quiet garden", target: "positive", position: "prefix",
  weight: 1, enabled: true, category: "根目录", ...overrides,
});

describe("提示词合成与现有编辑器互通", () => {
  it("保持 raw 文本，把前缀、输入、透明背景、质量词及后缀按真实请求顺序合成", () => {
    const raw = "1girl,\n  white hair";
    const settings = config({ transparent: true, fixedTags: [
      fixed({ content: "sunlight", weight: 1.2 }),
      fixed({ id: "suffix", content: "detailed", position: "suffix" }),
      fixed({ id: "disabled", content: "must not appear", enabled: false }),
      fixed({ id: "negative", target: "negative", content: "bad hands" }),
    ] });
    const effective = composeReplicaPrompt(raw, "blurry", "nai-v5-full", settings);
    expect(effective.prompt).toBe("1.20::sunlight::, 1girl,\n  white hair, transparent background, very aesthetic, masterpiece, no text, detailed");
    expect(effective.negative).toBe(ucForModel("nai-v5-full", "heavy") + ", bad hands, blurry");
    expect(raw).toBe("1girl,\n  white hair");
    expect(effective.positiveParts.map((part) => part.kind)).toEqual(["fixed", "input", "transparent", "quality", "fixed"]);
    expect(effective.prompt).not.toContain("must not appear");
  });

  it("不会把 TagChipEditor 的禁用注释发送上游，也保留带逗号的权重块", () => {
    const raw = "1girl, /*disabled:{{red eyes, blue eyes}}*/, 1.20::white hair, long hair::";
    expect(activePromptText(raw)).toBe("1girl, 1.20::white hair, long hair::");
    const result = composeReplicaPrompt(raw, "", "nai-v5-full", config({ quality: "none", uc: "none" }));
    expect(result.prompt).toBe("1girl, 1.20::white hair, long hair::");
    expect(result.negative).toBe("");
    expect(raw).toContain("/*disabled:");
  });

  it("禁用单个标签保留 raw 提示词并排除于最终值", () => {
    const result = composeReplicaPrompt("1girl, red eyes, long hair", "", "nai-v5-full", config({ quality: "none", uc: "none", disabledPositive: ["red eyes"] }));
    expect(result.prompt).toBe("1girl, long hair");
  });

  it("质量/UC复用远端共有事实来源；模型ID别名产生同一结果", () => {
    for (const model of ["nai-v5-full", "nai-v4.5-full", "nai-v4.5-curated", "nai-v4-curated", "nai-v3-furry"]) {
      expect(qualityPrompt(model, "standard")).toBe(qualityTagsForTier(model, "nai-default"));
      expect(ucPrompt(model, "human")).toBe(ucForModel(model, "human-focus"));
    }
    expect(qualityPrompt("nai-diffusion-5-full", "light")).toBe(qualityTagsForTier("nai-v5-full", "light"));
    expect(qualityPrompt("nai-diffusion-4-5-full", "standard")).toBe(qualityTagsForTier("nai-v4.5-full", "nai-default"));
    expect(supportsLightQuality("nai-v5-full")).toBe(true);
    expect(supportsLightQuality("nai-v4.5-full")).toBe(false);
  });

  it("自定义预设独立保存，无预设不会误加默认词；非NAI模型不加NAI预设", () => {
    expect(qualityPrompt("nai-v5-full", "custom", " custom quality ")).toBe("custom quality");
    expect(ucPrompt("nai-v5-full", "none")).toBe("");
    expect(qualityPrompt("openai/gpt-image-1", "standard")).toBe("");
    expect(ucPrompt("openai/gpt-image-1", "heavy")).toBe("");
  });

  it("词库引用展开一次，保留未知引用，不破坏原文", () => {
    const library = [fixed({ name: "白发角色", content: "1girl, white hair" })];
    expect(resolvePromptAliases("<白发角色>, <未知>", library)).toBe("1girl, white hair, <未知>");
    const result = composeReplicaPrompt("<白发角色>", "", "nai-v5-full", config({ quality: "none", uc: "none", library }));
    expect(result.prompt).toBe("1girl, white hair");
  });

  it("Custom读取预设页共享内容，清除共享键不复活旧的组件内预设", () => {
    const saved = config({ quality: "custom", uc: "custom", qualityCustom: "old quality", ucCustom: "old uc" });
    const shared = withSharedReplicaPresets(saved, " page quality ", " page uc ");
    const effective = composeReplicaPrompt("1girl", "blurry", "nai-v5-full", shared);
    expect(effective.prompt).toBe("1girl, page quality");
    expect(effective.negative).toBe("page uc, blurry");
    expect(saved.qualityCustom).toBe("old quality");
    const cleared = withSharedReplicaPresets(saved, null, null);
    expect(composeReplicaPrompt("1girl", "blurry", "nai-v5-full", cleared)).toMatchObject({ prompt: "1girl", negative: "blurry" });
  });
});

describe("健壮存储与NAI文本结构", () => {
  it.each([null, "", "{", "[]", '{"version":9,"quality":"none"}'])("损坏或不同版本设置安全回退 (%s)", (serialized) => {
    expect(parseReplicaPromptConfig(serialized)).toEqual(DEFAULT_REPLICA_PROMPT_CONFIG);
  });
  it("校验枚举/权重/列表及重复ID，丢弃无内容条目", () => {
    const parsed = parseReplicaPromptConfig(JSON.stringify({
      version: 1, quality: "bad", uc: "custom", fixedTags: [
        fixed({ weight: 99 }), fixed({ id: "fixed-1", content: "duplicate" }),
        { id: "no-content" }, fixed({ id: "low", weight: -5 }),
      ], settings: { autocomplete: false, highlight: "true", sdConvert: true }, regexRules: [null, { pattern: "girl", replacement: "boy" }],
    }));
    expect(parsed.quality).toBe("standard");
    expect(parsed.uc).toBe("custom");
    expect(parsed.fixedTags).toHaveLength(2);
    expect(parsed.fixedTags.map((entry) => entry.weight)).toEqual([2, 0.5]);
    expect(parsed.settings.autocomplete).toBe(false);
    expect(parsed.settings.sdConvert).toBe(true);
    expect(parsed.regexRules).toHaveLength(1);
  });
  it("普通、强调、数字权重、转义逗号与英文所有格按完整tag分段", () => {
    expect(splitPromptTags("1girl, {red eyes, blue eyes}, 1.20::long hair, white hair::, a\\,b, girl's dress")).toEqual([
      "1girl", "{red eyes, blue eyes}", "1.20::long hair, white hair::", "a\\,b", "girl's dress",
    ]);
    expect(splitPromptTags("girl's dress, blue sky")).toEqual(["girl's dress", "blue sky"]);
    expect(readTagWeight(applyPromptWeight("white hair", 1.2))).toEqual({ content: "white hair", weight: 1.2 });
  });
  it("按开关真实转换SD权重、中文逗号与正则规则，错误规则报告失败", () => {
    const settings = config({ settings: { ...DEFAULT_REPLICA_PROMPT_CONFIG.settings, sdConvert: true }, regexRules: [{ id: "replace", pattern: "red", replacement: "blue", enabled: true }] });
    expect(transformPromptOnBlur("(red eyes:1.2)，1girl", settings)).toEqual({ text: "1.20::blue eyes::, 1girl", error: null });
    expect(transformPromptOnBlur("1girl", config({ regexRules: [{ id: "bad", pattern: "[", replacement: "", enabled: true }] })).error).toContain("正则表达式无效");
  });
});

describe("两种独立Prompt视图", () => {
  const props = { prompt: "1girl", negative: "blurry", model: "nai-v5-full", onPromptChange: () => {}, onNegativeChange: () => {} };
  it("NLW输出正负页签、固定词与Text/Tag入口，未硬编码token计数", () => {
    const html = renderToStaticMarkup(createElement(ReplicaPromptEditor, { ...props, variant: "nlw" }));
    expect(html).toContain('data-variant="nlw"');
    expect(html).toContain('aria-label="管理固定词"');
    expect(html).toContain('aria-label="标签模式"');
    expect(html).toContain('role="tablist"');
    expect(html).not.toContain("1471");
  });
  it("NAI正负页签共用单个编辑器及Quality Tags footer", () => {
    const html = renderToStaticMarkup(createElement(ReplicaPromptEditor, { ...props, variant: "nai" }));
    expect(html).toContain('data-variant="nai"');
    expect(html).toContain("Quality Tags: Standard");
    expect(html).toContain("replica-nai-prompt-card positive");
    expect(html).not.toContain("replica-nai-prompt-card negative");
    expect(html).toContain('role="tablist"');
    expect(html.match(/<textarea/g)).toHaveLength(1);
  });
});
