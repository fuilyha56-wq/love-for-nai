import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError } from "@/lib/newapi";
import { loadAssistantCatalog } from "@/lib/assistant-catalog";

export async function GET() {
  const session = await getSession();
  const headers = { "Cache-Control": "private, no-store" };
  if (!session) return NextResponse.json({ message: "请先登录后选择智能助手模型", sessionExpired: true }, { status: 401, headers });
  try {
    return NextResponse.json(await loadAssistantCatalog(session), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取可用模型";
    if (isUpstreamAuthError(message)) return NextResponse.json({ message: "登录状态已过期，请重新登录", sessionExpired: true }, { status: 401, headers });
    return NextResponse.json({ message }, { status: 502, headers });
  }
}
