import { readFile, stat } from "node:fs/promises";

const cache = new Map<string, { signature: string; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const signature = (info: { mtimeMs: number; size: number; ino: number }) =>
  `${info.mtimeMs}:${info.size}:${info.ino}`;

/** Cache parsed snapshots, still checking file metadata for edits by another process. */
export async function readCachedJson<T>(file: string): Promise<T> {
  const version = signature(await stat(file));
  const current = cache.get(file);
  if (current?.signature === version) return current.value as T;
  const key = `${file}:${version}`;
  let read = pending.get(key);
  if (!read) {
    read = readFile(file, "utf8")
      .then((text) => {
        const value = JSON.parse(text) as T;
        cache.set(file, { signature: version, value });
        if (cache.size > 16) cache.delete(cache.keys().next().value!);
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, read);
  }
  return (await read) as T;
}
export async function rememberWrittenJson(file: string, value: unknown) {
  cache.set(file, { signature: signature(await stat(file)), value });
}
