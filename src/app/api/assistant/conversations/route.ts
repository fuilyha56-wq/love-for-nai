import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createConversationSession, deleteConversationSession, isAssistantConversationId, listConversationSessions, renameConversationSession } from "@/lib/assistant-conversations";
import { cancelConversationJobs } from "@/lib/assistant-jobs";

const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 4096) throw new Error("会话请求不能超过 4 KB");
  if (!request.body) throw new Error("会话请求格式不正确");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("会话请求不能超过 4 KB");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("会话请求格式不正确");
  return body as Record<string, unknown>;
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof SyntaxError || /会话请求|会话名称|会话 ID/.test(message)) return json({ message: message || "会话请求格式不正确" }, 400);
  if (message.includes("不存在或已删除")) return json({ message }, 404);
  if (message.includes("最多保留")) return json({ message }, 409);
  return json({ message: "会话操作失败，请稍后重试" }, 500);
}

export async function GET() {
  const session = await getSession();
  if (!session) return json({ message: "请先登录后使用助手会话", sessionExpired: true }, 401);
  try { return json({ ownerId: session.userId, sessions: await listConversationSessions(session.userId) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return json({ message: "请先登录后使用助手会话", sessionExpired: true }, 401);
  try {
    const body = await readBody(request);
    if (typeof body.title !== "string") return json({ message: "请填写会话名称" }, 400);
    return json({ session: await createConversationSession(session.userId, body.title) }, 201);
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return json({ message: "请先登录后使用助手会话", sessionExpired: true }, 401);
  try {
    const body = await readBody(request);
    if (!isAssistantConversationId(body.id) || typeof body.title !== "string") return json({ message: "会话 ID 或名称无效" }, 400);
    return json({ session: await renameConversationSession(session.userId, body.id, body.title) });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return json({ message: "请先登录后使用助手会话", sessionExpired: true }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!isAssistantConversationId(id)) return json({ message: "会话 ID 无效" }, 400);
  try {
    // Validate ownership before stopping work; a deleted session cannot be recreated by a late result.
    if (!(await listConversationSessions(session.userId)).some((entry) => entry.id === id)) return json({ message: "会话不存在或已删除" }, 404);
    cancelConversationJobs(session.userId, id);
    await deleteConversationSession(session.userId, id);
    return json({ success: true });
  } catch (error) { return failure(error); }
}
