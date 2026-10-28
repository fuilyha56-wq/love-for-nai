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

  it("recovers when a tag-mode model claims database tools are unavailable", async () => {
    runTool
      .mockResolvedValueOnce({
        ok: true,
        data: {
          queries: [{
            query: "fox mask",
            tags: [{ catalogKey: "danbooru:fox_mask", name: "fox_mask", source: "danbooru" }],
          }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { tags: [{ catalogKey: "danbooru:fox_mask", name: "fox_mask", description: "A fox mask." }], missing: [] },
      });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: '{"final":{"message":"当前工具不可用","prompt":"","negativePrompt":"","tags":[],"parameters":{}}}' } }],
      }))
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: '{"final":{"message":"fox_mask 为狐狸面具。","prompt":"fox_mask","negativePrompt":"","tags":["fox_mask"],"parameters":{}}}' } }],
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");

    const result = await runTagAgent("key", "model", '查数据库里的 "fox mask" 并解释来源', {}, 3);

    expect(result.content).toContain("fox_mask");
    expect(result.steps.map((step) => step.tool)).toEqual(["search_tag_catalog", "read_tag_catalog"]);
    expect(runTool).toHaveBeenCalledTimes(2);
    const recoveryBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    expect(recoveryBody.messages.at(-1)?.content).toContain("A fox mask.");
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

  it("sends all ten images as a multimodal current request and rejects eleven", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: '{"tags":[]}' } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");

    await runTagAgent("key", "model", "analyze", {}, 1, {
      images: Array.from({ length: 10 }, (_, index) => `data:image/png;base64,${index}`),
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { messages: Array<{ content: string | Array<unknown> }> };
    expect(body.messages.at(-1)?.content).toHaveLength(11);
    await expect(runTagAgent("key", "model", "analyze", {}, 1, { images: Array(11).fill("image") })).rejects.toThrow("10");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("allows research tools for natural-language targets while retaining natural-language output", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"action":"verify_danbooru_tag","args":{"name":"not_a_tag"}}' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"final":{"prompt":"A cup.","tags":[]}}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    const result = await runTagAgent("key", "vision-model", "request", { imageModel: "gemini-2.5-flash-image" }, 1);
    expect(runTool).toHaveBeenCalledWith("verify_danbooru_tag", { name: "not_a_tag" });
    expect(result.steps[0].ok).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { messages: Array<{ content: string }> };
    expect(body.messages.at(-1)?.content).toContain("自然语言提示词");
  });

  it.each([
    { status: 400, body: { error: { message: "request blocked by Gemini API: PROHIBITED_CONTENT" } }, reason: "PROHIBITED_CONTENT" },
    { status: 200, body: { choices: [{ finish_reason: "content_filter", message: { content: "" } }] }, reason: "CONTENT_FILTER" },
    { status: 200, body: { choices: [{ message: { refusal: "Cannot help", content: "" } }] }, reason: "MODEL_REFUSAL" },
    { status: 200, body: { promptFeedback: { blockReason: "SAFETY" } }, reason: "SAFETY" },
    { status: 200, body: { candidates: [{ finishReason: "PROHIBITED_CONTENT" }] }, reason: "PROHIBITED_CONTENT" },
  ])("pauses on an upstream block without retrying or changing models ($reason)", async ({ status, body, reason }) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    await expect(runTagAgent("key", "gemini-chat", "request", {})).rejects.toMatchObject({
      info: { code: "UPSTREAM_CONTENT_BLOCKED", reason, retryable: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runTool).not.toHaveBeenCalled();
  });

  it("lets the model choose live QuickTagCloud directly and stops if the next response is blocked", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"action":"list_quicktagcloud_codexes","args":{}}' } }] }))
      .mockResolvedValueOnce(Response.json({ error: { message: "request blocked by Gemini API: PROHIBITED_CONTENT" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    const onStep = vi.fn();
    await expect(runTagAgent("key", "gemini-chat", "请在线查询 QuickTagCloud 构图", {}, 6, { onStep })).rejects.toThrow("任务已暂停");
    expect(runTool).toHaveBeenCalledExactlyOnceWith("list_quicktagcloud_codexes", {});
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("无须先查询本地");
  });

  it("reserves attention for full QuickTagCloud reads instead of accepting a candidate-only answer", async () => {
    runTool.mockResolvedValueOnce({ ok: true, data: { codexId: "composition", entries: [{ entryId: "soft", title: "Soft lighting" }] } })
      .mockResolvedValueOnce({ ok: true, data: { found: true, entry: { tags: "soft lighting", note: "Diffused illumination." } } });
    const reply = (content: string) => Response.json({ choices: [{ message: { content } }] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply('{"action":"search_quicktagcloud_tags","args":{"codexId":"composition","query":"soft lighting"}}'))
      .mockResolvedValueOnce(reply('{"final":{"prompt":"soft lighting","message":"Read the complete entry."}}'))
      .mockResolvedValueOnce(reply('{"action":"read_quicktagcloud_entry","args":{"codexId":"composition","entryId":"soft"}}'))
      .mockResolvedValueOnce(reply('{"final":{"prompt":"soft lighting","message":"Diffused illumination."}}'));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    const result = await runTagAgent("key", "chat", "read online QuickTagCloud", {}, 6);
    expect(result.content).toContain("Diffused illumination");
    expect(runTool).toHaveBeenNthCalledWith(2, "read_quicktagcloud_entry", { codexId: "composition", entryId: "soft" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1)).toMatchObject({ content: expect.stringContaining('"remainingToolCalls":5') });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).messages.at(-1)).toMatchObject({ content: expect.stringContaining("尚未读取任何完整词条") });
  });

  it("pauses if the budget cannot cover a full QuickTagCloud read", async () => {
    runTool.mockResolvedValueOnce({ ok: true, data: { codexId: "composition", entries: [{ entryId: "soft", title: "Soft lighting" }] } });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"action":"search_quicktagcloud_tags","args":{"codexId":"composition","query":"soft lighting"}}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    await expect(runTagAgent("key", "chat", "read QuickTagCloud", {}, 1)).rejects.toThrow("尚未读取完整词条");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it("executes native calls with matching IDs and names and requires actual research", async () => {
    runTool.mockResolvedValueOnce({ ok: true, data: { found: true, body: "A mass of condensed water in the atmosphere." } });
    const call = { id: "call_wiki_1", type: "function", function: { name: "read_danbooru_wiki", arguments: '{"title":"cloud"}' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [call] } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"final":{"message":"云的在线定义。","tags":[]}}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    const result = await runTagAgent("key", "chat", "请在线查询 cloud 的 wiki", {});
    expect(runTool).toHaveBeenCalledExactlyOnceWith("read_danbooru_wiki", { title: "cloud" });
    expect(result.steps).toHaveLength(1);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first.tool_choice).toBe("required");
    expect(first.tools.some((tool: { function: { name: string } }) => tool.function.name === "read_quicktagcloud_entry")).toBe(true);
    const next = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(next.messages.at(-2)).toMatchObject({ role: "assistant", tool_calls: [call] });
    expect(next.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_wiki_1", name: "read_danbooru_wiki", content: expect.stringContaining("condensed water") });
  });

  it("does not accept a second fabricated research answer without executing tools", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ choices: [{ message: { content: '{"final":{"message":"我已查询在线来源。","tags":[]}}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    await expect(runTagAgent("key", "chat", "在线查询 Danbooru 的 cloud 标签", {})).rejects.toThrow("未执行本轮要求的检索工具");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runTool).not.toHaveBeenCalled();
  });

  it("falls back once only when the upstream explicitly lacks native tool support", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "Unsupported parameter: tools" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"action":"read_danbooru_wiki","args":{"title":"cloud"}}' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"final":{"message":"云。","tags":[]}}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { runTagAgent } = await import("@/lib/tag-agent");
    const result = await runTagAgent("key", "legacy-chat", "查询 cloud 的 wiki", {});
    expect(result.steps).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tools).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tools).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).tools).toBeUndefined();
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
