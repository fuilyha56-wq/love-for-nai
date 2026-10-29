export type AssistantCreativeMemory = { title: string; text: string };
export const ASSISTANT_MEMORY_LIMIT = 10;
export const ASSISTANT_MEMORY_TOTAL = 5000;

/** Validate continuity notes as user data, never as system instructions. */
export function parseAssistantCreativeMemory(value: unknown): AssistantCreativeMemory[] {
  if (!Array.isArray(value) || value.length > ASSISTANT_MEMORY_LIMIT) throw new Error("创作记忆最多保存 10 条。");
  let total = 0;
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => key !== "title" && key !== "text")) throw new Error(`第 ${index + 1} 条创作记忆格式不正确。`);
    const note = entry as Record<string, unknown>;
    if (typeof note.title !== "string" || typeof note.text !== "string") throw new Error("创作记忆的标题和内容必须是文本。");
    const title = note.title.trim(), text = note.text.trim();
    if (!title || title.length > 80 || !text || text.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(title + text)) throw new Error("每条创作记忆需要标题（最多 80 字）和内容（最多 500 字）。");
    total += title.length + text.length;
    if (total > ASSISTANT_MEMORY_TOTAL) throw new Error("创作记忆总长度不能超过 5000 字。");
    return { title, text };
  });
}
