import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { optionalNumber, parseJsonBody } from "@/lib/request";
import { referralRiskComponent } from "@/lib/referral";
import { getRiskCaseForUser } from "@/lib/risk-control";

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await parseJsonBody(request); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "请求体无效" }, { status: 400 }); }
  const userId = optionalNumber(body.userId);
  if (!userId || !Number.isInteger(userId) || userId <= 0)
    return NextResponse.json({ message: "用户 id 无效" }, { status: 400 });
  const component = await referralRiskComponent(userId);
  const cases = await Promise.all(component.userIds.map(async (id) => ({ userId: id, riskCase: await getRiskCaseForUser(id) })));
  return NextResponse.json({ component, users: cases });
}