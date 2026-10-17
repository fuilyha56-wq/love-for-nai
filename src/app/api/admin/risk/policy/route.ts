import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody } from "@/lib/request";
import { getRiskPolicy, updateRiskPolicy, recordRiskAction, type RiskPolicy } from "@/lib/risk-control";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  return NextResponse.json({ policy: await getRiskPolicy(), readiness: { promptFingerprint: Boolean(process.env.LFN_RISK_HASH_SECRET?.trim()) } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ message: "风控策略必须为对象" }, { status: 400 });
    const before = await getRiskPolicy();
    const policy = await updateRiskPolicy(body as Partial<RiskPolicy>);
    await recordRiskAction({ action: "policy-update", operatorUserId: gate.session.userId, operatorUsername: gate.session.username,
      targetUserId: 0, reason: "管理员更新封控条例", before, after: policy, affectedUserIds: [] });
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "风控策略保存失败" }, { status: 400 });
  }
}