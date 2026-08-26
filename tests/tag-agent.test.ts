import { beforeEach, describe, expect, it, vi } from "vitest";

const { runTool } = vi.hoisted(() => ({
  runTool: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/agent-tools", () => ({
  runTool,
  toolSchemas: [],
}));
vi.mock("@/lib/newapi", () => ({
  newApiBaseUrl: () => "http://newapi.test",
}));

describe("runTagAgent budgets", () => {
  beforeEach(() => {
    runTool.mockClear();
  });

  it("rejects a model response with too many tool calls in one round", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: Array.from({ length: 9 }, (_, index) => ({
                  id: String(index),
                  function: {
                    name: "search_danbooru_tags",
                    arguments: '{"query":"hair"}',
                  },
                })),
              },
            },
          ],
        }),
      ),
    );
    const { runTagAgent } = await import("@/lib/tag-agent");

    await expect(runTagAgent("key", "model", "request", {})).rejects.toThrow(
      "过多检索工具",
    );
    expect(runTool).not.toHaveBeenCalled();
  });

  it("executes an allowed tool batch and returns the next model answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "one",
                    function: {
                      name: "search_danbooru_tags",
                      arguments: '{"query":"hair"}',
                    },
                  },
                ],
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
      { tool: "search_danbooru_tags", query: "hair", ok: true },
    ]);
    expect(runTool).toHaveBeenCalledTimes(1);
  });
});
