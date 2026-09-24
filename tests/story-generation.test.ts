import { describe, expect, it } from "vitest";
import { applyStoryGeneration, withStoryGenerationSlot } from "@/lib/story-generation";

describe("故事生成", () => {
  it("按续写、改写和插入模式合并正文", () => {
    const base = { instruction: "", selectionStart: 1, selectionEnd: 3 };
    expect(applyStoryGeneration({ ...base, mode: "continue", content: "开头" }, "后续")).toBe("开头\n\n后续");
    expect(applyStoryGeneration({ ...base, mode: "rewrite", content: "ABCDE" }, "新段")).toBe("A新段DE");
    expect(applyStoryGeneration({ ...base, mode: "insert", content: "ABCDE" }, "插入")).toBe("A插入BCDE");
  });

  it("全局最多同时执行两个生成任务", async () => {
    let active = 0;
    let peak = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const tasks = Array.from({ length: 3 }, (_, index) =>
      withStoryGenerationSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        if (index < 2) await gate;
        active -= 1;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(2);
    releaseFirst();
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });
});