import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMAGE_STUDIO_FORM,
  IMAGE_STUDIO_FORM_STORAGE_KEY,
  clearEditorPromptHandoff,
  loadEditorPromptHandoff,
  parseImageStudioForm,
  syncEditorPromptToStudioForm,
} from "@/lib/image-studio-form";

afterEach(() => vi.unstubAllGlobals());

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("ImageStudio 表单缓存", () => {
  it("非法字段逐项回退并对尺寸、数量做边界修复", () => {
    const parsed = parseImageStudioForm({
      version: 1,
      operation: "not-real",
      width: 835,
      height: 1900,
      count: 99,
      steps: 0,
      characters: [{ prompt: "x", centerX: 4, centerY: -1 }],
      source: "should-not-be-cached",
    });
    expect(parsed.operation).toBe(DEFAULT_IMAGE_STUDIO_FORM.operation);
    expect(parsed.width).toBe(832);
    expect(parsed.height).toBe(1600);
    expect(parsed.count).toBe(30);
    expect(parsed.steps).toBe(1);
    expect(parsed.characters[0]).toMatchObject({ centerX: 1, centerY: 0 });
    expect(parsed).not.toHaveProperty("source");
  });

  it("旧版本或非法数据回到完整默认值", () => {
    expect(parseImageStudioForm({ version: 2 }).model).toBe(DEFAULT_IMAGE_STUDIO_FORM.model);
    expect(parseImageStudioForm(null)).toEqual(DEFAULT_IMAGE_STUDIO_FORM);
  });

  it("编辑器提示词会原子同步到 handoff 和主工作台缓存", () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    vi.stubGlobal("window", { localStorage, sessionStorage });

    const handoff = syncEditorPromptToStudioForm(
      "editor-sync-test",
      "new prompt, 1girl",
      "new negative, lowres",
    );
    expect(handoff).toMatchObject({
      draftId: "editor-sync-test",
      prompt: "new prompt, 1girl",
      negative: "new negative, lowres",
    });
    expect(loadEditorPromptHandoff("editor-sync-test")).toMatchObject({
      prompt: "new prompt, 1girl",
      negative: "new negative, lowres",
    });
    expect(JSON.parse(localStorage.getItem(IMAGE_STUDIO_FORM_STORAGE_KEY) || "{}"))
      .toMatchObject({ prompt: "new prompt, 1girl", negative: "new negative, lowres" });

    clearEditorPromptHandoff();
    expect(loadEditorPromptHandoff("editor-sync-test")).toBeNull();
  });

  it("保留 vibe 参数与角色文本，但不包含图片数据", () => {
    const parsed = parseImageStudioForm({
      version: 1,
      vibeStrength: 0.35,
      vibeInformationExtracted: 0.8,
      characters: [{ prompt: "white hair", centerX: 0.2, centerY: 0.7 }],
      image: "data:image/png;base64,secret",
    });
    expect(parsed.vibeStrength).toBe(0.35);
    expect(parsed.vibeInformationExtracted).toBe(0.8);
    expect(parsed.characters[0].prompt).toBe("white hair");
    expect(parsed).not.toHaveProperty("image");
  });
});
