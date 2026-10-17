import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { optionalNumber, parseJsonBody } from "@/lib/request";
import { referralRiskComponent } from "@/lib/referral";
import { riskCasesForUsers, getRiskPolicy } from "@/lib/risk-control";
import { userDisplayNames } from "@/lib/user-display";

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await parseJsonBody(request); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "请求体无效" }, { status: 400 }); }
  const userId = optionalNumber(body.userId);
  if (!userId || !Number.isInteger(userId) || userId <= 0)
    return NextResponse.json({ message: "用户 id 无效" }, { status: 400 });
  const policy = await getRiskPolicy();
  const component = await referralRiskComponent(userId, policy.referralMaxDepth);
  const ids = component.contextUserIds || component.userIds;
  const [names, riskCases] = await Promise.all([userDisplayNames(ids), riskCasesForUsers(ids)]);
  const cases = ids.map((id) => ({ userId: id, username: names.get(id)?.username || riskCases.get(id)?.username || `账号 #${id}`, displayName: names.get(id)?.name, level: riskCases.get(id)?.level || "normal", score: riskCases.get(id)?.score || 0, blocked: Boolean(riskCases.get(id)?.enforcement?.blocked) }));
  return NextResponse.json({ component, users: cases });
}
