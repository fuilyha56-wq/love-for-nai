import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedAssistantHistory } from "@/lib/assistant-limits";

vi.mock("@/lib/agent-tools", () => ({
  runTool: vi.fn(async () => ({ ok: true, data: { text: "x".repeat(80_000) } })),
  summarizeToolResult: () => "完成", toolCatalog: () => "search_danbooru_tags",
}));
vi.mock("@/lib/newapi", () => ({ resolvedNewApiBaseUrl: async () => "https://fixture.invalid" }));
afterEach(() => vi.unstubAllGlobals());
const call = { id: "call_fixture", type: "function", function: { name: "search_danbooru_tags", arguments: '{"query":"cloud"}' }, extra_content: { google: { thought_signature: "fixture-signature" } } };

describe("assistant context compatibility", () => {
  it("reports each tool round's usage, including a final filtered response", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { tool_calls: [call] } }] }, { headers: { "x-oneapi-request-id": "req-first" } }))
      .mockResolvedValueOnce(Response.json({ usage: { prompt_tokens: 160, completion_tokens: 10 }, choices: [{ finish_reason: "content_filter", message: { content: "" } }] }, { headers: { "x-oneapi-request-id": "req-second" } }));
    vi.stubGlobal("fetch", fetcher);
    const onUsage = vi.fn();
    const { runTagAgent } = await import("@/lib/tag-agent");
    await expect(runTagAgent("fixture", "model", "cloud", { goalMode: true, goalMaxRounds: 12 }, 2, { onUsage })).rejects.toThrow("拒绝");
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage.mock.calls[1][0]).toMatchObject({ inputTokens: 160, outputTokens: 10, requestId: "req-second" });
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(JSON.parse(request.messages.at(-1).content).goalMaxRounds).toBe(12);
  });
  it("bounds complete history turns without reversing or slicing JSON", () => {
    const history = [0, 1, 2, 3].map(index => ({ request: String(index).repeat(4000), answer: "a".repeat(6000) }));
    expect(boundedAssistantHistory(history)).toEqual(history.slice(-2));
  });
  it("replays provider tool signatures and reasoning fields intact, and bounds large tool results", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: {
      content: null, reasoning_content: "fixture reasoning", reasoning_details: [{ type: "reasoning.encrypted", data: "fixture" }],
      extra_content: { provider: "fixture" }, tool_calls: [call],
    } }] })).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: [{ type: "text", text: '{"tags":[]}' }] } }] }));
    vi.stubGlobal("fetch", fetcher);
    const { runTagAgent } = await import("@/lib/tag-agent");
    await expect(runTagAgent("fixture", "model", "cloud", {}, 2)).resolves.toMatchObject({ content: '{"tags":[]}' });
    const messages = JSON.parse(fetcher.mock.calls[1][1].body).messages;
    expect(messages.at(-2)).toMatchObject({ reasoning_content: "fixture reasoning", reasoning_details: [{ type: "reasoning.encrypted", data: "fixture" }], extra_content: { provider: "fixture" }, tool_calls: [call] });
    expect(messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: call.id, name: call.function.name });
    expect(JSON.parse(messages.at(-1).content).result.truncated).toBe(true);
    expect(messages.at(-1).content.length).toBeLessThan(17_000);
  });
  it("removes only an explicitly unsupported parallel flag while retaining tools", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "Unsupported parameter: parallel_tool_calls" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"tags":[]}' } }] }));
    vi.stubGlobal("fetch", fetcher);
    const { runTagAgent } = await import("@/lib/tag-agent");
    await runTagAgent("fixture", "model", "cloud", {}, 1);
    const next = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(next.tools.length).toBeGreaterThan(0);
    expect(next.parallel_tool_calls).toBeUndefined();
  });
  it.each([
    [{ error: { message: "prompt broken: missing thought_signature" } }, 400, "消息格式"],
    [{ error: { message: "maximum context length exceeded" } }, 400, "上下文容量"],
    [{ choices: [{ finish_reason: "length", message: { content: '{"tags":[' } }] }, 200, "结果不完整"],
    [{ choices: [{ finish_reason: "content_filter", message: { content: "" } }] }, 200, "拒绝"],
  ])("stops once on malformed context, truncation or actual provider filtering", async (body, status, message) => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(body, { status }));
    vi.stubGlobal("fetch", fetcher);
    const { runTagAgent } = await import("@/lib/tag-agent");
    await expect(runTagAgent("fixture", "model", "cloud", {}, 1)).rejects.toThrow(message);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
