import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listRiskCases } from "@/lib/risk-control";
import { requestUsageByUser } from "@/lib/request-audit";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") || 100);
  const keyword = params.get("keyword")?.trim().toLowerCase() || "";
  const level = params.get("level");
  const [riskCases, usage] = await Promise.all([
    listRiskCases(Number.isFinite(limit) ? limit : 100),
    requestUsageByUser(),
  ]);
  const items = riskCases.filter((item) =>
    (!level || item.level === level) &&
    (!keyword || `${item.userId} ${item.username || ""} ${item.caseId}`.toLowerCase().includes(keyword)),
  );
  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      usage: usage.get(item.userId) || { requests5h: 0, requests7d: 0, requests30d: 0 },
    })),
    total: items.length,
  });
}