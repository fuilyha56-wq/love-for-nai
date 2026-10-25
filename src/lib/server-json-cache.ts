import { readFile, stat } from "node:fs/promises";

type CacheEntry = { mtimeMs: number; size: number; ino: number; value: unknown };
const entries = new Map<string, CacheEntry>();

/** Cache parsed JSON by file identity while still detecting atomic file replacements. */
export async function readCachedJsonFile<T>(file: string, normalize: (value: unknown) => T, options: { clone?: boolean } = {}): Promise<T> {
  // clone:false exposes the shared parsed value; callers must treat it as read-only.
  const clone = options.clone !== false;
  const info = await stat(file);
  const previous = entries.get(file);
  const unchanged = previous && previous.mtimeMs === info.mtimeMs && previous.size === info.size && previous.ino === info.ino;
  if (unchanged) return clone ? structuredClone(previous.value) as T : previous.value as T;
  const parsed = normalize(JSON.parse(await readFile(file, "utf8")) as unknown);
  const cached = structuredClone(parsed);
  entries.set(file, { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino, value: cached });
  return clone ? structuredClone(cached) : cached as T;
}

export function invalidateCachedJsonFile(file: string): void {
  entries.delete(file);
}
