import { isV5Model, qualityTagsForTier, ucForModel } from './nai-quality';

export type ReplicaVariant = "nai" | "nlw";
export type PromptTarget = "positive" | "negative";
export type QualityPreset = "standard" | "light" | "none" | "custom";
export type UcPreset = "heavy" | "light" | "human" | "furry" | "none" | "custom";
export type FixedPromptTag = {
  id: string;
  name: string;
  content: string;
  target: PromptTarget;
  position: "prefix" | "suffix";
  weight: number;
  enabled: boolean;
  category: string;
};
export type PromptRegexRule = { id: string; pattern: string; replacement: string; enabled: boolean };
export type ReplicaPromptConfig = {
  version: 1;
  quality: QualityPreset;
  qualityCustom: string;
  uc: UcPreset;
  ucCustom: string;
  transparent: boolean;
  fixedTags: FixedPromptTag[];
  library: FixedPromptTag[];
  disabledPositive: string[];
  disabledNegative: string[];
  settings: { autocomplete: boolean; autoFormat: boolean; highlight: boolean; sdConvert: boolean; resolveAliasesOnCopy: boolean };
  regexRules: PromptRegexRule[];
};
export const DEFAULT_REPLICA_PROMPT_CONFIG: ReplicaPromptConfig = {
  version: 1,
  quality: "standard",
  qualityCustom: "",
  uc: "heavy",
  ucCustom: "",
  transparent: false,
  fixedTags: [],
  library: [],
  disabledPositive: [],
  disabledNegative: [],
  settings: { autocomplete: true, autoFormat: true, highlight: true, sdConvert: false, resolveAliasesOnCopy: false },
  regexRules: [],
};
export const REPLICA_SHARED_PRESET_KEYS = { quality: "lfn-quality-custom", uc: "lfn-uc-custom" } as const;

/** The /prompts page owns these shared plain-text values; removal clears a preset. */
export function withSharedReplicaPresets(config: ReplicaPromptConfig, quality: string | null, uc: string | null): ReplicaPromptConfig {
  return { ...config, qualityCustom: shortText(quality).trim(), ucCustom: shortText(uc).trim() };
}

/** Keep commas inside emphasis groups, quoted tags and escaped literals intact. */
export function splitPromptTags(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  const stack: string[] = [];
  let quote = "";
  let numericGroup = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") { index++; continue; }
    if (!quote && text.startsWith("/*disabled:", index)) {
      const closing = text.indexOf("*/", index + 11);
      index = closing < 0 ? text.length : closing + 1;
      continue;
    }
    if (quote) { if (char === quote) quote = ""; continue; }
    if ((char === '"' || char === "'") && (index === start || /\s/.test(text[index - 1]))) { quote = char; continue; }
    if (text.slice(index, index + 2) === "::") {
      if (numericGroup) numericGroup = false;
      else if (/(?:^|[\s,])[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text.slice(start, index))) numericGroup = true;
      index++;
      continue;
    }
    if ("{[(".includes(char)) stack.push(char);
    else if ("}])".includes(char) && stack.length) {
      const expected = char === "}" ? "{" : char === "]" ? "[" : "(";
      if (stack[stack.length - 1] === expected) stack.pop();
    } else if ((char === "," || char === "，" || char === "\n") && !stack.length && !numericGroup) {
      const value = text.slice(start, index).trim();
      if (value) result.push(value);
      start = index + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) result.push(last);
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function shortText(value: unknown, maximum = 100_000): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}
function tags(value: unknown): FixedPromptTag[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 500).flatMap((item, index) => {
    const source = record(item);
    const content = shortText(source.content);
    if (!content.trim()) return [];
    const id = shortText(source.id, 200) || "restored-" + index;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name: shortText(source.name, 200),
      content,
      target: source.target === "negative" ? "negative" as const : "positive" as const,
      position: source.position === "suffix" ? "suffix" as const : "prefix" as const,
      weight: typeof source.weight === "number" && Number.isFinite(source.weight) ? Math.min(2, Math.max(0.5, source.weight)) : 1,
      enabled: source.enabled !== false,
      category: shortText(source.category, 200) || "根目录",
    }];
  });
}
export function parseReplicaPromptConfig(serialized: string | null): ReplicaPromptConfig {
  let source: Record<string, unknown> = {};
  try { if (serialized) source = record(JSON.parse(serialized)); } catch { /* Corrupt storage falls back to safe defaults. */ }
  if (source.version !== 1) return structuredClone(DEFAULT_REPLICA_PROMPT_CONFIG);
  const settings = record(source.settings);
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 500) : [];
  const rules = Array.isArray(source.regexRules) ? source.regexRules.slice(0, 40).flatMap((item, index) => {
    const rule = record(item);
    if (typeof rule.pattern !== "string") return [];
    return [{ id: shortText(rule.id, 200) || "rule-" + index, pattern: shortText(rule.pattern, 500), replacement: shortText(rule.replacement, 2_000), enabled: rule.enabled !== false }];
  }) : [];
  return {
    version: 1,
    quality: ["standard", "light", "none", "custom"].includes(String(source.quality)) ? source.quality as QualityPreset : "standard",
    qualityCustom: shortText(source.qualityCustom),
    uc: ["heavy", "light", "human", "furry", "none", "custom"].includes(String(source.uc)) ? source.uc as UcPreset : "heavy",
    ucCustom: shortText(source.ucCustom),
    transparent: source.transparent === true,
    fixedTags: tags(source.fixedTags),
    library: tags(source.library),
    disabledPositive: strings(source.disabledPositive),
    disabledNegative: strings(source.disabledNegative),
    settings: {
      autocomplete: settings.autocomplete !== false,
      autoFormat: settings.autoFormat !== false,
      highlight: settings.highlight !== false,
      sdConvert: settings.sdConvert === true,
      resolveAliasesOnCopy: settings.resolveAliasesOnCopy === true,
    },
    regexRules: rules,
  };
}

