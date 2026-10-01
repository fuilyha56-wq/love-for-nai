import { beforeEach, describe, expect, it, vi } from "vitest";
const { runTagAgent } = vi.hoisted(() => ({ runTagAgent: vi.fn() }));
vi.mock("@/lib/tag-agent", () => ({ runTagAgent }));
import { runImagePromptSuggestion } from "@/lib/image-prompt-suggestion";

beforeEach(() => {
  runTagAgent.mockReset();
  runTagAgent.mockResolvedValue({ content: '{"prompt":"A warm portrait of a cat by a window.","englishDescription":"A cat rests by a window.","tags":["some phrase"],"parameters":{"seed":1234,"scale":8}}', steps: [] });
});

describe("natural image prompt suggestion", () => {
  it("returns complete natural text instead of a tag list and keeps separate chat authorization", async () => {
    const result = await runImagePromptSuggestion({ key: "chat-key", chatModel: "vision-chat", baseUrl: "https://text-gateway.test", imageModel: "gpt-image-1", prompt: "cat by a window" });
    expect(result.prompt).toContain("A warm portrait");
    expect(result.text).toBe(result.prompt);
    expect(result.description).toBe("A cat rests by a window.");
    expect(result.tags).toEqual([]);
    expect(result.parameters).toEqual({});
    expect(runTagAgent.mock.calls[0][0]).toBe("chat-key");
    expect(runTagAgent.mock.calls[0][1]).toBe("vision-chat");
    expect(runTagAgent.mock.calls[0][3]).toMatchObject({ imageModel: "gpt-image-1", currentPrompt: "cat by a window" });
    expect(runTagAgent.mock.calls[0][5].baseUrl).toBe("https://text-gateway.test");
  });

  it("supports a picture-only description and forwards request cancellation", async () => {
    const controller = new AbortController();
    const image = "data:image/png;base64,YQ==";
    await runImagePromptSuggestion({ key: "chat-key", chatModel: "vision-chat", imageModel: "gemini-2.5-flash-image", prompt: "", images: [image], signal: controller.signal });
    expect(runTagAgent.mock.calls[0][2]).toContain("参考图片");
    expect(runTagAgent.mock.calls[0][5]).toMatchObject({ images: [image], signal: controller.signal });
  });

  it("requires an explicit usable text model and rejects invalid image input", async () => {
    const base = { key: "key", chatModel: "vision-chat", imageModel: "gpt-image-1", prompt: "cat" };
    await expect(runImagePromptSuggestion({ ...base, chatModel: "gpt-image-1" })).rejects.toThrow("助手模型");
    await expect(runImagePromptSuggestion({ ...base, prompt: "" })).rejects.toThrow("提示词");
    await expect(runImagePromptSuggestion({ ...base, images: ["https://untrusted-image.test/file.png"] })).rejects.toThrow("参考图片");
    await expect(runImagePromptSuggestion({ ...base, imageModel: "nai-v5-full" })).rejects.toThrow("自然语言");
    expect(runTagAgent).not.toHaveBeenCalled();
  });

  it("does not mark an empty assistant response as a usable suggestion", async () => {
    runTagAgent.mockResolvedValue({ content: '{"prompt":"","tags":[]}' });
    await expect(runImagePromptSuggestion({ key: "key", chatModel: "vision-chat", imageModel: "gpt-image-1", prompt: "cat" })).rejects.toThrow("未返回可使用的提示词");
  });
});
