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
});
