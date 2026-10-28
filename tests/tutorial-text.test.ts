import { describe, expect, it } from "vitest";
import { splitTutorialText } from "@/lib/tutorial-text";

describe("教程关键操作强调", () => {
  it("保留完整原文，突出引号内的按钮名称和关键动作", () => {
    const value = "先上传源图，点击「独立重绘编辑器」；进入后再点「下一步」。";
    const parts = splitTutorialText(value);
    expect(parts.map((part) => part.text).join("")).toBe(value);
    expect(parts.filter((part) => part.important).map((part) => part.text)).toEqual(["上传源图", "「独立重绘编辑器」", "「下一步」"]);
  });

  it("优先强调完整名称，连续调用不会丢失匹配，普通叙述仍保留原样", () => {
    const value = "生成并预览后，应用到工作台。";
    for (let index = 0; index < 2; index++) {
      expect(splitTutorialText(value).filter((part) => part.important).map((part) => part.text)).toEqual(["生成并预览", "应用到工作台"]);
    }
    expect(splitTutorialText("满意后再继续。" )).toEqual([{ text: "满意后再继续。", important: false }]);
  });
});
