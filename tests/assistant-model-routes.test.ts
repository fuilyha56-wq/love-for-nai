import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getChatToken: vi.fn(),
  refreshChatToken: vi.fn(),
  runTagAgent: vi.fn(),
  outboundFetch: vi.fn(),
  readConversation: vi.fn(),
  appendConversationTurn: vi.fn(),
  chatFetch: vi.fn(),
  availableModels: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/provider/newapi-models", async (original) => ({ ...await original<typeof import("@/lib/provider/newapi-models")>(), loadNewApiModels: mocks.availableModels }));
vi.mock("@/lib/tag-catalog", () => ({ readCatalogTag: () => null }));
vi.mock("@/lib/newapi", () => ({ getChatToken: mocks.getChatToken, refreshChatToken: mocks.refreshChatToken, resolvedNewApiBaseUrl: async () => "https://gateway.test", userHeaders: () => ({ Authorization: "Bearer session-token" }) }));
vi.mock("@/lib/tag-agent", () => ({ runTagAgent: mocks.runTagAgent }));
vi.mock("@/lib/outbound", () => ({ outboundFetch: mocks.outboundFetch }));
vi.mock("@/lib/model-concurrency", () => ({ fetchWithModelConcurrency: mocks.chatFetch }));
vi.mock("@/lib/history", () => ({ findHistory: vi.fn(), historyImagePath: vi.fn() }));
vi.mock("@/lib/remote-history", () => ({ getRemoteHistoryImage: vi.fn() }));
vi.mock("@/lib/assistant-conversations", () => ({
  readConversation: mocks.readConversation,
  appendConversationTurn: mocks.appendConversationTurn,
  clearConversation: vi.fn(),
  MODEL_HISTORY_TURNS: 8,
  updateConversationUsage: vi.fn(),
}));

