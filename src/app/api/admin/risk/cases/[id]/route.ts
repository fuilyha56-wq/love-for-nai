import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getRiskCase } from "@/lib/risk-control";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const { id } = await context.params;
  const item = await getRiskCase(id);
  return item
    ? NextResponse.json({ item })
    : NextResponse.json({ message: "风险案件不存在" }, { status: 404 });
}