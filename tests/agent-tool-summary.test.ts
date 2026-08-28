import { describe, expect, it } from "vitest";
import { summarizeToolResult } from "@/lib/agent-tools";

describe("summarizeToolResult", () => {
  it("summarizes danbooru tag search results", () => {
    expect(
      summarizeToolResult("search_danbooru_tags", {
        tags: [{ name: "a" }, { name: "b" }],
      }),
    ).toBe("检索到 2 个候选标签");
    expect(summarizeToolResult("search_danbooru_tags", { tags: [] })).toBe(
      "无匹配标签",
    );
    expect(
      summarizeToolResult("search_danbooru_tags", { note: "关键词为空" }),
    ).toBe("关键词为空");
  });

  it("summarizes verification, wiki and web search", () => {
    expect(
      summarizeToolResult("verify_danbooru_tag", {
        exists: true,
        postCount: 45200,
      }),
    ).toBe("存在 · 45,200 图");
    expect(summarizeToolResult("verify_danbooru_tag", { exists: false })).toBe(
      "标签不存在",
    );
    expect(
      summarizeToolResult("read_danbooru_wiki", { found: true, title: "xxx" }),
    ).toBe("词条：xxx");
    expect(
      summarizeToolResult("web_search", { results: [{}, {}, {}] }),
    ).toBe("3 条概念结果");
    expect(summarizeToolResult("unknown_tool", {})).toBe("完成");
  });
});
