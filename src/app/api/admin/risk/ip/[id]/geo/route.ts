import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { queryIpGeo } from "@/lib/risk-ip";
import { recordRiskAction } from "@/lib/risk-control";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const evidenceId = (await context.params).id;
  const geo = await queryIpGeo(evidenceId);
  if (!geo) return NextResponse.json({ message: "未配置可用的 IP 归属地 Provider，或查询失败" }, { status: 503 });
  await recordRiskAction({ action: "reveal-ip", operatorUsername: gate.session.username, targetUserId: 0, reason: "管理员查询 IP 归属地", before: {}, after: { evidenceId, provider: geo.provider }, affectedUserIds: [] });
  return NextResponse.json({ geo }, { headers: { "Cache-Control": "no-store" } });
}