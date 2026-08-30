import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteRemoteHistoryImage,
  putRemoteHistoryImage,
} from "@/lib/remote-history";

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
  // 图片实体存放在远程二级存储（本地已无文件），读取时走远程接口。
  remote?: boolean;
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
  const excluded = new Set([
    "image",
    "mask",
    "reference_image",
    "reference_images",
    "references",
    "characters",
    "characterPrompts",
    "source",
  ]);
  return Object.fromEntries(
    Object.keys(body)
      .filter((key) => !excluded.has(key) && body[key] !== undefined)
      .map((key) => [key, body[key]]),
  ) as GenerationParameters;
}

// 历史分层保留：最新 LOCAL_HISTORY_LIMIT 张留在主服务器磁盘；
// 更旧的最多 REMOTE_HISTORY_LIMIT 张转存远程二级存储；超过两层总量
// 的最旧条目连同远程文件一起删除。
const LOCAL_HISTORY_LIMIT = 40;
const REMOTE_HISTORY_LIMIT = 60;

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
      const buffer = Buffer.from(match[2], "base64");
      await writeFile(path.join(userDirectory(userId), fileName), buffer);
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
    const toRemote: HistoryItem[] = [];
    const expired: HistoryItem[] = [];
    for (const item of merged) {
      if (item.saved) {
        retained.push(item);
        continue;
      }
      unsavedSeen += 1;
      if (unsavedSeen <= LOCAL_HISTORY_LIMIT && !item.remote) {
        retained.push(item);
      } else if (
        unsavedSeen <= LOCAL_HISTORY_LIMIT + REMOTE_HISTORY_LIMIT &&
        !item.remote
      ) {
        // 本地层留不下但仍在远程层配额内：文件转存远程，索引保留。
        const localFile = path.join(userDirectory(userId), item.imagePath);
        const data = await readFile(localFile).catch(() => null);
        const uploadOk = data
          ? await putRemoteHistoryImage(userId, item.imagePath, data)
          : false;
        if (uploadOk) {
          await unlink(localFile).catch(() => undefined);
          toRemote.push({ ...item, remote: true });
        } else {
          // 远程不可用时退回旧行为：直接过期删除，不阻塞生成流程。
          expired.push(item);
        }
      } else if (unsavedSeen <= LOCAL_HISTORY_LIMIT + REMOTE_HISTORY_LIMIT) {
        // 已在远程层的条目直接沿用（文件早已在远程）。
        toRemote.push(item);
      } else {
        expired.push(item);
      }
    }
    // 已在远程层、但被新一轮挤出总量配额的旧条目：删远程文件。
    const remoteRetained = new Set(toRemote.map((item) => item.imagePath));
    for (const item of expired) {
      if (item.remote && !remoteRetained.has(item.imagePath)) {
        await deleteRemoteHistoryImage(userId, item.imagePath);
        continue;
      }
      await unlink(path.join(userDirectory(userId), item.imagePath)).catch(
        () => undefined,
      );
    }
    // 本地索引：保留 + 新转远程的条目，顺序保持最新在前。
    const remoteIndex = toRemote.map((item) => item);
    await writeIndex(userId, [...retained, ...remoteIndex]);
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
    if (!remaining.some((entry) => entry.imagePath === item.imagePath)) {
      if (item.remote)
        await deleteRemoteHistoryImage(userId, item.imagePath);
      else
        await unlink(
          path.join(userDirectory(userId), item.imagePath),
        ).catch(() => undefined);
    }
    await writeIndex(userId, remaining);
    return true;
  });
}

export function historyImagePath(userId: number, fileName: string) {
  return path.join(userDirectory(userId), path.basename(fileName));
}
