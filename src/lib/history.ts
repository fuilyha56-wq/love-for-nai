import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type GenerationParameters = {
  operation: string;
  model?: string;
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  n?: number;
  sampler?: string;
  noise_schedule?: string;
  cfg_rescale?: number;
  seed?: number;
  strength?: number;
};
export type HistoryItem = {
  id: string;
  createdAt: string;
  imagePath: string;
  saved: boolean;
  parameters: GenerationParameters;
  usage: unknown;
};

const historyRoot = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "history",
  );
const userDirectory = (userId: number) =>
  path.join(historyRoot(), String(userId));
const indexPath = (userId: number) =>
  path.join(userDirectory(userId), "index.json");

async function readIndex(userId: number): Promise<HistoryItem[]> {
  try {
    return JSON.parse(
      await readFile(indexPath(userId), "utf8"),
    ) as HistoryItem[];
  } catch {
    return [];
  }
}

async function writeIndex(userId: number, items: HistoryItem[]) {
  await mkdir(userDirectory(userId), { recursive: true });
  const target = indexPath(userId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(items, null, 2), "utf8");
  await rename(temporary, target);
}

const userLocks = new Map<number, Promise<unknown>>();

// 同一用户的历史读改写必须串行，否则并发生成会互相覆盖索引。
function withUserLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const previous = userLocks.get(userId) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => undefined);
  userLocks.set(userId, tail);
  // 队列排空后移除条目，避免用户量增长导致 Map 无限累积。
  void tail.then(() => {
    if (userLocks.get(userId) === tail) userLocks.delete(userId);
  });
  return current;
}

function safeParameters(body: Record<string, unknown>): GenerationParameters {
  const allowed = [
    "operation",
    "model",
    "prompt",
    "negative_prompt",
    "width",
    "height",
    "steps",
    "scale",
    "n",
    "sampler",
    "noise_schedule",
    "cfg_rescale",
    "seed",
    "strength",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => body[key] !== undefined)
      .map((key) => [key, body[key]]),
  ) as GenerationParameters;
}

export async function saveHistory(
  userId: number,
  body: Record<string, unknown>,
  images: string[],
  usage: unknown,
) {
  return withUserLock(userId, async () => {
    await mkdir(userDirectory(userId), { recursive: true });
    const created: HistoryItem[] = [];
    for (const image of images) {
      const match = image.match(
        /^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/,
      );
      if (!match) continue;
      const extension = match[1] === "jpeg" ? "jpg" : match[1];
      const id = randomUUID();
      const fileName = `${id}.${extension}`;
      await writeFile(
        path.join(userDirectory(userId), fileName),
        Buffer.from(match[2], "base64"),
      );
      created.push({
        id,
        createdAt: new Date().toISOString(),
        imagePath: fileName,
        saved: false,
        parameters: safeParameters(body),
        usage,
      });
    }
    const merged = [...created, ...(await readIndex(userId))];
    let unsavedSeen = 0;
    const retained: HistoryItem[] = [];
    const expired: HistoryItem[] = [];
    for (const item of merged) {
      if (item.saved) {
        retained.push(item);
        continue;
      }
      unsavedSeen += 1;
      if (unsavedSeen <= 10) retained.push(item);
      else expired.push(item);
    }
    const referenced = new Set(retained.map((item) => item.imagePath));
    for (const item of expired) {
      if (referenced.has(item.imagePath)) continue;
      await unlink(path.join(userDirectory(userId), item.imagePath)).catch(
        () => undefined,
      );
    }
    await writeIndex(userId, retained);
    return created;
  });
}

export async function listHistory(userId: number) {
  return readIndex(userId);
}

export async function findHistory(userId: number, id: string) {
  return (await readIndex(userId)).find((item) => item.id === id) || null;
}

export async function deleteHistory(userId: number, id: string) {
  return withUserLock(userId, async () => {
    const items = await readIndex(userId);
    const item = items.find((entry) => entry.id === id);
    if (!item) return false;
    const remaining = items.filter((entry) => entry.id !== id);
    if (!remaining.some((entry) => entry.imagePath === item.imagePath))
      await unlink(path.join(userDirectory(userId), item.imagePath)).catch(
        () => undefined,
      );
    await writeIndex(userId, remaining);
    return true;
  });
}

export function historyImagePath(userId: number, fileName: string) {
  return path.join(userDirectory(userId), path.basename(fileName));
}
