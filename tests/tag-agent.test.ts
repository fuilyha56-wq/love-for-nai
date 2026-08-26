import { beforeEach, describe, expect, it, vi } from "vitest";

const { runTool } = vi.hoisted(() => ({
  runTool: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/agent-tools", () => ({
  runTool,
  toolCatalog: () => "- search_danbooru_tags: 参数 {query: string}",
}));
vi.mock("@/lib/newapi", () => ({
  newApiBaseUrl: () => "http://newapi.test",
}));

describe("runTagAgent budgets", () => {
  beforeEach(() => {
    runTool.mockClear();
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
      { tool: "search_danbooru_tags", query: "hair", ok: true },
    ]);
    expect(runTool).toHaveBeenCalledTimes(1);
  });
});
