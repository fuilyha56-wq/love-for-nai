export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type Profile = { vendor: string; levels: ReasoningEffort[]; mode: "effort" | "budget" | "toggle" | "none"; note: string; responses?: boolean };
const profile = (vendor: string, levels: ReasoningEffort[], mode: Profile["mode"] = "effort", note = ""): Profile => ({ vendor, levels, mode, note });

/** Conservative model-specific controls for NewAPI's OpenAI-compatible relay. */
export function assistantReasoningProfile(model: string): Profile {
  const id = model.toLowerCase();
  if (/deepseek/.test(id)) return profile("DeepSeek", ["low", "high", "max"], "effort", "按 DeepSeek 的 low / high / max 档位发送；实际能力取决于上游版本。");
  if (/glm/.test(id)) {
    if (/glm[-_.]?5\.3/.test(id)) return profile("GLM", ["low", "high", "max"]);
    if (/glm[-_.]?5/.test(id)) return profile("GLM", ["high", "max"]);
    if (/glm[-_.]?4\.[567]/.test(id)) return profile("GLM", ["none", "high"], "toggle", "此系列按思考开关适配，不虚构多档强度。");
  }
  if (/qwen/.test(id)) {
    if (/qwen[-_.]?3\.8/.test(id)) return profile("Qwen", ["none", "low", "medium", "high", "xhigh"], "effort", "Qwen3.8 将 high 映射为 xhigh；不同时发送 thinking_budget。");
    if (/qwen[-_.]?3|qwen-(?:plus|flash|max)/.test(id) && !/non-thinking|instruct-2507/.test(id)) return profile("Qwen", ["none", "low", "medium", "high"], "budget", "低 / 中 / 高分别使用 4096 / 16384 / 32768 thinking token 预算。");
  }
  if (/claude/.test(id)) {
    if (/(?:opus|sonnet|haiku)[-_.]?5|(?:fable|mythos)/.test(id) || /opus[-_.]?4[.-][789]/.test(id)) return profile("Claude", ["low", "medium", "high", "xhigh", "max"]);
    if (/(?:opus|sonnet)[-_.]?4[.-]6/.test(id)) return profile("Claude", ["low", "medium", "high", "max"]);
    if (/3[.-]7|4/.test(id)) return profile("Claude", ["low", "medium", "high"], "effort", "由 NewAPI 转换成该 Claude 版本支持的 effort 或思考预算。");
  }
  if (/gemini/.test(id)) {
    if (/gemini[-_.]?[34]/.test(id)) return profile("Gemini", /(?:3[.-][78]|gemini-4|3(?:[.-]1)?-pro)/.test(id) ? ["low", "medium", "high"] : ["minimal", "low", "medium", "high"]);
    if (/gemini[-_.]?2\.5/.test(id)) return profile("Gemini", ["low", "medium", "high"], "effort", "由 NewAPI 将强度转换为 Gemini 2.5 的思考预算。");
  }
  if (/grok/.test(id)) {
    if (/non-reasoning/.test(id)) return profile("Grok", [], "none", "此模型为非推理版本。");
    if (/grok-4\.(?:[67]|20-multi)/.test(id)) return profile("Grok", ["low", "medium", "high", "xhigh"]);
    if (/grok-4\.5/.test(id)) return profile("Grok", ["low", "medium", "high"]);
    if (/grok-3-mini/.test(id)) return profile("Grok", ["low", "high"]);
    return profile("Grok", [], "none", "此版本未提供可调思考档位，使用上游默认。");
  }
  if (/gpt-[56]|(?:^|\/)o[134](?:-|$)/.test(id)) {
    if (/gpt-6/.test(id)) return { ...profile("GPT", /astra|6\.1-sol/.test(id) ? ["low", "medium", "high", "xhigh", "max"] : ["none", "low", "medium", "high", "xhigh", "max"]), responses: true };
    if (/gpt-5\.[5-9]/.test(id)) return { ...profile("GPT", ["none", "low", "medium", "high", "xhigh"]), responses: true };
    if (/gpt-5\.[234]/.test(id)) return profile("GPT", /-pro/.test(id) ? ["medium", "high", "xhigh"] : ["none", "low", "medium", "high", "xhigh"]);
    if (/gpt-5\.1/.test(id)) return profile("GPT", ["none", "low", "medium", "high"]);
    if (/gpt-5/.test(id)) return profile("GPT", ["minimal", "low", "medium", "high"]);
    return profile("GPT", ["low", "medium", "high"]);
  }
  return profile("当前模型", [], "none", "尚未确认此模型的思考参数，使用上游默认。");
}

export function resolveAssistantReasoning(model: string, requested?: unknown): ReasoningEffort | undefined {
  const p = assistantReasoningProfile(model);
  if (requested === undefined || requested === "auto") return p.levels.includes("high") ? "high" : p.levels.at(-1);
  if (typeof requested !== "string" || !p.levels.includes(requested as ReasoningEffort)) throw new Error(`${model} 不支持所选思考强度，请重新选择。`);
  return requested as ReasoningEffort;
}

export function assistantReasoningParams(model: string, requested?: unknown): Record<string, unknown> {
  const effort = resolveAssistantReasoning(model, requested);
  const p = assistantReasoningProfile(model);
  if (!effort) return {};
  if (p.mode === "budget") return effort === "none" ? { enable_thinking: false } : { enable_thinking: true, thinking_budget: { low: 4096, medium: 16384, high: 32768 }[effort as "low" | "medium" | "high"] };
  if (p.mode === "toggle") return { thinking: { type: effort === "none" ? "disabled" : "enabled" } };
  return { reasoning_effort: effort };
}
