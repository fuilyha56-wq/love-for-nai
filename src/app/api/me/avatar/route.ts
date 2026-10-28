import { getSession } from "@/lib/session";
import { AVATAR_COST, MAX_AVATAR_BYTES, saveAvatar } from "@/lib/avatars";
import { affStatus, getUserAvatar } from "@/lib/aff";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ message: "请先登录" }, { status: 401 });
  return Response.json({ avatar: await getUserAvatar(session.userId), cost: AVATAR_COST, balance: (await affStatus(session.userId)).balance }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ message: "请先登录后修改头像" }, { status: 401 });
  try {
    const limit = MAX_AVATAR_BYTES + 128 * 1024;
    if (!request.body || Number(request.headers.get("content-length")) > limit) return Response.json({ message: "头像图片不能超过 5 MB" }, { status: 413 });
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); return Response.json({ message: "头像图片不能超过 5 MB" }, { status: 413 }); } chunks.push(value); }
    const data = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const form = await new Response(data, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file"), requestId = String(form.get("requestId") || "");
    if (!(file instanceof File)) return Response.json({ message: "请选择头像图片" }, { status: 400 });
    const result = await saveAvatar(session.userId, Buffer.from(await file.arrayBuffer()), requestId, { x: Number(form.get("x") || 0), y: Number(form.get("y") || 0), zoom: Number(form.get("zoom") || 1) });
    return Response.json({ ...result, avatarUrl: `/api/users/${session.userId}/avatar?v=${result.avatar.hash}` }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "头像保存失败，请重试" }, { status: 400 }); }
}
