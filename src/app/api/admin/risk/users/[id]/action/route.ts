import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody, optionalString } from "@/lib/request";
import { getRiskCaseForUser, markRiskCase, recordRiskAction, setRiskBlocked } from "@/lib/risk-control";
import { referralRiskComponent } from "@/lib/referral";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const userId = Number((await context.params).id);
  if (!Number.isInteger(userId) || userId <= 0)
    return NextResponse.json({ message: "用户 id 无效" }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await parseJsonBody(request); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "请求体无效" }, { status: 400 }); }
  const action = optionalString(body.action)?.trim();
  const reason = optionalString(body.reason)?.trim().slice(0, 500) || "管理员风控操作";
  const operator = gate.session.username;
  if (action === "mark") {
    const level = optionalString(body.level);
    if (level !== "watch" && level !== "risk" && level !== "critical")
      return NextResponse.json({ message: "风险等级无效" }, { status: 400 });
    const before = await getRiskCaseForUser(userId);
    const item = await markRiskCase(userId, level, reason, operator);
    await recordRiskAction({ action: "mark-risk", operatorUsername: operator, targetUserId: userId, reason, before: { level: before?.level || "normal", score: before?.score || 0 }, after: { level: item.level, score: item.score }, affectedUserIds: [userId] });
    return NextResponse.json({ item });
  }
  if (action === "ban" || action === "unban") {
    const scope = optionalString(body.scope) === "referral-chain" ? "referral-chain" : "user";
    const component = scope === "referral-chain" ? await referralRiskComponent(userId) : null;
    const affectedUserIds = component?.userIds || [userId];
    const items = [];
    for (const affectedUserId of affectedUserIds) {
      items.push(await setRiskBlocked(affectedUserId, action === "ban", reason, operator, scope));
    }
    await recordRiskAction({ action: action === "ban" ? (scope === "referral-chain" ? "ban-referral-chain" : "ban-user") : (scope === "referral-chain" ? "unban-referral-chain" : "unban-user"), operatorUsername: operator, targetUserId: userId, scope, reason, before: {}, after: { blocked: action === "ban" }, affectedUserIds, upstreamSync: { attempted: false, succeeded: false, message: "未同步 NewAPI" } });
    return NextResponse.json({ items, affectedUserIds, upstreamSync: { attempted: false, succeeded: false, message: "当前仅执行 LFN 风控封禁，未修改 NewAPI 上游状态" } });
  }
  return NextResponse.json({ message: "未知风控操作" }, { status: 400 });
}