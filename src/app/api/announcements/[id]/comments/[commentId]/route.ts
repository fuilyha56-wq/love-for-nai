import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteAnnouncementCommentTree, getAnnouncementComment } from "@/lib/announcement-comments";
import { getSession } from "@/lib/session";
import { deleteCommentNotifications } from "@/lib/notifications";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const { id, commentId } = await params;
  const target = await getAnnouncementComment(id, commentId);
  if (!target) return NextResponse.json({ message: "评论不存在" }, { status: 404 });
  const gate = await requireAdmin();
  const admin = !("error" in gate);
  if (!admin && target.authorId !== session.userId) return NextResponse.json({ message: "只能删除自己的评论；其他评论可以屏蔽" }, { status: 403 });
  const deletedIds = await deleteAnnouncementCommentTree(id, commentId, admin ? undefined : session.userId);
  await deleteCommentNotifications("announcement", deletedIds);
  return NextResponse.json({ success: true, deletedIds }, { headers: { "Cache-Control": "private, no-store" } });
}
