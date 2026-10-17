import { validRiskMutation } from "@/lib/risk-http";
import { getSession } from "@/lib/session";
import { rebindFreeGrant, riskAdmissionResponse, riskUserSnapshot } from "@/lib/light-risk";
import { recordRiskAction } from "@/lib/risk-control";
export async function GET() {
  const session = await getSession(); if (!session) return Response.json({ message: "请先登录" }, { status: 401 });
  const snapshot = await riskUserSnapshot(session.userId);
  return Response.json({ grant: snapshot.grant, grade: snapshot.grade, restrictions: snapshot.restrictions.map(r => ({ id: r.id, reason: r.reason, expiresAt: r.expiresAt })) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const session = await getSession(); if (!session) return Response.json({ message: "请先登录" }, { status: 401 });
  if (!validRiskMutation(request)) return Response.json({ message: "请从本站账号安全页确认换绑" }, { status: 403 });
  try {
    const grant = await rebindFreeGrant(session.userId, request, session.authenticatedAt || 0);
    await recordRiskAction({ action: "policy-update", targetUserId: session.userId, operatorUserId: session.userId, reason: "用户确认当日免费网络授权换绑", before: {}, after: { grantId: grant.id, version: grant.version, rebinds: grant.rebinds }, affectedUserIds: [session.userId] });
    return Response.json({ grant });
  } catch (e) { return riskAdmissionResponse(e) || Response.json({ message: "换绑服务暂时不可用" }, { status: 503 }); }
}
