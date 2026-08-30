import { describe, expect, it } from "vitest";
import { parseTagSuggestion } from "@/lib/tag-suggestion";

describe("parseTagSuggestion", () => {
  it("normalizes and validates model output", () => {
    const result = parseTagSuggestion(
      'prefix {"prompt":"1girl","negativePrompt":"blur","tags":[" white_hair ",4,""],"parameters":{"width":832,"scale":5,"sampler":"k_euler","seed":"bad"}} suffix',
    );

    expect(result).toEqual({
      prompt: "1girl",
      negativePrompt: "blur",
      tags: ["white_hair"],
      parameters: {
        width: 832,
        height: undefined,
        steps: undefined,
        scale: 5,
        sampler: "k_euler",
        noiseSchedule: undefined,
        seed: undefined,
      },
    });
  });

  it("limits the number of tags", () => {
    const tags = Array.from({ length: 30 }, (_, index) => `tag_${index}`);
    const result = parseTagSuggestion(JSON.stringify({ tags }));
    expect(result.tags).toHaveLength(24);
  });

  it("treats seed 0 as not provided so the seed box stays empty", () => {
    const result = parseTagSuggestion(
      JSON.stringify({ parameters: { seed: 0, steps: 28 } }),
    );
    expect(result.parameters.seed).toBeUndefined();
    const positive = parseTagSuggestion(
      JSON.stringify({ parameters: { seed: 12345 } }),
    );
    expect(positive.parameters.seed).toBe(12345);
  });

  it("rejects missing or malformed JSON", () => {
    expect(() => parseTagSuggestion("no json")).toThrow(
      "模型未返回可读取的建议",
    );
    expect(() => parseTagSuggestion("{broken}")).toThrow("不是合法 JSON");
  });

  it("parses multi-character suggestions with clamped centers", () => {
    const result = parseTagSuggestion(
      JSON.stringify({
        prompt: "a garden scene",
        characters: [
          { prompt: "1girl, white hair", center: { x: 0.3, y: 0.5 } },
          { prompt: "1boy, black hair", center: { x: 1.7, y: -2 } },
          { prompt: "   ", center: { x: 0.5, y: 0.5 } },
        ],
      }),
    );

    expect(result.characters).toHaveLength(2);
    expect(result.characters?.[0]).toEqual({
      prompt: "1girl, white hair",
      centerX: 0.3,
      centerY: 0.5,
    });
    // 越界坐标钳位到 0–1。
    expect(result.characters?.[1]).toEqual({
      prompt: "1boy, black hair",
      centerX: 1,
      centerY: 0,
    });
  });

  it("defaults missing centers to 0.5 and caps at 6 characters", () => {
    const characters = Array.from({ length: 9 }, (_, index) => ({
      prompt: `character ${index}`,
    }));
    const result = parseTagSuggestion(JSON.stringify({ characters }));

    expect(result.characters).toHaveLength(6);
    expect(result.characters?.[0]).toEqual({
      prompt: "character 0",
      centerX: 0.5,
      centerY: 0.5,
    });
  });

  it("omits characters when absent or empty", () => {
    expect(
      parseTagSuggestion(JSON.stringify({ prompt: "scene" })).characters,
    ).toBeUndefined();
    expect(
      parseTagSuggestion(JSON.stringify({ characters: [] })).characters,
    ).toBeUndefined();
    expect(
      parseTagSuggestion(JSON.stringify({ characters: [{ nope: 1 }] }))
        .characters,
    ).toBeUndefined();
  });
});
