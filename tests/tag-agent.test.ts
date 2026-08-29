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
        // 空轮次应被跳过。
        { request: "", answer: "" },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    // system → 历史 user/assistant 对（空轮次跳过）→ 本轮 user。
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("白发少女");
    expect(body.messages[2].role).toBe("assistant");
    expect(body.messages[2].content).toBe('{"tags":["white_hair"]}');
    expect(body.messages[3].role).toBe("user");
    expect(body.messages[3].content).toContain("加上蓝色裙子");
  });
});
