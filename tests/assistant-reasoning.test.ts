import { describe, expect, it } from "vitest";
import { assistantReasoningParams, assistantReasoningProfile, resolveAssistantReasoning } from "@/lib/assistant-reasoning";
describe("model-specific assistant reasoning", () => {
  it.each([
    ["deepseek-v4-pro", ["low", "high", "max"]],
    ["GLM-5.3", ["low", "high", "max"]],
    ["GLM-5", ["high", "max"]],
    ["glm-4.7", ["none", "high"]],
    ["qwen3.8-max", ["none", "low", "medium", "high", "xhigh"]],
    ["qwen3.5-plus", ["none", "low", "medium", "high"]],
    ["gpt-5.4", ["none", "low", "medium", "high", "xhigh"]],
    ["gpt-5.2-pro", ["medium", "high", "xhigh"]],
    ["claude-sonnet-4-6", ["low", "medium", "high", "max"]],
    ["claude-opus-4-7", ["low", "medium", "high", "xhigh", "max"]],
    ["grok-4.7", ["low", "medium", "high", "xhigh"]],
    ["grok-3-mini", ["low", "high"]],
    ["gemini-3.8-flash", ["low", "medium", "high"]],
    ["gemini-3-flash", ["minimal", "low", "medium", "high"]],
  ])("offers supported controls for %s and defaults to high", (model, levels) => {
    expect(assistantReasoningProfile(model).levels).toEqual(levels);
    expect(resolveAssistantReasoning(model)).toBe("high");
  });
  it("uses explicit budget/toggle adapters without sending conflicting parameters", () => {
    expect(assistantReasoningParams("qwen3.5-plus", "low")).toEqual({ enable_thinking: true, thinking_budget: 4096 });
    expect(assistantReasoningParams("qwen3.5-plus")).toEqual({ enable_thinking: true, thinking_budget: 32768 });
    expect(assistantReasoningParams("qwen3.8-max")).toEqual({ reasoning_effort: "high" });
    expect(assistantReasoningParams("glm-4.7", "none")).toEqual({ thinking: { type: "disabled" } });
    expect(assistantReasoningParams("glm-5", "max")).toEqual({ reasoning_effort: "max" });
    expect(assistantReasoningParams("gpt-4o")).toEqual({});
    expect(assistantReasoningParams("custom-unknown")).toEqual({});
    expect(() => assistantReasoningParams("deepseek-v4-pro", "medium")).toThrow("不支持");
  });
  it("uses text tool actions for GPT models whose Chat Completions API disallows native functions", () => {
    expect(assistantReasoningProfile("gpt-6.1-sol").responses).toBe(true);
    expect(assistantReasoningProfile("gpt-5.5").responses).toBe(true);
    expect(assistantReasoningProfile("gpt-5.4").responses).toBeUndefined();
  });
});
