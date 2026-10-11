import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { optionalString, parseJsonBody } from "@/lib/request";
import { getIpEvidence, revealIpEvidence } from "@/lib/risk-ip";
import { recordRiskAction } from "@/lib/risk-control";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  if (process.env.LFN_IP_RAW_REVEAL_ENABLED !== "true")
    return NextResponse.json({ message: "完整 IP 查询未启用" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await parseJsonBody(request); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "请求体无效" }, { status: 400 }); }
  const reason = optionalString(body.reason)?.trim();
  if (!reason) return NextResponse.json({ message: "完整 IP 查询必须填写原因" }, { status: 400 });
  const evidenceId = (await context.params).id;
  const evidence = await getIpEvidence(evidenceId);
  const ip = evidence ? await revealIpEvidence(evidenceId) : null;
  if (!ip) return NextResponse.json({ message: "IP 证据不存在或无法解密" }, { status: 404 });
  await recordRiskAction({
    action: "reveal-ip",
    operatorUsername: gate.session.username,
    targetUserId: evidence?.userId || 0,
    reason: reason.slice(0, 500),
    before: { evidenceId },
    after: { revealed: true },
    affectedUserIds: evidence?.userId ? [evidence.userId] : [],
  });
  return NextResponse.json({ ip, operator: gate.session.username }, { headers: { "Cache-Control": "no-store" } });
}