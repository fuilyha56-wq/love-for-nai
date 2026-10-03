import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addProvider } from "@/lib/provider/store";
import { applyStoryGeneration, generateStoryText, withStoryGenerationSlot } from "@/lib/story-generation";

vi.mock("@/lib/story-provider-network", () => ({
  validateStoryProviderUrl: vi.fn(async (value: string) => value),
}));

let dataDir: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
  delete process.env.LFN_DATA_DIR;
  delete process.env.LFN_PROVIDER_ENCRYPTION_KEY;
});

describe("故事生成", () => {
  it("按三段式模型 ID 调用统一文本 provider，并保留旧单段式解析", async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "lfn-story-generation-"));
    process.env.LFN_DATA_DIR = dataDir;
    process.env.LFN_PROVIDER_ENCRYPTION_KEY = "test-provider-key-longer-than-thirty-two-bytes";
    const provider = await addProvider(88001, {
      name: "Story API", baseUrl: "https://text.example.com", apiKey: "story-secret",
      models: [], modelEntries: [{ id: "writer-v2", capabilities: "text" }], capability: "text",
    });
    const fetchMock = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: "生成内容" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const session = { userId: 88001, username: "writer", displayName: "Writer", upstreamCookie: "", expiresAt: Date.now() + 60_000 };
    const story = {
      id: "story", title: "故事", model: `custom:${provider.id}:writer-v2`, genre: "", synopsis: "", lorebook: "",
      specializedPrompt: false, activeBranchId: "branch", branches: [], createdAt: "now", updatedAt: "now",
    };
    const branch = { id: "branch", parentId: null, name: "主线", content: "开头", createdAt: "now", updatedAt: "now" };
    const result = await generateStoryText(session, story, branch, {
      mode: "continue", instruction: "", content: "开头", selectionStart: 2, selectionEnd: 2,
    });
    expect(result).toBe("生成内容");
    expect(fetchMock).toHaveBeenCalledWith("https://text.example.com/v1/chat/completions", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer story-secret" }),
      body: expect.stringContaining('"model":"writer-v2"'),
    }));
  });

  it("按续写、改写和插入模式合并正文", () => {
    const base = { instruction: "", selectionStart: 1, selectionEnd: 3 };
    expect(applyStoryGeneration({ ...base, mode: "continue", content: "开头" }, "后续")).toBe("开头\n\n后续");
    expect(applyStoryGeneration({ ...base, mode: "rewrite", content: "ABCDE" }, "新段")).toBe("A新段DE");
    expect(applyStoryGeneration({ ...base, mode: "insert", content: "ABCDE" }, "插入")).toBe("A插入BCDE");
  });

  it("全局最多同时执行两个生成任务", async () => {
    let active = 0;
    let peak = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const tasks = Array.from({ length: 3 }, (_, index) =>
      withStoryGenerationSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        if (index < 2) await gate;
        active -= 1;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(2);
    releaseFirst();
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });
});