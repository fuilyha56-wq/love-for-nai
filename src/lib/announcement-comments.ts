import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { invalidateCachedJsonFile, readCachedJsonFile } from "@/lib/server-json-cache";

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_COMMENT_COUNT = 10_000;
export type CommentVote = "up" | "down";
export type AnnouncementComment = {
  id: string;
  announcementId: string;
  parentId: string | null;
  authorId: number;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  likes: number;
  dislikes: number;
  myVote: CommentVote | null;
};
type StoredComment = Omit<AnnouncementComment, "likes" | "dislikes" | "myVote"> & {
  votes: Record<string, CommentVote>;
};
type Store = { items: StoredComment[] };

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "announcements");
const storePath = () => path.join(root(), "comments.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(readOnly = false): Promise<Store> {
  try {
    return await readCachedJsonFile(storePath(), (raw) => {
      const value = raw as { items?: Array<Partial<StoredComment> & Pick<StoredComment, "id" | "announcementId" | "authorId" | "authorName" | "content" | "createdAt" | "updatedAt">> };
      const items = Array.isArray(value?.items) ? value.items : [];
      return { items: items.map((item) => ({
        ...item,
        parentId: typeof item.parentId === "string" ? item.parentId : null,
        pinned: item.pinned === true,
        votes: item.votes && typeof item.votes === "object" ? item.votes : {},
      })) as StoredComment[] };
    }, { clone: !readOnly });
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
  invalidateCachedJsonFile(target);
}

function publicComment(item: StoredComment, viewerId?: number): AnnouncementComment {
  const votes = Object.values(item.votes || {});
  return {
    id: item.id, announcementId: item.announcementId, parentId: item.parentId || null,
    authorId: item.authorId, authorName: item.authorName, content: item.content,
    createdAt: item.createdAt, updatedAt: item.updatedAt, pinned: item.pinned === true,
    likes: votes.filter((vote) => vote === "up").length,
    dislikes: votes.filter((vote) => vote === "down").length,
    myVote: viewerId ? item.votes?.[String(viewerId)] || null : null,
  };
}

/** 校验并规范化评论正文，作者和时间字段始终由服务端生成。 */
export function assertCommentContent(value: unknown): string {
  if (typeof value !== "string") throw new Error("评论内容不能为空");
  const content = value.trim();
  if (!content) throw new Error("评论内容不能为空");
  if (Array.from(content).length > MAX_COMMENT_LENGTH) throw new Error(`评论内容不能超过 ${MAX_COMMENT_LENGTH} 个字符`);
  return content;
}

export async function listAnnouncementComments(announcementId: string, viewerId?: number): Promise<AnnouncementComment[]> {
  const items = (await readStore(true)).items.filter((item) => item.announcementId === announcementId);
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((item) => publicComment(item, viewerId));
}

export async function getAnnouncementComment(announcementId: string, commentId: string): Promise<AnnouncementComment | null> {
  const item = (await readStore(true)).items.find((comment) => comment.id === commentId && comment.announcementId === announcementId);
  return item ? publicComment(item) : null;
}

export type CreateAnnouncementCommentInput = {
  announcementId: string;
  authorId: number;
  authorName: string;
  content: string;
  parentId?: string | null;
};

export async function createAnnouncementComment(input: CreateAnnouncementCommentInput): Promise<AnnouncementComment> {
  return withLock(async () => {
    const { announcementId, authorId, authorName, content } = input;
    if (!announcementId) throw new Error("缺少公告 id");
    if (!Number.isInteger(authorId) || authorId <= 0) throw new Error("用户 id 不合法");
    const normalizedName = authorName.trim().slice(0, 80);
    if (!normalizedName) throw new Error("用户名称不能为空");
    const normalizedContent = assertCommentContent(content);
    const store = await readStore();
    if (input.parentId && !store.items.some((item) => item.id === input.parentId && item.announcementId === announcementId))
      throw new Error("回复的评论不存在");
    if (store.items.length >= MAX_COMMENT_COUNT) throw new Error("评论区暂时已满，请联系管理员清理");
    const now = new Date().toISOString();
    const item: StoredComment = {
      id: randomUUID(), announcementId, parentId: input.parentId || null,
      authorId, authorName: normalizedName, content: normalizedContent,
      createdAt: now, updatedAt: now, pinned: false, votes: {},
    };
    store.items.push(item);
    await writeStore(store);
    return publicComment(item, authorId);
  });
}

export async function setAnnouncementCommentVote(announcementId: string, commentId: string, userId: number, vote: CommentVote | null): Promise<AnnouncementComment | null> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((comment) => comment.id === commentId && comment.announcementId === announcementId);
    if (!item) return null;
    item.votes ||= {};
    if (vote) item.votes[String(userId)] = vote;
    else delete item.votes[String(userId)];
    item.updatedAt = new Date().toISOString();
    await writeStore(store);
    return publicComment(item, userId);
  });
}

export async function setAnnouncementCommentPinned(announcementId: string, commentId: string, pinned: boolean): Promise<AnnouncementComment | null> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((comment) => comment.id === commentId && comment.announcementId === announcementId);
    if (!item) return null;
    item.pinned = pinned;
    item.updatedAt = new Date().toISOString();
    await writeStore(store);
    return publicComment(item);
  });
}

export async function deleteAnnouncementCommentTree(announcementId: string, commentId: string): Promise<string[]> {
  return withLock(async () => {
    const store = await readStore();
    const target = store.items.find((item) => item.id === commentId && item.announcementId === announcementId);
    if (!target) return [];
    const ids = new Set([target.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of store.items) if (item.announcementId === announcementId && item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
    store.items = store.items.filter((item) => !ids.has(item.id));
    await writeStore(store);
    return [...ids];
  });
}

/** Delete only an author's own comment and keep its replies visible at the same thread level. */
export async function deleteOwnAnnouncementComment(announcementId: string, commentId: string, authorId: number): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const index = store.items.findIndex((item) => item.id === commentId && item.announcementId === announcementId && item.authorId === authorId);
    if (index < 0) return false;
    const [target] = store.items.splice(index, 1);
    for (const item of store.items) {
      if (item.announcementId === announcementId && item.parentId === target.id) item.parentId = target.parentId || null;
    }
    await writeStore(store);
    return true;
  });
}

export async function deleteAnnouncementComment(announcementId: string, commentId: string): Promise<boolean> {
  return (await deleteAnnouncementCommentTree(announcementId, commentId)).length > 0;
}

export async function countAnnouncementComments(): Promise<number> {
  return (await readStore(true)).items.length;
}

/** 公告删除时级联清理其全部评论，避免孤儿数据占用评论配额。 */
export async function deleteCommentsForAnnouncement(announcementId: string): Promise<number> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.items.length;
    store.items = store.items.filter((item) => item.announcementId !== announcementId);
    if (store.items.length === before) return 0;
    await writeStore(store);
    return before - store.items.length;
  });
}
