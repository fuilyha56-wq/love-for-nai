import { readRiskJson, validRiskMutation } from "@/lib/risk-http";
import { requireAdmin } from "@/lib/admin-auth";
import { confirmRiskEvidence, releaseRiskRestriction, riskUserSnapshot } from "@/lib/light-risk";
import { recordRiskAction } from "@/lib/risk-control";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const gate = await requireAdmin(); if ("error" in gate) return Response.json({ message: gate.error }, { status: 403 });
  const id = Number((await context.params).id); if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ message: "账号无效" }, { status: 400 });
  return Response.json(await riskUserSnapshot(id), { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request, context: Context) {
  const gate = await requireAdmin(); if ("error" in gate) return Response.json({ message: gate.error }, { status: 403 });
  if (!validRiskMutation(request)) return Response.json({ message: "请求来源或格式无效" }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ message: "账号无效" }, { status: 400 });
  try {
    const body = await readRiskJson(request, 4096);
    if (body.action === "confirm-evidence") {
      if (body.confirmed !== true || typeof body.reason !== "string" || !body.reason.trim() || typeof body.rule !== "string" || typeof body.reference !== "string") throw new Error("请明确确认人工核验，填写原因和证据编号");
      await recordRiskAction({ action: "mark-risk", targetUserId: id, operatorUserId: gate.session.userId, reason: body.reason.slice(0, 500), before: {}, after: { rule: body.rule, verificationRequested: true }, affectedUserIds: [id] });
      return Response.json(await confirmRiskEvidence(id, body.rule, body.reference, gate.session.userId));
    }
    if (typeof body.reason !== "string" || !body.reason.trim() || typeof body.restrictionId !== "string") throw new Error("请提供处置ID和解除原因");
    const before = await riskUserSnapshot(id);
    if (!before.restrictions.some(r => r.id === body.restrictionId)) throw new Error("处置不存在或已经到期");
    await recordRiskAction({ action: "mark-false-positive", targetUserId: id, operatorUserId: gate.session.userId, reason: body.reason.slice(0, 500), before: { restrictionId: body.restrictionId }, after: { releaseRequested: true }, affectedUserIds: [id] });
    await releaseRiskRestriction(id, body.restrictionId);
    return Response.json(await riskUserSnapshot(id));
  } catch (e) { return Response.json({ message: e instanceof Error ? e.message : "操作失败" }, { status: 400 }); }
}
