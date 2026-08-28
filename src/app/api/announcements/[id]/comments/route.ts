import { NextResponse } from "next/server";
import { SlidingWindowRateLimiter } from "@/lib/rate-limit";
import {
  createAnnouncementComment,
  listAnnouncementComments,
} from "@/lib/announcement-comments";
import { ensureSeed, getAnnouncement } from "@/lib/announcements";
import {
  invalidJsonResponse,
  optionalString,
  InvalidJsonError,
} from "@/lib/request";
import { getSession } from "@/lib/session";

const commentLimiter = new SlidingWindowRateLimiter({
  limit: 8,
  windowMs: 10 * 60_000,
  maxKeys: 10_000,
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const announcementId = (await params).id;
  await ensureSeed();
  if (!(await getAnnouncement(announcementId)))
    return NextResponse.json({ message: "公告不存在" }, { status: 404 });
  return NextResponse.json({
    items: await listAnnouncementComments(announcementId),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const announcementId = (await params).id;
  const rate = commentLimiter.check(`user:${session.userId}`);
  if (!rate.allowed)
    return NextResponse.json(
      { message: "评论发布太频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  await ensureSeed();
  if (!(await getAnnouncement(announcementId)))
    return NextResponse.json({ message: "公告不存在" }, { status: 404 });

  // 单条评论最多 2000 字。对请求体流本身限字节：Content-Length 头可被
  // chunked/HTTP2 请求省略，不能只靠 header 判断。
  const MAX_BODY_BYTES = 32 * 1024;
  const declaredLength = Number(request.headers.get("content-length") || "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
    return NextResponse.json({ message: "评论内容过长" }, { status: 413 });
  let rawBody: string;
  try {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES)
      return NextResponse.json({ message: "评论内容过长" }, { status: 413 });
    rawBody = new TextDecoder().decode(buffer);
  } catch {
    return NextResponse.json({ message: "请求体读取失败" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new InvalidJsonError("请求体必须是 JSON 对象");
    body = parsed as Record<string, unknown>;
  } catch {
    return invalidJsonResponse(new InvalidJsonError("请求体不是合法的 JSON"));
  }

  try {
    const item = await createAnnouncementComment({
      announcementId,
      authorId: session.userId,
      authorName: session.displayName || session.username,
      content: optionalString(body.content) || "",
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "评论发布失败" },
      { status: 400 },
    );
  }
}
