import { getSession } from "@/lib/session";
import { getCommentPreferences, setCommentPreference } from "@/lib/comment-preferences";
import { readCommentBody } from "@/lib/comment-request";

export async function GET() {
  const session = await getSession();
  return Response.json(await getCommentPreferences(session?.userId), { headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ message: "请先登录后屏蔽评论" }, { status: 401 });
  const body = await readCommentBody(request).catch(() => null);
  const commentId = typeof body?.commentId === "string" && body.commentId.length <= 200 ? body.commentId : undefined;
  const authorId = typeof body?.authorId === "number" && Number.isSafeInteger(body.authorId) && body.authorId > 0 ? body.authorId : undefined;
  if (!body || typeof body.hidden !== "boolean" || (!commentId && !authorId)) return Response.json({ message: "屏蔽参数无效" }, { status: 400 });
  return Response.json(await setCommentPreference(session.userId, { commentId, authorId, hidden: body.hidden }), { headers: { "Cache-Control": "private, no-store" } });
}
