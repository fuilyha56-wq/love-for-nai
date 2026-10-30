import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Cross-process lease for the shared data volume. Atomic rename is still used for writes. */
export async function withDataFileLock<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid data lock key");
  const root = path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    ".locks",
  );
  await mkdir(root, { recursive: true });
  const target = path.join(root, key);
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(target);
      await writeFile(path.join(target, "owner"), token);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(target)).mtimeMs > 120_000) {
          const abandoned = path.join(root, `${key}-expired-${token}`);
          await rename(target, abandoned);
          await rm(abandoned, { recursive: true, force: true });
          continue;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (Date.now() - started > 150_000)
        throw new Error("数据繁忙，请稍后重试");
      await delay(25 + Math.random() * 50);
    }
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(target, now, now).catch(() => undefined);
  }, 10_000);
  heartbeat.unref();
  try {
    return await task();
  } finally {
    clearInterval(heartbeat);
    if (
      (await readFile(path.join(target, "owner"), "utf8").catch(() => "")) ===
      token
    )
      await rm(target, { recursive: true, force: true });
  }
}
