import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteAnnouncementComment } from "@/lib/announcement-comments";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  const { id: announcementId, commentId } = await params;
  const ok = await deleteAnnouncementComment(announcementId, commentId);
  if (!ok) return NextResponse.json({ message: "评论不存在" }, { status: 404 });
  return NextResponse.json({ success: true });
}
