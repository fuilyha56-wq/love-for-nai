import { galleryComments } from "@/lib/gallery-comments";
import { galleryCommentAccess } from "@/lib/gallery-comment-access";
import { deleteCommentNotifications } from "@/lib/notifications";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; commentId: string }> }) {
  const { id, commentId } = await context.params;
  const access = await galleryCommentAccess(id);
  if (!access) return Response.json({ message: "作品不存在" }, { status: 404 });
  if (!access.session) return Response.json({ message: "请先登录" }, { status: 401 });
  const item = await galleryComments.getComment(id, commentId);
  if (!item) return Response.json({ message: "评论不存在" }, { status: 404 });
  if (!access.canModerate && item.authorId !== access.session.userId) return Response.json({ message: "只能删除自己的评论" }, { status: 403 });
  const deletedIds = await galleryComments.deleteCommentTree(id, commentId, access.canModerate ? undefined : access.session.userId);
  await deleteCommentNotifications("gallery", deletedIds);
  return Response.json({ deletedIds, success: true }, { headers: { "Cache-Control": "private, no-store" } });
}
