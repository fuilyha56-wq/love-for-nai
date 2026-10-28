import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { invalidateCachedJsonFile, readCachedJsonFile } from "@/lib/server-json-cache";

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_COMMENT_COUNT = 10_000;
export type CommentVote = "up" | "down";
export type DiscussionComment = {
  id: string;
  resourceId: string;
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
type StoredComment = Omit<DiscussionComment, "likes" | "dislikes" | "myVote"> & {
  votes: Record<string, CommentVote>;
};
type Store = { items: StoredComment[] };

export function createCommentStore(directory: "announcements" | "gallery", legacyField: "announcementId" | "galleryId") {
const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), directory);
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
      const value = raw as { items?: Array<Partial<StoredComment> & Pick<StoredComment, "id" | "resourceId" | "authorId" | "authorName" | "content" | "createdAt" | "updatedAt">> };
      const items = Array.isArray(value?.items) ? value.items : [];
      return { items: items.map((item) => ({
        ...item,
        resourceId: typeof item.resourceId === "string" ? item.resourceId : String((item as unknown as Record<string, unknown>)[legacyField] || ""),
        parentId: typeof item.parentId === "string" ? item.parentId : null,
        pinned: item.pinned === true,
        votes: item.votes && typeof item.votes === "object" ? item.votes : {},
      })) as StoredComment[] };
    }, { clone: !readOnly });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { items: [] };
    throw new Error("评论数据读取失败");
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ items: store.items.map(item => ({ ...item, [legacyField]: item.resourceId })) }, null, 2), "utf8");
  await rename(temporary, target);
  invalidateCachedJsonFile(target);
}

function publicComment(item: StoredComment, viewerId?: number): DiscussionComment {
  const votes = Object.values(item.votes || {});
  return {
    id: item.id, resourceId: item.resourceId, parentId: item.parentId || null,
    authorId: item.authorId, authorName: item.authorName, content: item.content,
    createdAt: item.createdAt, updatedAt: item.updatedAt, pinned: item.pinned === true,
    likes: votes.filter((vote) => vote === "up").length,
    dislikes: votes.filter((vote) => vote === "down").length,
    myVote: viewerId ? item.votes?.[String(viewerId)] || null : null,
  };
}

/** 校验并规范化评论正文，作者和时间字段始终由服务端生成。 */
function assertCommentContent(value: unknown): string {
  if (typeof value !== "string") throw new Error("评论内容不能为空");
  const content = value.trim();
  if (!content) throw new Error("评论内容不能为空");
  if (Array.from(content).length > MAX_COMMENT_LENGTH) throw new Error(`评论内容不能超过 ${MAX_COMMENT_LENGTH} 个字符`);
  return content;
}

async function listComments(resourceId: string, viewerId?: number): Promise<DiscussionComment[]> {
  const items = (await readStore(true)).items.filter((item) => item.resourceId === resourceId);
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((item) => publicComment(item, viewerId));
}

async function getComment(resourceId: string, commentId: string, viewerId?: number): Promise<DiscussionComment | null> {
  const item = (await readStore(true)).items.find((comment) => comment.id === commentId && comment.resourceId === resourceId);
  return item ? publicComment(item, viewerId) : null;
}

type CreateCommentInput = {
  resourceId: string;
  authorId: number;
  authorName: string;
  content: string;
  parentId?: string | null;
};

async function createComment(input: CreateCommentInput): Promise<DiscussionComment> {
  return withLock(async () => {
    const { resourceId, authorId, authorName, content } = input;
    if (!resourceId) throw new Error("缺少评论所属页面");
    if (!Number.isInteger(authorId) || authorId <= 0) throw new Error("用户 id 不合法");
    const normalizedName = authorName.trim().slice(0, 80);
    if (!normalizedName) throw new Error("用户名称不能为空");
    const normalizedContent = assertCommentContent(content);
    const store = await readStore();
    if (input.parentId && !store.items.some((item) => item.id === input.parentId && item.resourceId === resourceId))
      throw new Error("回复的评论不存在");
    let parent = input.parentId;
    let depth = 0;
    while (parent) {
      if (++depth > 8) throw new Error("回复层级过多，请回复主评论");
      parent = store.items.find(item => item.id === parent && item.resourceId === resourceId)?.parentId;
    }
    if (store.items.length >= MAX_COMMENT_COUNT) throw new Error("评论区暂时已满，请联系管理员清理");
    const now = new Date().toISOString();
    const item: StoredComment = {
      id: randomUUID(), resourceId, parentId: input.parentId || null,
      authorId, authorName: normalizedName, content: normalizedContent,
      createdAt: now, updatedAt: now, pinned: false, votes: {},
    };
    store.items.push(item);
    await writeStore(store);
    return publicComment(item, authorId);
  });
}

async function setCommentVote(resourceId: string, commentId: string, userId: number, vote: CommentVote | null): Promise<DiscussionComment | null> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((comment) => comment.id === commentId && comment.resourceId === resourceId);
    if (!item) return null;
    item.votes ||= {};
    if (vote) item.votes[String(userId)] = vote;
    else delete item.votes[String(userId)];
    item.updatedAt = new Date().toISOString();
    await writeStore(store);
    return publicComment(item, userId);
  });
}

async function setCommentPinned(resourceId: string, commentId: string, pinned: boolean): Promise<DiscussionComment | null> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((comment) => comment.id === commentId && comment.resourceId === resourceId);
    if (!item) return null;
    item.pinned = pinned;
    item.updatedAt = new Date().toISOString();
    await writeStore(store);
    return publicComment(item);
  });
}

async function deleteCommentTree(resourceId: string, commentId: string, authorId?: number): Promise<string[]> {
  return withLock(async () => {
    const store = await readStore();
    const target = store.items.find((item) => item.id === commentId && item.resourceId === resourceId);
    if (!target || (authorId != null && target.authorId !== authorId)) return [];
    const ids = new Set([target.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of store.items) if (item.resourceId === resourceId && item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
    store.items = store.items.filter((item) => !ids.has(item.id));
    await writeStore(store);
    return [...ids];
  });
}

async function deleteOwnComment(resourceId: string, commentId: string, authorId: number): Promise<boolean> {
  return (await deleteCommentTree(resourceId, commentId, authorId)).length > 0;
}

async function deleteComment(resourceId: string, commentId: string): Promise<boolean> {
  return (await deleteCommentTree(resourceId, commentId)).length > 0;
}

async function countComments(): Promise<number> {
  return (await readStore(true)).items.length;
}

/** 公告删除时级联清理其全部评论，避免孤儿数据占用评论配额。 */
async function deleteCommentsForResource(resourceId: string): Promise<number> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.items.length;
    store.items = store.items.filter((item) => item.resourceId !== resourceId);
    if (store.items.length === before) return 0;
    await writeStore(store);
    return before - store.items.length;
  });
}

return { listComments, getComment, createComment, setCommentVote, setCommentPinned, deleteCommentTree, deleteOwnComment, deleteComment, countComments, deleteCommentsForResource, assertCommentContent };
}
