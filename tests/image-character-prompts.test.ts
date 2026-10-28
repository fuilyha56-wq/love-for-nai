import { describe, expect, it } from "vitest";
import { hasImageCharacterPrompts, imageCharacterUseCoords, imagePromptText, readImageCharacterPrompts, restoreImageCharacterPrompts } from "@/lib/image-character-prompts";
import { mapNaiParameters } from "@/lib/nai-import";

const metadata = {
  v4_prompt: { caption: { base_caption: "scene", char_captions: [
    { char_caption: "red hair, blue eyes", centers: [{ x: .2, y: .5 }] },
    { char_caption: "black hair, green eyes", centers: [{ x: .8, y: .4 }] },
  ] }, use_coords: true },
  v4_negative_prompt: { caption: { base_caption: "lowres", char_captions: [
    { char_caption: "hat" }, { char_caption: "glasses" },
  ] } },
};

describe("character prompt transport", () => {
  it("reads NAI character captions with matching negatives and positions", () => {
    expect(readImageCharacterPrompts(metadata)).toEqual([
      { prompt: "red hair, blue eyes", negativePrompt: "hat", center: { x: .2, y: .5 } },
      { prompt: "black hair, green eyes", negativePrompt: "glasses", center: { x: .8, y: .4 } },
    ]);
    expect(imagePromptText(metadata)).toEqual({ prompt: "scene", negativePrompt: "lowres" });
    expect(imageCharacterUseCoords(metadata)).toBe(true);
  });
  it("keeps empty positive slots aligned with negative captions", () => {
    const result = readImageCharacterPrompts({ ...metadata, v4_prompt: { caption: { char_captions: [{ char_caption: "" }, { char_caption: "second" }] } } });
    expect(result.map(item => [item.prompt, item.negativePrompt])).toEqual([["", "hat"], ["second", "glasses"]]);
  });
  it("stores only text and bounded positions, never attached image data", () => {
    const result = readImageCharacterPrompts({ characterPrompts: [{ prompt: "girl", negative: "hat", center: { x: -1, y: 2 }, image: "private-image", reference: { data: "private-reference" } }] });
    expect(result).toEqual([{ prompt: "girl", negativePrompt: "hat", center: { x: 0, y: 1 } }]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("supports UI coordinates and JSON-encoded native metadata", () => {
    expect(readImageCharacterPrompts({ characters: [{ prompt: "cat", centerX: .3, centerY: .6 }] })[0].center).toEqual({ x: .3, y: .6 });
    expect(readImageCharacterPrompts({ ...metadata, v4_prompt: JSON.stringify(metadata.v4_prompt) })).toHaveLength(2);
  });
  it("recovers old missing roles without replacing existing role settings", () => {
    const restored = restoreImageCharacterPrompts({ prompt: "saved base" }, metadata);
    expect(readImageCharacterPrompts(restored)).toHaveLength(2);
    expect(restored.prompt).toBe("saved base");
    const explicit = { characterPrompts: [] };
    expect(restoreImageCharacterPrompts(explicit, metadata)).toBe(explicit);
    expect(hasImageCharacterPrompts(explicit)).toBe(true);
  });
  it("maps role text, negatives and coordinates for studio imports", () => {
    const imported = mapNaiParameters(metadata, []);
    expect(imported).toMatchObject({ prompt: "scene", negativePrompt: "lowres", useCoords: true });
    expect(imported.characterPrompts).toEqual(readImageCharacterPrompts(metadata));
    expect(mapNaiParameters({ prompt: "single subject" }, []).characterPrompts).toBeUndefined();
  });
});