function postRequest(route: string, body: Record<string, unknown>) {
  return new Request(`http://localhost/api/assistant/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ userId: 12345 });
  mocks.availableModels.mockResolvedValue([{ id: "text-chat", kind: "助手模型" }, { id: "vision-chat", kind: "助手模型" }]);
  mocks.getChatToken.mockResolvedValue("test-chat-token");
  mocks.readConversation.mockResolvedValue({ turns: [], tagPool: [] });
  mocks.appendConversationTurn.mockResolvedValue({ turns: [], tagPool: [] });
  mocks.runTagAgent.mockResolvedValue({ content: '{"prompt":"A cat beside a warm window.","negativePrompt":"","tags":[],"parameters":{}}', steps: [] });
  mocks.outboundFetch.mockResolvedValue(Response.json([{ name: "white_hair", category: 0, post_count: 100 }]));
  mocks.chatFetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "A cat by a window." } }] }));
});

afterEach(() => vi.unstubAllGlobals());

describe("image model context in assistant routes", () => {
  it("accepts custom full-access limits beyond five and rejects out-of-range values before credential lookup", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    for (const goalMaxRounds of [0, 101, 2.5, "10"]) {
      expect((await route.POST(postRequest("tags", { model: "vision-chat", request: "plan", goalMode: true, goal: "blue sky", goalMaxRounds }))).status).toBe(400);
    }
    expect(mocks.getChatToken).not.toHaveBeenCalled();
    const response = await route.POST(postRequest("tags", { model: "vision-chat", request: "review", goalMode: true, accessMode: "full", goal: "blue sky", goalIteration: 10, goalMaxRounds: 10 }));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.runTagAgent).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][3]).toMatchObject({ goalIteration: 10, goalMaxRounds: 10 });
    expect((await route.POST(postRequest("tags", { model: "vision-chat", request: "review", accessMode: "full", goalIteration: 11, goalMaxRounds: 10 }))).status).toBe(400);
  });
  it("accepts ten references, rejects eleven and validates prompt context types", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    const images = Array(10).fill("data:image/png;base64,YWJj");
    expect((await route.POST(postRequest("tags", { model: "vision-chat", imageModel: "gpt-image-1", request: "reference test", images }))).status).toBe(200);
    await vi.waitFor(() => expect(mocks.runTagAgent).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][5].images).toEqual(images);
    mocks.getChatToken.mockClear();
    expect((await route.POST(postRequest("tags", { model: "vision-chat", request: "test", images: [...images, images[0]] }))).status).toBe(400);
    expect((await route.POST(postRequest("tags", { model: "vision-chat", request: "test", currentPrompt: { invalid: true } }))).status).toBe(400);
    expect(mocks.getChatToken).not.toHaveBeenCalled();
  });
  it("accepts 10000-character requests and goals intact and rejects 10001 before key lookup", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    const input = "字".repeat(10_000);
    const response = await route.POST(postRequest("tags", { model: "vision-chat", imageModel: "gpt-image-1", request: input, goalMode: true, goal: input }));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.runTagAgent).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][2]).toBe(input);
    expect(mocks.runTagAgent.mock.calls[0][3].goal).toBe(input);
    mocks.getChatToken.mockClear();
    for (const body of [{ request: input + "字" }, { request: "goal", goalMode: true, goal: input + "字" }]) {
      const rejected = await route.POST(postRequest("tags", { model: "vision-chat", ...body }));
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).message).toContain("10000");
    }
    expect(mocks.getChatToken).not.toHaveBeenCalled();
  });
  it("filters every known image family from assistant text models", async () => {
    mocks.availableModels.mockImplementationOnce((await vi.importActual<typeof import("@/lib/provider/newapi-models")>("@/lib/provider/newapi-models")).loadNewApiModels);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [
      { id: "gpt-image-1" }, { id: "nano-banana-pro" }, { id: "gemini-3-pro-image-preview" },
      { id: "nai-v5-full" }, { id: "text-chat" }, { id: "gpt-4o" },
    ] })));
    const route = await import("@/app/api/assistant/models/route");
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["gpt-4o", "text-chat"] });
  });

  it("refreshes the upstream list and excludes custom image channels", async () => {
    mocks.availableModels.mockResolvedValueOnce([{ id: "old-chat", kind: "助手模型" }, { id: "custom-draw", kind: "图像模型" }, { id: "text-embedding-3", kind: "助手模型" }])
      .mockResolvedValueOnce([{ id: "new-chat", kind: "助手模型" }]);
    const route = await import("@/app/api/assistant/models/route");
    const first = await route.GET();
    expect(await first.json()).toEqual({ models: ["old-chat"] });
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(await (await route.GET()).json()).toEqual({ models: ["new-chat"] });
  });

  it("rejects a custom image channel before requesting a chat credential", async () => {
    mocks.availableModels.mockResolvedValueOnce([{ id: "custom-draw", kind: "图像模型" }]);
    const route = await import("@/app/api/assistant/tags/route");
    expect((await route.POST(postRequest("tags", { model: "custom-draw", request: "white hair" }))).status).toBe(400);
    expect(mocks.getChatToken).not.toHaveBeenCalled();
  });

  it("does not validate or reject natural-language text as Danbooru tags", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    mocks.runTagAgent.mockResolvedValue({ content: JSON.stringify({ prompt: "A red cup on the table.", negativePrompt: "watermark", tags: ["never_a_danbooru_tag"], parameters: { steps: 50, scale: 9, seed: 1234, width: 832, height: 1216 } }), steps: [] });
    const response = await route.POST(postRequest("tags", { model: "vision-chat", imageModel: "gpt-image-1.5", request: "红杯子" }));
    expect(response.status).toBe(200);
    const { jobId } = await response.json();
    let result: { status: string; suggestion: { prompt: string; negativePrompt: string; tags: unknown[]; parameters: Record<string, unknown>; imageModel: string }; rejectedTags: string[] } | undefined;
    await vi.waitFor(async () => {
      result = await (await route.GET(new Request(`http://localhost/api/assistant/tags?job=${jobId}`))).json();
      expect(result?.status).toBe("done");
    });
    expect(result?.suggestion.prompt).toContain("Avoid: watermark");
    expect(result?.suggestion.negativePrompt).toBe("");
    expect(result?.suggestion.tags).toEqual([]);
    expect(result?.rejectedTags).toEqual([]);
    expect(result?.suggestion.parameters).toEqual({ width: 1024, height: 1536 });
    expect(result?.suggestion.imageModel).toBe("gpt-image-1.5");
    expect(mocks.outboundFetch).not.toHaveBeenCalled();
    expect(mocks.getChatToken).toHaveBeenCalledWith({ userId: 12345 }, "vision-chat");
  });

  it("keeps NAI verification and adds missing validated tags to the main prompt", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    mocks.runTagAgent.mockResolvedValue({ content: '{"prompt":"1girl","negativePrompt":"blur","tags":["white_hair"],"parameters":{"scale":5}}', steps: [] });
    const response = await route.POST(postRequest("tags", { model: "vision-chat", request: "白发少女" }));
    const { jobId } = await response.json();
    await vi.waitFor(() => expect(mocks.appendConversationTurn).toHaveBeenCalled());
    const result = await (await route.GET(new Request(`http://localhost/api/assistant/tags?job=${jobId}`))).json();
    expect(result.suggestion.prompt).toBe("1girl, white_hair");
    expect(result.suggestion.negativePrompt).toBe("blur");
    expect(result.suggestion.parameters).toEqual({ scale: 5 });
    expect(mocks.outboundFetch).toHaveBeenCalledTimes(1);
  });

  it("only injects compatible conversation history and persists sanitized suggestions", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    mocks.readConversation.mockResolvedValue({ turns: [
      { request: "old NAI", answer: "old tags" },
      { request: "GPT scene", answer: "natural description", imageModel: "gpt-image-1" },
      { request: "old Gemini", answer: "natural description", imageModel: "gemini-2.5-flash-image" },
    ], tagPool: [] });
    const response = await route.POST(postRequest("tags", { model: "vision-chat", imageModel: "gemini-2.5-flash-image", operation: "inpainting", request: "make it blue" }));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.appendConversationTurn).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][3]).toMatchObject({ imageModel: "gemini-2.5-flash-image", operation: "inpainting" });
    expect(mocks.runTagAgent.mock.calls[0][5].history).toEqual([{ request: "old Gemini", answer: "natural description" }]);
    expect(mocks.appendConversationTurn.mock.calls[0][1]).toMatchObject({ imageModel: "gemini-2.5-flash-image", tags: [], parameters: {} });
  });

  it("passes local ONNX candidate tags as evidence without treating them as verified output", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    const response = await route.POST(postRequest("tags", { model: "vision-chat", imageModel: "gpt-image-1", request: "describe the picture", localTags: ["cat", "window"] }));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.runTagAgent).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][3].localTags).toEqual(["cat", "window"]);
    expect(mocks.outboundFetch).not.toHaveBeenCalled();
    expect((await route.POST(postRequest("tags", { model: "vision-chat", request: "describe", localTags: "cat" }))).status).toBe(400);
  });

  it("isolates each goal run from old goals and ordinary conversations", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    mocks.readConversation.mockResolvedValue({ turns: [
      { request: "ordinary request", answer: "ordinary answer" },
      { request: "old goal", answer: "old answer", goalMode: true, goalRunId: "previous" },
      { request: "current goal planning", answer: "current answer", goalMode: true, goalRunId: "current" },
    ], tagPool: [] });
    await route.POST(postRequest("tags", { model: "vision-chat", request: "evaluate this result", goalMode: true, goal: "blue sky", goalRunId: "current", goalIteration: 1 }));
    await vi.waitFor(() => expect(mocks.appendConversationTurn).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][5].history).toEqual([{ request: "current goal planning", answer: "current answer" }]);
    expect(mocks.appendConversationTurn.mock.calls[0][1]).toMatchObject({ goalMode: true, goalRunId: "current" });

    mocks.runTagAgent.mockClear();
    await route.POST(postRequest("tags", { model: "vision-chat", request: "new goal planning", goalMode: true, goal: "blue sky", goalRunId: "brand-new" }));
    await vi.waitFor(() => expect(mocks.runTagAgent).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][5].history).toEqual([]);

    mocks.runTagAgent.mockClear();
    await route.POST(postRequest("tags", { model: "vision-chat", request: "ordinary request" }));
    await vi.waitFor(() => expect(mocks.runTagAgent).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][5].history).toEqual([{ request: "ordinary request", answer: "ordinary answer" }]);
  });

  it("returns a structured upstream block and never saves or applies a suggestion", async () => {
    const { AssistantModelBlockedError } = await import("@/lib/assistant-model-error");
    mocks.runTagAgent.mockRejectedValueOnce(new AssistantModelBlockedError("PROHIBITED_CONTENT"));
    const route = await import("@/app/api/assistant/tags/route");
    const response = await route.POST(postRequest("tags", { model: "vision-chat", request: "plan", goalMode: true, goal: "blue sky", goalRunId: "blocked-goal" }));
    const { jobId } = await response.json();
    let result: Record<string, unknown> = {};
    await vi.waitFor(async () => {
      result = await (await route.GET(new Request(`http://localhost/api/assistant/tags?job=${jobId}`))).json();
      expect(result.status).toBe("error");
    });
    expect(result).toMatchObject({ error: { code: "UPSTREAM_CONTENT_BLOCKED", reason: "PROHIBITED_CONTENT", retryable: false }, message: expect.stringContaining("任务已暂停") });
    expect(result.suggestion).toBeUndefined();
    expect(mocks.appendConversationTurn).not.toHaveBeenCalled();
    expect(mocks.outboundFetch).not.toHaveBeenCalled();
  });

  it.each(["gpt-image-1", "gemini-2.5-flash-image", "nano-banana", "nai-v5-full"])("rejects image model %s as the assistant's text LLM", async (model) => {
    const route = await import("@/app/api/assistant/tags/route");
    expect((await route.POST(postRequest("tags", { model, request: "hello" }))).status).toBe(400);
    expect(mocks.getChatToken).not.toHaveBeenCalled();
  });

  it("retains user authentication and job ownership", async () => {
    const route = await import("@/app/api/assistant/tags/route");
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await route.POST(postRequest("tags", { model: "text-chat", request: "hello" }))).status).toBe(401);
    const response = await route.POST(postRequest("tags", { model: "text-chat", request: "hello" }));
    const { jobId } = await response.json();
    mocks.getSession.mockResolvedValueOnce({ userId: 999 });
    expect((await route.GET(new Request(`http://localhost/api/assistant/tags?job=${jobId}`))).status).toBe(404);
  });

  it("injects natural model and edit context in inline chat while using its configured text model", async () => {
    const route = await import("@/app/api/assistant/inline-chat/route");
    const response = await route.POST(postRequest("inline-chat", { model: "text-chat", imageModel: "gpt-image-1", operation: "img2img", mode: "polish", selection: "change the wall to blue" }));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.chatFetch).toHaveBeenCalled());
    const body = JSON.parse(mocks.chatFetch.mock.calls[0][1].body);
    expect(body.model).toBe("text-chat");
    expect(body.messages[0].content).toContain('"imageModel":"gpt-image-1"');
    expect(body.messages[0].content).toContain("采用自然语言");
    expect(body.messages[0].content).toContain("只输出润色后的完整结果");
    expect(mocks.chatFetch.mock.calls[0][0]).toBe("https://gateway.test/v1/chat/completions");
  });

  it("rejects invalid target protocols before starting upstream work", async () => {
    const route = await import("@/app/api/assistant/inline-chat/route");
    expect((await route.POST(postRequest("inline-chat", { model: "text-chat", modelProtocol: "unknown", mode: "fix", selection: "text" }))).status).toBe(400);
    expect(mocks.chatFetch).not.toHaveBeenCalled();
  });
});
