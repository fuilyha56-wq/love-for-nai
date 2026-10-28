import { galleryComments } from "@/lib/gallery-comments";
import { galleryCommentAccess } from "@/lib/gallery-comment-access";
import { readCommentBody } from "@/lib/comment-request";
import { getCommentPreferences } from "@/lib/comment-preferences";
import { createUserNotification, deleteUserNotificationByDedupeKey } from "@/lib/notifications";
import { SlidingWindowRateLimiter } from "@/lib/rate-limit";

const limiter = new SlidingWindowRateLimiter({ limit: 8, windowMs: 10 * 60_000 });
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const access = await galleryCommentAccess(id);
  if (!access) return Response.json({ message: "作品不存在" }, { status: 404 });
  return Response.json({ items: await galleryComments.listComments(id, access.session?.userId), viewerId: access.session?.userId || null, canModerate: access.canModerate, preferences: await getCommentPreferences(access.session?.userId) }, { headers });
}
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const access = await galleryCommentAccess(id);
  if (!access) return Response.json({ message: "作品不存在" }, { status: 404 });
  const session = access.session;
  if (!session) return Response.json({ message: "请先登录后评论" }, { status: 401 });
  const rate = limiter.check(String(session.userId));
  if (!rate.allowed) return Response.json({ message: "评论发布太频繁，请稍后再试" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  try {
    const body = await readCommentBody(request);
    const parentId = typeof body.parentId === "string" ? body.parentId : null;
    const comment = await galleryComments.createComment({ resourceId: id, authorId: session.userId, authorName: session.displayName || session.username, content: typeof body.content === "string" ? body.content : "", parentId });
    const parent = parentId ? await galleryComments.getComment(id, parentId) : null;
    const recipients = new Map<number, { title: string; type: "gallery-comment" | "gallery-reply"; kind: string }>();
    recipients.set(session.userId, { title: `我在《${access.item.title}》发表了评论`, type: "gallery-comment", kind: "self" });
    if (access.item.ownerId !== session.userId) recipients.set(access.item.ownerId, { title: `${comment.authorName} 评论了你的作品`, type: "gallery-comment", kind: "owner" });
    if (parent && parent.authorId !== session.userId) recipients.set(parent.authorId, { title: `${comment.authorName} 回复了你的评论`, type: "gallery-reply", kind: "reply" });
    await Promise.allSettled([...recipients].map(([userId, notice]) => createUserNotification({ userId, type: notice.type, title: notice.title, body: comment.content.slice(0, 220), href: `/gallery/${encodeURIComponent(id)}?comment=${encodeURIComponent(comment.id)}#comments`, dedupeKey: `gallery-${notice.kind}:${comment.id}` })));
    return Response.json({ item: comment }, { headers });
  } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "评论发布失败" }, { status: 400 }); }
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const access = await galleryCommentAccess(id);
  if (!access) return Response.json({ message: "作品不存在" }, { status: 404 });
  if (!access.session) return Response.json({ message: "请先登录" }, { status: 401 });
  try {
    const body = await readCommentBody(request);
    const commentId = typeof body.commentId === "string" ? body.commentId : "";
    const before = await galleryComments.getComment(id, commentId, access.session.userId);
    if (!before) return Response.json({ message: "评论不存在" }, { status: 404 });
    if (body.action === "vote" && (body.vote === "up" || body.vote === "down" || body.vote === null)) {
      const item = await galleryComments.setCommentVote(id, commentId, access.session.userId, body.vote);
      const dedupeKey = `gallery-like:${commentId}:${access.session.userId}`;
      if (body.vote === "up" && before.myVote !== "up" && before.authorId !== access.session.userId) await createUserNotification({ userId: before.authorId, type: "comment-like", title: `${access.session.displayName || access.session.username} 赞了你的评论`, body: before.content.slice(0, 220), href: `/gallery/${encodeURIComponent(id)}?comment=${encodeURIComponent(commentId)}#comments`, dedupeKey }).catch(() => undefined);
      if (body.vote !== "up") await deleteUserNotificationByDedupeKey(before.authorId, dedupeKey).catch(() => undefined);
      return Response.json({ item }, { headers });
    }
    if (body.action === "pin" && typeof body.pinned === "boolean") {
      if (!access.canModerate) return Response.json({ message: "仅作品作者或管理员可置顶评论" }, { status: 403 });
      return Response.json({ item: await galleryComments.setCommentPinned(id, commentId, body.pinned) }, { headers });
    }
    return Response.json({ message: "评论操作无效" }, { status: 400 });
  } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "评论操作失败" }, { status: 400 }); }
}
