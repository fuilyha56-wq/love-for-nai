import { describe, expect, it } from "vitest";
import { convertNaiPromptSpaces, formatNaiPrompt } from "@/lib/nai-prompt-formatter";

describe("Aaalice NaiPromptFormatter 原版用例", () => {
  it.each([
    ["quality   tags， best quality,\n\n  blue hair, red eyes", "quality_tags, best_quality,\n\n  blue_hair, red_eyes"],
    ["subject tag,\r\nclothing tag,\r\nbackground tag", "subject_tag,\r\nclothing_tag,\r\nbackground_tag"],
    ["first tag\n  \nsecond tag", "first_tag\n  \nsecond_tag"],
    [String.raw`girl, alice \(wonderland\), negative(red hair, 1.2::blue eyes::)`, String.raw`girl, alice_\(wonderland\), negative(red_hair, 1.2::blue_eyes::)`],
    ["cat, /*disabled:long hair*/, /*disabled:blue eyes*/, dog", "cat, /*disabled:long hair*/, /*disabled:blue eyes*/, dog"],
    ["/*disabled:cat*/, blue hair", "/*disabled:cat*/, blue_hair"],
  ])("原版输入 %s", (source, expected) => {
    expect(formatNaiPrompt(source)).toBe(expected);
    for (let repeat = 0; repeat < 5; repeat++) expect(formatNaiPrompt(expected)).toBe(expected);
  });
});

describe("Aaalice TextSpaceConverter 与边界", () => {
  it("按最近非空格字符保护整段空格，词内每个空格转为一个下划线", () => {
    expect(convertNaiPromptSpaces("white   hair,   { blue eyes } | red sky | <my character>"))
      .toBe("white___hair,   { blue_eyes } | red_sky | <my character>");
    expect(convertNaiPromptSpaces("  tag  ")).toBe("__tag__");
  });
  it("保留嵌套和未闭合尖括号中的空格，不额外保护普通引号", () => {
    expect(convertNaiPromptSpaces('<my <nested alias> character> blue hair')).toBe('<my <nested alias> character> blue_hair');
    expect(convertNaiPromptSpaces('<my unfinished alias')).toBe('<my unfinished alias');
    expect(formatNaiPrompt('"Hello world", girl\'s dress')).toBe('"Hello_world", girl\'s_dress');
  });
  it("与原版一致整理空标签与行内空白，仅替换中文逗号", () => {
    expect(formatNaiPrompt("  ，white\t\thair，， blue\u00a0eyes,  ")).toBe("  white_hair, blue_eyes,  ");
    expect(formatNaiPrompt("blue eyes、red hair，warm：light")).toBe("blue_eyes、red_hair, warm：light");
    expect(formatNaiPrompt("\t\t\r\n   \r")).toBe("\t\t\r\n   \r");
  });
  it("禁用片段包含转义结束符、换行或尚未闭合时，原文始终不变", () => {
    const marker = String.raw`/*disabled:cat sitting， (blue eyes:1.3), <alias> *\/ end\\*/`;
    expect(formatNaiPrompt(`white hair, ${marker}, blue eyes`)).toBe(`white_hair, ${marker}, blue_eyes`);
    expect(formatNaiPrompt("white hair, /*disabled:blue eyes\nred hair")).toBe("white_hair, /*disabled:blue eyes\nred hair");
    expect(formatNaiPrompt(String.raw`white hair, \/*disabled:blue eyes*/`)).toBe(String.raw`white_hair, \/*disabled:blue_eyes*/`);
  });
  it("先格式化 reserved negative 块内容，再处理整段提示词", () => {
    expect(formatNaiPrompt("white hair, negative(，，blue eyes,,), red hair")).toBe("white_hair, negative(blue_eyes, ), red_hair");
    expect(formatNaiPrompt("negative(blue hair\\")).toBe("negative(blue_hair\\");
  });
});
