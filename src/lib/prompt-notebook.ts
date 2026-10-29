export const PROMPT_NOTEBOOK_KEY = "lfn-prompt-notebook-v1";
export const PROMPT_NOTEBOOK_LIMIT = 200;

export type PromptNote = {
  id: string;
  title: string;
  positive: string;
  negative: string;
  updatedAt: number;
};

export function parsePromptNotebook(value: unknown): PromptNote[] {
  const entries = Array.isArray(value) ? value : value && typeof value === "object" && "notes" in value ? (value as { notes: unknown }).notes : null;
  if (!Array.isArray(entries) || entries.length > PROMPT_NOTEBOOK_LIMIT) throw new Error("笔记文件格式不正确，最多支持 200 条笔记。");
  const ids = new Set<string>();
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`第 ${index + 1} 条笔记格式不正确。`);
    const note = entry as Record<string, unknown>;
    if (typeof note.title !== "string" || typeof note.positive !== "string" || (note.negative !== undefined && typeof note.negative !== "string")) throw new Error(`第 ${index + 1} 条笔记缺少标题或提示词。`);
    const title = note.title.trim();
    const positive = note.positive;
    const negative = typeof note.negative === "string" ? note.negative : "";
    if (!title || title.length > 120 || (!positive.trim() && !negative.trim()) || positive.length > 20_000 || negative.length > 20_000) throw new Error(`第 ${index + 1} 条笔记内容为空或超过长度限制。`);
    const id = typeof note.id === "string" && note.id.length <= 120 && note.id ? note.id : `import-${index}`;
    if (ids.has(id)) throw new Error(`第 ${index + 1} 条笔记编号重复。`);
    ids.add(id);
    return {
      id,
      title, positive, negative,
      updatedAt: typeof note.updatedAt === "number" && Number.isFinite(note.updatedAt) ? note.updatedAt : 0,
    };
  });
}

/** Keep internal weights, newlines and character syntax intact. */
export function appendPromptFragment(current: string, fragment: string): string {
  const addition = fragment.trim();
  if (!addition) return current;
  const prefix = current.trimEnd();
  if (!prefix.trim()) return addition;
  return `${prefix}${prefix.endsWith(",") ? "\n" : ",\n"}${addition}`;
}

export function mergePromptNotes(current: PromptNote[], incoming: PromptNote[], createId: () => string): PromptNote[] {
  const result = [...current];
  const known = new Set(current.map((note) => JSON.stringify([note.positive, note.negative])));
  for (const note of incoming) {
    const signature = JSON.stringify([note.positive, note.negative]);
    if (known.has(signature)) continue;
    if (result.length >= PROMPT_NOTEBOOK_LIMIT) throw new Error("合并后超过 200 条笔记，请先导出备份并整理笔记。");
    known.add(signature);
    result.push({ ...note, id: createId() });
  }
  return result;
}
