import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getChatToken: vi.fn(),
  runTagAgent: vi.fn(),
  outboundFetch: vi.fn(),
  readConversation: vi.fn(),
  appendConversationTurn: vi.fn(),
  chatFetch: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/newapi", () => ({ getChatToken: mocks.getChatToken, resolvedNewApiBaseUrl: async () => "https://gateway.test" }));
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
  mocks.getChatToken.mockResolvedValue("test-chat-token");
  mocks.readConversation.mockResolvedValue({ turns: [], tagPool: [] });
  mocks.appendConversationTurn.mockResolvedValue({ turns: [], tagPool: [] });
  mocks.runTagAgent.mockResolvedValue({ content: '{"prompt":"A cat beside a warm window.","negativePrompt":"","tags":[],"parameters":{}}', steps: [] });
  mocks.outboundFetch.mockResolvedValue(Response.json([{ name: "white_hair", category: 0, post_count: 100 }]));
  mocks.chatFetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "A cat by a window." } }] }));
});

describe("image model context in assistant routes", () => {
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
    ], tagPool: [] });
    const response = await route.POST(postRequest("tags", { model: "vision-chat", imageModel: "gemini-2.5-flash-image", operation: "inpainting", request: "make it blue" }));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.appendConversationTurn).toHaveBeenCalled());
    expect(mocks.runTagAgent.mock.calls[0][3]).toMatchObject({ imageModel: "gemini-2.5-flash-image", operation: "inpainting" });
    expect(mocks.runTagAgent.mock.calls[0][5].history).toEqual([{ request: "GPT scene", answer: "natural description" }]);
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
