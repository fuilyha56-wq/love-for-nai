import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody } from "@/lib/request";
import { cleanIdleNewApiSessions, sessionCleanupStatus, updateSessionCleanupPolicy, type SessionCleanupPolicy } from "@/lib/session-cleanup";

export async function GET() {
  const gate = await requireAdmin(); if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  return NextResponse.json(await sessionCleanupStatus(), { headers: { "Cache-Control": "private, no-store" } });
}
export async function PUT(request: Request) {
  const gate = await requireAdmin(); if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try { await updateSessionCleanupPolicy(await parseJsonBody<SessionCleanupPolicy>(request)); return NextResponse.json(await sessionCleanupStatus()); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "保存失败" }, { status: 400 }); }
}
export async function POST() {
  const gate = await requireAdmin(); if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try { const result = await cleanIdleNewApiSessions(); if (!result) return NextResponse.json({ message: "未接入上游会话数据库，或另一个实例正在清理" }, { status: 409 }); return NextResponse.json(await sessionCleanupStatus()); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "清理失败" }, { status: 503 }); }
}
