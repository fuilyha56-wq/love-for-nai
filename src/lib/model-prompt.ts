import { resolveImageModelCapabilities, type ImageProviderProtocol } from "./image-model-capabilities";
import { composeReplicaPrompt, resolvePromptAliases, transformPromptOnBlur, applyPromptRegex, type ReplicaPromptConfig, type PromptCompositionPart } from "./replica-prompt";

export function composeModelPrompt(prompt: string, negative: string, model: string, config: ReplicaPromptConfig, protocol?: ImageProviderProtocol) {
  if (resolveImageModelCapabilities(model, protocol).promptStyle === "tags") return composeReplicaPrompt(prompt, negative, model, config);
  const parts = (target: "positive" | "negative"): PromptCompositionPart[] => {
    const fixed = config.fixedTags.filter((entry) => entry.enabled && entry.target === target);
    const output: PromptCompositionPart[] = [];
    const add = (label: string, content: string, kind: PromptCompositionPart["kind"]) => { if (content.trim()) output.push({ label, content: resolvePromptAliases(content.trim(), config.library), kind }); };
    for (const entry of fixed.filter((entry) => entry.position === "prefix")) add(entry.name, entry.content, "fixed");
    add(target === "positive" ? "场景描述" : "排除要求", target === "positive" ? prompt : negative, "input");
    if (target === "positive" && config.transparent) add("透明背景", "Use a transparent background.", "transparent");
    for (const entry of fixed.filter((entry) => entry.position === "suffix")) add(entry.name, entry.content, "fixed");
    return output;
  };
  const positiveParts = parts("positive"), negativeParts = parts("negative");
  return { prompt: positiveParts.map((part) => part.content).join("\n"), negative: negativeParts.map((part) => part.content).join("\n"), positiveParts, negativeParts };
}

export function transformModelPromptOnBlur(text: string, config: ReplicaPromptConfig, natural: boolean) {
  return natural ? applyPromptRegex(text, config.regexRules) : transformPromptOnBlur(text, config);
}
