import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getRiskCaseForUser } from "@/lib/risk-control";
import { referralRiskComponent } from "@/lib/referral";
import { listImageSettlements } from "@/lib/risk-settlement";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const userId = Number((await context.params).id);
  if (!Number.isInteger(userId) || userId <= 0)
    return NextResponse.json({ message: "用户 id 无效" }, { status: 400 });
  const [riskCase, referral, settlements] = await Promise.all([
    getRiskCaseForUser(userId),
    referralRiskComponent(userId),
    listImageSettlements(5000),
  ]);
  return NextResponse.json({
    item: {
      riskCase,
      referral,
      settlements: settlements.filter((item) => item.userId === userId).slice(0, 100),
    },
  });
}