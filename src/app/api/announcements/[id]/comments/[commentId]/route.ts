import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteAnnouncementCommentTree, deleteOwnAnnouncementComment, listAnnouncementComments } from "@/lib/announcement-comments";
import { getSession } from "@/lib/session";
import { deleteUserNotificationByDedupeKey } from "@/lib/notifications";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const { id: announcementId, commentId } = await params;
  const before = await listAnnouncementComments(announcementId);
  const target = before.find((item) => item.id === commentId);
  if (!target) return NextResponse.json({ message: "评论不存在" }, { status: 404 });
  const gate = await requireAdmin();
  if (!("error" in gate)) {
    const ids = new Set([commentId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of before) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
    const deletedIds = await deleteAnnouncementCommentTree(announcementId, commentId);
    if (!deletedIds.length) return NextResponse.json({ message: "评论不存在" }, { status: 404 });
    const notices = before.filter((item) => ids.has(item.id) && item.parentId)
      .map((item) => ({ item, parent: before.find((candidate) => candidate.id === item.parentId) }))
      .filter((entry): entry is { item: typeof target; parent: typeof target } => Boolean(entry.parent && entry.parent.authorId !== entry.item.authorId));
    await Promise.allSettled(notices.map(({ item, parent }) => deleteUserNotificationByDedupeKey(parent.authorId, `announcement-reply:${item.id}`)));
    return NextResponse.json({ success: true, deletedIds }, { headers: { "Cache-Control": "no-store" } });
  }
  if (target.authorId !== session.userId)
    return NextResponse.json({ message: "只能删除自己的评论；其他评论可在本地隐藏" }, { status: 403 });
  const parent = target.parentId ? before.find((item) => item.id === target.parentId) : undefined;
  const deleted = await deleteOwnAnnouncementComment(announcementId, commentId, session.userId);
  if (!deleted) return NextResponse.json({ message: "评论已被删除" }, { status: 404 });
  if (parent && parent.authorId !== session.userId)
    await deleteUserNotificationByDedupeKey(parent.authorId, `announcement-reply:${commentId}`);
  const items = await listAnnouncementComments(announcementId, session.userId);
  return NextResponse.json({ success: true, deletedIds: [commentId], items }, { headers: { "Cache-Control": "no-store" } });
}
