import { readTagWeight, splitPromptTags } from "./replica-prompt";
import { promptTagText } from "./prompt-tag";

export type PromptCompletion = { name: string; displayName?: string; categoryName?: string; postCount?: number; zh?: string; insertion?: string; local?: boolean; occurrences?: number; source?: string; catalogKey?: string; description?: string; descriptionUrl?: string };

/** Aaalice defaults to canonical tag insertion; authored snippets and aliases stay intact. */
export function promptCompletionText(hit: PromptCompletion): string {
  return hit.insertion || hit.name;
}

export function normalizePromptCompletionQuery(query: string): string {
  return query.normalize("NFKC").toLowerCase().replace(/[\s_]+/g, " ").trim();
}

export function isPromptCompletionQuery(query: string): boolean {
  return query.length <= 80 && (query.length >= 2 || /\p{Script=Han}/u.test(query));
}

export function promptCompletionHitRank(query: string, hit: PromptCompletion): number {
  const compact = /\p{Script=Han}/u.test(query);
  const normalize = (value: string) => {
    const normalized = normalizePromptCompletionQuery(value);
    return compact ? normalized.replaceAll(" ", "") : normalized;
  };
  const keyword = normalize(query);
  if (!keyword) return 4;
  return Math.min(...[hit.name, hit.displayName, hit.zh].map((label) => {
    if (!label) return 4;
    const text = normalize(label);
    if (text === keyword) return 0;
    if (text.startsWith(keyword)) return 1;
    if (text.includes(` ${keyword}`)) return 2;
    return text.includes(keyword) ? 3 : 4;
  }));
}

export function mergePromptCompletions(query: string, hits: PromptCompletion[], maximum: number): PromptCompletion[] {
  const matches = new Map<string, { hit: PromptCompletion; rank: number }>();
  for (const hit of hits) {
    const insertion = promptCompletionText(hit).trim();
    const key = (hit.insertion && hit.insertion !== hit.name ? insertion : promptTagText(insertion)).toLowerCase();
    if (!key) continue;
    const rank = promptCompletionHitRank(query, hit);
    const previous = matches.get(key);
    if (!previous) matches.set(key, { hit, rank });
    else if (rank < previous.rank) matches.set(key, { hit: { ...previous.hit, zh: hit.zh ?? previous.hit.zh }, rank });
  }
  return [...matches.values()].sort((left, right) => left.rank - right.rank).slice(0, maximum).map(({ hit }) => hit);
}

let wordlistRequest: Promise<string[]> | null = null;
/** Reuse the bundled NovelAI wordlist so basic suggestions work without the remote tag service. */
export function loadPromptCompletionWordlist(): Promise<string[]> {
  wordlistRequest ??= fetch("/data/random-wordlists.json", { cache: "force-cache" }).then(async (response) => {
    if (!response.ok) throw new Error("本地词表加载失败");
    const data = await response.json() as { generators?: Array<{ groups?: Array<{ entries?: unknown[][] }> }> };
    return (data.generators || []).flatMap((generator) => (generator.groups || []).flatMap((group) => (group.entries || []).flatMap((entry) => typeof entry[0] === "string" ? [entry[0]] : [])));
  }).catch(() => { wordlistRequest = null; return []; });
  return wordlistRequest;
}

/** The complete tag around the caret is replaced, including text after it. */
export function promptTokenAt(text: string, cursor: number) {
  const safeCursor = Math.min(text.length, Math.max(0, cursor));
  const before = text.slice(0, safeCursor);
  const start = Math.max(before.lastIndexOf(","), before.lastIndexOf("，"), before.lastIndexOf("\n")) + 1;
  const remaining = text.slice(safeCursor);
  const endOffset = remaining.search(/[,，\n]/);
  const end = endOffset < 0 ? text.length : safeCursor + endOffset;
  const segment = text.slice(start, end);
  const indentation = segment.match(/^\s*/)?.[0] || "";
  const prefix = text.slice(start + indentation.length, safeCursor);
  return { start: start + indentation.length, end, token: prefix.trim(), leading: indentation };
}
export function insertPromptCompletion(text: string, cursor: number, insertion: string) {
  const span = promptTokenAt(text, cursor);
  const next = text.slice(0, span.start) + insertion + text.slice(span.end);
  return { text: next, cursor: span.start + insertion.length };
}
export function canonicalPromptTag(tag: string): string {
  return readTagWeight(tag).content.replace(/^[{\[(]+|[}\])]+$/g, "").trim().replace(/[ \t]+/g, "_").toLowerCase();
}

/** Count real shared tag occurrences in saved library entries / generated history, never invent associations. */
export function localCooccurringTags(selected: string, samples: string[], existingPrompt: string, maximum = 10): PromptCompletion[] {
  const source = canonicalPromptTag(selected);
  if (!source || splitPromptTags(selected).length !== 1) return [];
  const sampleTags = (sample: string) => splitPromptTags(sample).filter((tag) => !tag.startsWith("/*disabled:")).flatMap((tag) => {
    const unwrapped = readTagWeight(tag).content.replace(/^[{\[(]+|[}\])]+$/g, "").trim();
    return splitPromptTags(unwrapped).map(canonicalPromptTag);
  });
  const existing = new Set(sampleTags(existingPrompt));
  const frequency = new Map<string, number>();
  for (const sample of samples) {
    const tags = new Set(sampleTags(sample));
    if (!tags.has(source)) continue;
    for (const tag of tags) {
      if (!tag || tag === source || existing.has(tag) || tag.includes("<")) continue;
      frequency.set(tag, (frequency.get(tag) || 0) + 1);
    }
  }
  return [...frequency].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, maximum)
    .map(([name, occurrences]) => ({ name, displayName: promptTagText(name), categoryName: "历史/词库共现", occurrences, local: true }));
}

export function matchLocalPromptTags(query: string, names: string[], maximum = 10): PromptCompletion[] {
  const normalized = query.trim().replace(/[ \t]+/g, "_").toLowerCase();
  if (normalized.length < 2) return [];
  const candidates = [...new Set(names.map(canonicalPromptTag))].filter((name) => name.includes(normalized));
  return candidates.sort((left, right) => Number(right.startsWith(normalized)) - Number(left.startsWith(normalized)) || left.length - right.length || left.localeCompare(right))
    .slice(0, maximum).map((name) => ({ name, displayName: promptTagText(name), categoryName: "本地词表", local: true }));
}

export const PROMPT_EDITOR_HEIGHTS = { minimum: 96, maximum: 480 } as const;
export function clampPromptEditorHeight(height: number): number {
  return Math.min(PROMPT_EDITOR_HEIGHTS.maximum, Math.max(PROMPT_EDITOR_HEIGHTS.minimum, Number.isFinite(height) ? height : 144));
}
