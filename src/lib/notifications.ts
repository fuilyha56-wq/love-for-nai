import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type UserNotification = {
  id: string;
  userId: number;
  type: "announcement-reply" | "gallery-comment" | "gallery-reply" | "comment-like" | "creator-reward" | "system";
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
  dedupeKey?: string;
};

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "notifications");
// Route bundles can load separate module instances. Share the queue so creating
// a message cannot write an old snapshot over another route's read receipt.
const notificationRuntime = globalThis as typeof globalThis & { __lfnNotificationLocks?: Map<string, Promise<unknown>> };
const locks = (notificationRuntime.__lfnNotificationLocks ??= new Map<string, Promise<unknown>>());

function withUserLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const key = filePath(userId);
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.then(task, task);
  const settled = current.catch(() => undefined);
  locks.set(key, settled);
  void settled.then(() => { if (locks.get(key) === settled) locks.delete(key); });
  return current;
}

function filePath(userId: number) { return path.join(root(), `${userId}.json`); }

async function read(userId: number): Promise<UserNotification[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath(userId), "utf8")) as { items?: UserNotification[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch { return []; }
}

async function write(userId: number, items: UserNotification[]) {
  await mkdir(root(), { recursive: true });
  const target = filePath(userId);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ items: items.slice(0, 500) }, null, 2), "utf8");
  await rename(temp, target);
}

export async function createUserNotification(input: Omit<UserNotification, "id" | "createdAt" | "readAt"> & { createdAt?: string }) {
  if (!Number.isInteger(input.userId) || input.userId <= 0) return null;
  return withUserLock(input.userId, async () => {
    const items = await read(input.userId);
    if (input.dedupeKey) {
      const existing = items.find((item) => item.dedupeKey === input.dedupeKey);
      if (existing) return existing;
    }
    const item: UserNotification = {
      id: randomUUID(), userId: input.userId, type: input.type,
      title: input.title.trim().slice(0, 160), body: input.body.trim().slice(0, 1000),
      href: input.href.startsWith("/") && !input.href.startsWith("//") ? input.href.slice(0, 1000) : "/",
      createdAt: input.createdAt || new Date().toISOString(), readAt: null,
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey.slice(0, 200) } : {}),
    };
    items.unshift(item);
    await write(input.userId, items);
    return item;
  });
}

export async function listUserNotifications(userId: number, limit = 100) {
  const items = await read(userId);
  const visible = items.slice(0, Math.min(200, Math.max(1, Math.floor(limit))));
  return { items: visible, unreadCount: items.filter((item) => !item.readAt).length };
}

export async function markUserNotificationRead(userId: number, id?: string) {
  return withUserLock(userId, async () => {
    const items = await read(userId);
    const now = new Date().toISOString();
    let changed = false;
    for (const item of items) if ((!id || item.id === id) && !item.readAt) {
      item.readAt = now;
      changed = true;
    }
    if (changed) await write(userId, items);
    return { unreadCount: items.filter((item) => !item.readAt).length };
  });
}

export async function deleteUserNotificationByDedupeKey(userId: number, dedupeKey: string): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0 || !dedupeKey) return false;
  return withUserLock(userId, async () => {
    const items = await read(userId);
    const remaining = items.filter((item) => item.dedupeKey !== dedupeKey);
    if (remaining.length === items.length) return false;
    await write(userId, remaining);
    return true;
  });
}

export async function deleteCommentNotifications(scope: "gallery" | "announcement", commentIds: string[]) {
  let files: string[];
  try { files = await readdir(root()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const ids = new Set(commentIds);
  await Promise.all(files.filter(name => /^\d+\.json$/.test(name)).map(async name => {
    const userId = Number(name.slice(0, -5));
    await withUserLock(userId, async () => {
      const items = await read(userId);
      const next = items.filter(item => {
        const parts = item.dedupeKey?.split(":") || [];
        return !(parts[0]?.startsWith(scope) && ids.has(parts[1]));
      });
      if (next.length !== items.length) await write(userId, next);
    });
  }));
}
