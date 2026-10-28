import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type CommentPreferences = { hiddenIds: string[]; blockedAuthorIds: number[] };
const locks = new Map<number, Promise<unknown>>();
const file = (id: number) => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "comment-preferences", `${id}.json`);
export async function getCommentPreferences(id?: number): Promise<CommentPreferences> {
  if (!id) return { hiddenIds: [], blockedAuthorIds: [] };
  try {
    const raw = JSON.parse(await readFile(file(id), "utf8"));
    return { hiddenIds: Array.isArray(raw.hiddenIds) ? raw.hiddenIds.filter((value: unknown) => typeof value === "string") : [], blockedAuthorIds: Array.isArray(raw.blockedAuthorIds) ? raw.blockedAuthorIds.filter((value: unknown) => Number.isSafeInteger(value) && Number(value) > 0) : [] };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { hiddenIds: [], blockedAuthorIds: [] }; throw error; }
}
export async function setCommentPreference(id: number, input: { commentId?: string; authorId?: number; hidden: boolean }) {
  const pending = (locks.get(id) || Promise.resolve()).then(async () => {
    const value = await getCommentPreferences(id);
    if (input.commentId) value.hiddenIds = [...new Set(input.hidden ? [...value.hiddenIds, input.commentId] : value.hiddenIds.filter(key => key !== input.commentId))].slice(-5000);
    if (input.authorId && input.authorId !== id) value.blockedAuthorIds = [...new Set(input.hidden ? [...value.blockedAuthorIds, input.authorId] : value.blockedAuthorIds.filter(key => key !== input.authorId))].slice(-1000);
    const target = file(id), temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, JSON.stringify(value), "utf8");
    await rename(temporary, target);
    return value;
  });
  const queued = pending.catch(() => undefined);
  locks.set(id, queued);
  void queued.then(() => { if (locks.get(id) === queued) locks.delete(id); });
  return pending;
}
