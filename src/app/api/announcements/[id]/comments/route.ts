import { NextResponse } from "next/server";
import { SlidingWindowRateLimiter, trustedClientKey } from "@/lib/rate-limit";
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
// GET 公开但会解析整个 comments.json，全站级限流防高频刷接口。
// UA 不能当客户端身份（同浏览器用户共享），只用可信 IP，否则全站共用一个桶。
const commentReadLimiter = new SlidingWindowRateLimiter({
  limit: 240,
  windowMs: 60_000,
  maxKeys: 1_000,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const readRate = commentReadLimiter.check(
    trustedClientKey(request) || "site",
  );
  if (!readRate.allowed)
    return NextResponse.json(
      { message: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(readRate.retryAfterSeconds) } },
    );
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

  // 单条评论最多 2000 字。流式读取并在超限时立即中止，避免超大请求体
  // 被整体读入内存（Content-Length 头可被 chunked/HTTP2 请求省略）。
  const MAX_BODY_BYTES = 32 * 1024;
  const declaredLength = Number(request.headers.get("content-length") || "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
    return NextResponse.json({ message: "评论内容过长" }, { status: 413 });
  let rawBody: string;
  try {
    if (!request.body) throw new Error("empty body");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return NextResponse.json({ message: "评论内容过长" }, { status: 413 });
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    rawBody = new TextDecoder().decode(merged);
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
