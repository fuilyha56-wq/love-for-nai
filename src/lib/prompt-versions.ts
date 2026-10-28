export const PROMPT_VERSION_RETENTION_MS = 60_000;
export type PromptVersionTarget = "prompt" | "negative";
export type PromptVersion = { id: string; target: PromptVersionTarget; text: string; createdAt: number };

export function recentPromptVersions(value: unknown, now: number): PromptVersion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PromptVersion => Boolean(item && typeof item.id === "string" &&
    (item.target === "prompt" || item.target === "negative") && typeof item.text === "string" &&
    Number.isFinite(item.createdAt) && item.createdAt <= now && now - item.createdAt < PROMPT_VERSION_RETENTION_MS))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 4000);
}

export function recordPromptVersion(versions: PromptVersion[], target: PromptVersionTarget, text: string, now: number, id: string): PromptVersion[] {
  const recent = recentPromptVersions(versions, now);
  if (recent.find((item) => item.target === target)?.text === text) return recent;
  return [{ id, target, text, createdAt: now }, ...recent].slice(0, 4000);
}
