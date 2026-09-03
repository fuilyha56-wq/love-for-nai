import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_COMMENT_COUNT = 10_000;

export type AnnouncementComment = {
  id: string;
  announcementId: string;
  authorId: number;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type Store = { items: AnnouncementComment[] };

const root = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "announcements",
  );
const storePath = () => path.join(root(), "comments.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<Store> {
  try {
    const value = JSON.parse(await readFile(storePath(), "utf8")) as Store;
    return { items: Array.isArray(value.items) ? value.items : [] };
  } catch {
    return { items: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, target);
}

/** 校验并规范化评论正文，作者和时间字段始终由服务端生成。 */
export function assertCommentContent(value: unknown): string {
  if (typeof value !== "string") throw new Error("评论内容不能为空");
  const content = value.trim();
  if (!content) throw new Error("评论内容不能为空");
  if (Array.from(content).length > MAX_COMMENT_LENGTH)
    throw new Error(`评论内容不能超过 ${MAX_COMMENT_LENGTH} 个字符`);
  return content;
}

export async function listAnnouncementComments(
  announcementId: string,
): Promise<AnnouncementComment[]> {
  const items = (await readStore()).items.filter(
    (item) => item.announcementId === announcementId,
  );
  return items.sort((a, b) => {
    const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
    return byCreatedAt || a.id.localeCompare(b.id);
  });
}

export type CreateAnnouncementCommentInput = {
  announcementId: string;
  authorId: number;
  authorName: string;
  content: string;
};

export async function createAnnouncementComment(
  input: CreateAnnouncementCommentInput,
): Promise<AnnouncementComment> {
  return withLock(async () => {
    const { announcementId, authorId, authorName, content } = input;
    if (!announcementId) throw new Error("缺少公告 id");
    if (!Number.isInteger(authorId) || authorId <= 0)
      throw new Error("用户 id 不合法");
    const normalizedName = authorName.trim().slice(0, 80);
    if (!normalizedName) throw new Error("用户名称不能为空");
    const normalizedContent = assertCommentContent(content);
    const now = new Date().toISOString();
    const comment: AnnouncementComment = {
      id: randomUUID(),
      announcementId,
      authorId,
      authorName: normalizedName,
      content: normalizedContent,
      createdAt: now,
      updatedAt: now,
    };
    const store = await readStore();
    if (store.items.length >= MAX_COMMENT_COUNT)
      throw new Error("评论区暂时已满，请联系管理员清理");
    store.items.push(comment);
    await writeStore(store);
    return comment;
  });
}

export async function deleteAnnouncementComment(
  announcementId: string,
  commentId: string,
): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.items.length;
    store.items = store.items.filter(
      (item) =>
        !(item.id === commentId && item.announcementId === announcementId),
    );
    if (store.items.length === before) return false;
    await writeStore(store);
    return true;
  });
}

export async function countAnnouncementComments(): Promise<number> {
  return (await readStore()).items.length;
}

/** 公告删除时级联清理其全部评论，避免孤儿数据占用评论配额。 */
export async function deleteCommentsForAnnouncement(
  announcementId: string,
): Promise<number> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.items.length;
    store.items = store.items.filter(
      (item) => item.announcementId !== announcementId,
    );
    if (store.items.length === before) return 0;
    await writeStore(store);
    return before - store.items.length;
  });
}
