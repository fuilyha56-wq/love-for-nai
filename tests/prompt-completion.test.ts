import { describe, expect, it } from "vitest";
import { clampPromptEditorHeight, insertPromptCompletion, localCooccurringTags, matchLocalPromptTags, promptTokenAt } from "@/lib/prompt-completion";

describe("提示词补全与本地共现", () => {
  it("光标在标签中间时替换完整标签，不删除后面的其它提示词", () => {
    const text = "1girl, blue hair, smile";
    const span = promptTokenAt(text, 12);
    expect(span).toMatchObject({ start: 7, end: 16, token: "blue" });
    expect(insertPromptCompletion(text, 12, "blue_eyes")).toEqual({ text: "1girl, blue_eyes, smile", cursor: 16 });
  });
  it("中文逗号、行首缩进和含空格的别名正确插入", () => {
    expect(insertPromptCompletion("1girl，\n  <my ch", 15, "<my character>").text).toBe("1girl，\n  <my character>");
    expect(promptTokenAt("blue hair", 9).token).toBe("blue hair");
  });
  it("本地词表匹配空格/下划线，按前缀与长度排序并去重", () => {
    const hits = matchLocalPromptTags("white h", ["white hair", "very white hair", "white_hair", "white hair bow", "blue hair"]);
    expect(hits.map((hit) => hit.name)).toEqual(["white_hair", "white_hair_bow", "very_white_hair"]);
    expect(hits.every((hit) => hit.local)).toBe(true);
  });
  it("仅基于真实样本统计共现次数，忽略已存在标签及disabled内容", () => {
    const samples = ["1girl, white hair, blue eyes", "{white_hair}, smile, blue_eyes", "1.20::white hair::, blue eyes, red eyes", "white hair, /*disabled:bad hands*/", "black hair, sunset"];
    const hits = localCooccurringTags("{{white_hair}}", samples, "1girl, white hair");
    expect(hits.map((hit) => [hit.name, hit.occurrences])).toEqual([["blue_eyes", 3], ["red_eyes", 1], ["smile", 1]]);
    expect(localCooccurringTags("unknown", samples, "unknown")).toEqual([]);
    expect(localCooccurringTags("white hair, blue eyes", samples, "")).toEqual([]);
  });
  it("调整高度限制在可用区间且无效数字安全回退", () => {
    expect(clampPromptEditorHeight(30)).toBe(96);
    expect(clampPromptEditorHeight(950)).toBe(480);
    expect(clampPromptEditorHeight(212)).toBe(212);
    expect(clampPromptEditorHeight(NaN)).toBe(144);
  });
});
