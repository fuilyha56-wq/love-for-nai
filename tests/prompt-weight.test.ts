import { describe, expect, it } from "vitest";
import { renderPromptWeight, stepPromptWeight } from "@/lib/prompt-weight";
import { naiNativeGenerationBody } from "@/lib/nai-native-request";

describe("NAI numeric tag weights", () => {
  it.each([-2, 0, .0001, .5, 1.25, 6])("editing a tag preserves an authored weight of %s", weight => {
    expect(renderPromptWeight("rain", 0, weight, false)).toBe(`${weight}::rain::`);
  });
  it("steps signed numeric weights by 0.05 without clipping or floating point noise", () => {
    expect(stepPromptWeight(1.2, 1)).toBe(1.25);
    expect(stepPromptWeight(1.2, -1)).toBe(1.15);
    expect(stepPromptWeight(-2, 1)).toBe(-1.95);
    expect(stepPromptWeight(-2, -1)).toBe(-2.05);
    expect(stepPromptWeight(.05, -1)).toBe(0);
    expect(stepPromptWeight(0, -1)).toBe(-.05);
    expect(stepPromptWeight(3, 1)).toBe(3.05);
  });
  it("toggling disabled tags keeps the weight and bracket edits keep their syntax", () => {
    expect(renderPromptWeight("rain", 0, -2, true)).toBe("/*disabled:-2::rain::*/");
    expect(renderPromptWeight("rain", 0, -2, false)).toBe("-2::rain::");
    expect(renderPromptWeight("rain", 0, 1, false)).toBe("rain");
    expect(renderPromptWeight("rain", 2, null, false)).toBe("{{rain}}");
    expect(renderPromptWeight("rain", -2, null, false)).toBe("[[rain]]");
  });
  it("changed main and character weights reach the native request without changing a locked seed", () => {
    const seed = 123456789;
    for (const weight of [1.8, .4, -2, 0]) {
      const prompt = renderPromptWeight("sitting", 0, weight, false);
      const body = naiNativeGenerationBody({ model: "nai-v5-full", operation: "generate", prompt, negative_prompt: "-1.5::clouds::", width: 832, height: 1216, seed, characterPrompts: [{ prompt, negativePrompt: "-2::hat::" }] });
      expect(body.input).toBe(prompt);
      expect(body.parameters).toMatchObject({ seed, negative_prompt: "-1.5::clouds::", v4_prompt: { caption: { base_caption: prompt, char_captions: [{ char_caption: prompt }] } }, v4_negative_prompt: { caption: { char_captions: [{ char_caption: "-2::hat::" }] } } });
    }
  });
  it("LFN generates fresh nonzero seeds for missing and zero values, and preserves fixed seeds", () => {
    for (const model of ["nai-v5-full", "nai-v5-full-medium", "nai-v5-full-limit"]) {
      for (const seed of [undefined, 0]) {
        const values = Array.from({ length: 32 }, () => {
          const body = naiNativeGenerationBody({ model, prompt: "landscape", width: 832, height: 1216, seed });
          return (body.parameters as Record<string, unknown>).seed as number;
        });
        expect(new Set(values).size).toBeGreaterThan(1);
        expect(values.every(value => Number.isSafeInteger(value) && value > 0 && value <= 4294967295)).toBe(true);
      }
      const fixed = Array.from({ length: 3 }, () => (naiNativeGenerationBody({ model, prompt: "landscape", seed: 4177658580 }).parameters as Record<string, unknown>).seed);
      expect(fixed).toEqual([4177658580, 4177658580, 4177658580]);
    }
  });
});
