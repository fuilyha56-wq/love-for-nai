import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "@/lib/announcements";
import { deleteCommentsForAnnouncement } from "@/lib/announcement-comments";
import { optionalString } from "@/lib/request";

export async function GET() {
  const items = await listAnnouncements();
  return NextResponse.json({ items });
}

function parseLevel(value: unknown): "info" | "warning" {
  return value === "warning" ? "warning" : "info";
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = optionalString(body.title)?.trim() || "";
  const content = optionalString(body.content)?.trim() || "";
  if (!title || !content)
    return NextResponse.json({ message: "标题和内容不能为空" }, { status: 400 });
  const item = await createAnnouncement({
    title: title.slice(0, 120),
    content,
    level: parseLevel(body.level),
    author: gate.session.displayName || gate.session.username,
    pinned: body.pinned === true,
  });
  return NextResponse.json({ item });
}

export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = optionalString(body.id) || "";
  if (!id) return NextResponse.json({ message: "缺少公告 id" }, { status: 400 });
  const titleInput = optionalString(body.title);
  const contentInput = optionalString(body.content);
  if (titleInput !== undefined && !titleInput.trim())
    return NextResponse.json({ message: "标题不能为空" }, { status: 400 });
  if (contentInput !== undefined && !contentInput.trim())
    return NextResponse.json({ message: "内容不能为空" }, { status: 400 });
  const item = await updateAnnouncement(id, {
    ...(titleInput !== undefined ? { title: titleInput.trim().slice(0, 120) } : {}),
    ...(contentInput !== undefined ? { content: contentInput.trim() } : {}),
    ...(body.level ? { level: parseLevel(body.level) } : {}),
    ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
  });
  if (!item) return NextResponse.json({ message: "公告不存在" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ message: "缺少公告 id" }, { status: 400 });
  const ok = await deleteAnnouncement(id);
  if (!ok) return NextResponse.json({ message: "公告不存在" }, { status: 404 });
  await deleteCommentsForAnnouncement(id).catch(() => undefined);
  return NextResponse.json({ success: true });
}
