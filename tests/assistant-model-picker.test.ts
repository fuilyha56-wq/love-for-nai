import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantModelPicker } from "@/app/image/assistant-model-picker";

describe("assistant model selection visibility", () => {
  it.each([
    { pending: true, error: "", expected: "读取中" },
    { pending: false, error: "无法读取上游", expected: "无法读取上游" },
    { pending: false, error: "", expected: "上游暂无可用对话模型" },
  ])("keeps the picker visible while loading, unavailable or empty: $expected", ({ pending, error, expected }) => {
    const html = renderToStaticMarkup(createElement(AssistantModelPicker, { value: "", options: [], pending, error, onChange: vi.fn(), onRefresh: vi.fn() }));
    expect(html).toContain("助手模型 · NewAPI");
    expect(html).toContain("智能助手模型");
    expect(html).toContain(expected);
  });
});