// Canonical aliases keep the replica aligned with the shared preset source.
function canonicalModel(model: string): string | null {
  const lower = model.toLowerCase();
  if (lower === 'nai') return 'nai';
  const match = lower.match(/(?:nai[-_]v|(?:anime[-_])?diffusion[-_]?)([345](?:[._-]5)?)/);
  if (!match) return null;
  const version = match[1].replace(/[_-]/g, '.');
  if (/furry/.test(lower) && version === '3') return 'nai-v3-furry';
  return 'nai-v' + version + (/curated/.test(lower) ? '-curated' : version === '3' ? '' : '-full');
}
export function supportsLightQuality(model: string): boolean { return isV5Model(canonicalModel(model) || model); }
export function qualityPrompt(model: string, preset: QualityPreset, custom = ''): string {
  if (preset === 'none') return '';
  if (preset === 'custom') return custom.trim();
  const canonical = canonicalModel(model);
  return canonical ? qualityTagsForTier(canonical, preset === 'standard' ? 'nai-default' : preset) : '';
}
export function ucPrompt(model: string, preset: UcPreset, custom = ''): string {
  if (preset === 'none') return '';
  if (preset === 'custom') return custom.trim();
  const canonical = canonicalModel(model);
  return canonical ? ucForModel(canonical, preset === 'human' ? 'human-focus' : preset === 'furry' ? 'furry-focus' : preset) : '';
}
export function applyPromptWeight(text: string, weight: number): string {
  const value = text.trim();
  return weight === 1 ? value : weight.toFixed(2) + "::" + value + "::";
}
export function readTagWeight(text: string): { content: string; weight: number } {
  const numeric = text.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))::([\s\S]*)::$/);
  if (numeric) return { content: numeric[2], weight: Number(numeric[1]) };
  return { content: text, weight: 1 };
}
export function resolvePromptAliases(text: string, library: FixedPromptTag[]): string {
  const aliases = new Map(library.filter((entry) => entry.name.trim()).map((entry) => [entry.name.trim(), entry.content]));
  return text.replace(/<([^<>\n]+)>/g, (match, name: string) => aliases.get(name.trim()) ?? match);
}
export function activePromptText(raw: string): string {
  return raw.includes("/*disabled:")
    ? splitPromptTags(raw).filter((tag) => !tag.startsWith("/*disabled:")).join(", ")
    : raw.trim();
}
export type PromptCompositionPart = { label: string; content: string; kind: "fixed" | "input" | "quality" | "transparent" };
export function composeReplicaPrompt(prompt: string, negative: string, model: string, config: ReplicaPromptConfig) {
  const parts = (target: PromptTarget): PromptCompositionPart[] => {
    const fixed = config.fixedTags.filter((entry) => entry.enabled && entry.target === target);
    const resolve = (text: string) => resolvePromptAliases(text, config.library);
    const disabled = target === "positive" ? config.disabledPositive : config.disabledNegative;
    const raw = target === "positive" ? prompt : negative;
    // Preserve raw whitespace and syntax unless tag mode explicitly disables items.
    const active = activePromptText(raw);
    const input = disabled.length ? splitPromptTags(active).filter((tag) => !disabled.includes(tag)).join(", ") : active;
    const preset = target === "positive" ? qualityPrompt(model, config.quality, config.qualityCustom) : ucPrompt(model, config.uc, config.ucCustom);
    const prefix = fixed.filter((entry) => entry.position === "prefix").map((entry) => applyPromptWeight(resolve(entry.content), entry.weight)).join(", ");
    const suffix = fixed.filter((entry) => entry.position === "suffix").map((entry) => applyPromptWeight(resolve(entry.content), entry.weight)).join(", ");
    const output: PromptCompositionPart[] = [];
    const add = (label: string, content: string, kind: PromptCompositionPart["kind"]) => { if (content.trim()) output.push({ label, content: content.trim(), kind }); };
    if (target === "negative") add("质量词（负面）", preset, "quality");
    add("固定词（前缀）", prefix, "fixed");
    add(target === "positive" ? "输入提示词" : "输入负面词", resolve(input), "input");
    if (target === "positive") {
      add("透明背景", config.transparent ? "transparent background" : "", "transparent");
      add("质量词（正面）", preset, "quality");
    }
    add("固定词（后缀）", suffix, "fixed");
    return output;
  };
  const positiveParts = parts("positive");
  const negativeParts = parts("negative");
  return { prompt: positiveParts.map((part) => part.content).join(", "), negative: negativeParts.map((part) => part.content).join(", "), positiveParts, negativeParts };
}
export function transformPromptOnBlur(text: string, config: ReplicaPromptConfig): { text: string; error: string | null } {
  let value = text;
  if (config.settings.sdConvert) value = value.replace(/\(([^()\n]+):(\d+(?:\.\d+)?)\)/g, (_, content: string, weight: string) => applyPromptWeight(content, Number(weight)));
  if (config.settings.autoFormat) value = value.replace(/[，、]/g, ", ").replace(/[：]/g, ":");
  for (const rule of config.regexRules.filter((rule) => rule.enabled && rule.pattern)) {
    try { value = value.replace(new RegExp(rule.pattern, "g"), rule.replacement); }
    catch { return { text: value, error: "正则表达式无效：" + rule.pattern }; }
  }
  return { text: value, error: null };
}
export { generateRandomPrompt as randomReplicaPrompt } from './random-prompt';
