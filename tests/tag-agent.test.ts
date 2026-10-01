import { beforeEach, describe, expect, it, vi } from "vitest";

const { runTool, summarizeToolResult } = vi.hoisted(() => ({
  runTool: vi.fn(async () => ({ ok: true, data: {} })),
  summarizeToolResult: vi.fn(() => "完成"),
}));

vi.mock("@/lib/agent-tools", () => ({
  runTool,
  summarizeToolResult,
  toolCatalog: () => "- search_danbooru_tags: 参数 {query: string}",
}));
vi.mock("@/lib/newapi", () => ({
  newApiBaseUrl: () => "http://newapi.test",
  resolvedNewApiBaseUrl: async () => "http://newapi.test",
}));

describe("runTagAgent budgets", () => {
  beforeEach(() => {
    runTool.mockClear();
    summarizeToolResult.mockClear();
  });

  it("stops tool calls at the configured round limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: '{"action":"search_danbooru_tags","args":{"query":"hair"}}',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: '{"tags":["white_hair"]}' } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");

    const result = await runTagAgent("key", "model", "request", {}, 1);

    expect(result.content).toBe('{"tags":["white_hair"]}');
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("executes a text-protocol tool action and returns the next model answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: '{"action":"search_danbooru_tags","args":{"query":"hair"}}',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"tags":["white_hair"]}',
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");

    const result = await runTagAgent("key", "model", "request", {});

    expect(result.content).toBe('{"tags":["white_hair"]}');
    expect(result.steps).toEqual([
      {
        tool: "search_danbooru_tags",
        query: "hair",
        ok: true,
        summary: "完成",
      },
    ]);
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it("injects conversation history before the current request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            message: {
              content: '{"tags":["white_hair","blue_dress"]}',
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");

    await runTagAgent("key", "model", "加上蓝色裙子", {}, 1, {
      history: [
        { request: "白发少女", answer: '{"tags":["white_hair"]}' },
        { request: "", answer: "" },
      ],
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("白发少女");
    expect(body.messages[2].content).toBe('{"tags":["white_hair"]}');
    expect(body.messages[3].content).toContain("加上蓝色裙子");
  });

  it("keeps multiple history turns in chronological order", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: '{"tags":[]}' } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");

    await runTagAgent("key", "model", "third", {}, 1, {
      history: [
        { request: "first", answer: "first answer" },
        { request: "second", answer: "second answer" },
      ],
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.map((message) => message.content)).toEqual([
      expect.stringContaining("NovelAI"),
      expect.stringContaining('"request":"first"'),
      "first answer",
      expect.stringContaining('"request":"second"'),
      "second answer",
      expect.stringContaining('"request":"third"'),
    ]);
  });

  it("sends at most four images as a multimodal current request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: '{"tags":[]}' } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");

    await runTagAgent("key", "model", "analyze", {}, 1, {
      images: [
        "data:image/png;base64,a",
        "data:image/png;base64,b",
        "data:image/png;base64,c",
        "data:image/png;base64,d",
        "data:image/png;base64,e",
      ],
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { messages: Array<{ content: string | Array<unknown> }> };
    expect(body.messages.at(-1)?.content).toHaveLength(5);
  });

  it("injects the selected image model while retaining the separate upstream chat model", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: '{"final":{"prompt":"A blue cup on a wooden table.","tags":[]}}' } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    await runTagAgent("key", "gpt-text-model", "make a product shot", { imageModel: "gpt-image-1.5", operation: "img2img" }, 1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { model: string; messages: Array<{ content: string }> };
    expect(body.model).toBe("gpt-text-model");
    expect(body.messages[0].content).toContain('"imageModel":"gpt-image-1.5"');
    expect(body.messages[0].content).toContain("连贯、清楚的自然语言");
    expect(body.messages.at(-1)?.content).toContain('"operation":"img2img"');
  });

  it("does not execute Danbooru tool actions for a natural-language image target", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"action":"verify_danbooru_tag","args":{"name":"not_a_tag"}}' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"final":{"prompt":"A cup.","tags":[]}}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    const result = await runTagAgent("key", "vision-model", "request", { imageModel: "gemini-2.5-flash-image" }, 1);
    expect(runTool).not.toHaveBeenCalled();
    expect(result.steps[0].ok).toBe(false);
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { messages: Array<{ content: string }> };
    expect(body.messages.at(-1)?.content).toContain("自然语言提示词");
  });

  it("does not start upstream work after the caller cancels", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const { runTagAgent } = await import("@/lib/tag-agent");
    await expect(runTagAgent("key", "vision-chat", "request", { imageModel: "gpt-image-1" }, 1, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
