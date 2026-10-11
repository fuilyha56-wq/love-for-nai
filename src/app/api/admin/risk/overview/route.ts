import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listImageSettlements } from "@/lib/risk-settlement";
import { listIpEvidence } from "@/lib/risk-ip";
import { listPromptClusters, listRiskActions, listRiskCases } from "@/lib/risk-control";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const [cases, clusters, settlements, ipEvidence, actions] = await Promise.all([
    listRiskCases(5000),
    listPromptClusters(5000),
    listImageSettlements(5000),
    listIpEvidence(5000),
    listRiskActions(5000),
  ]);
  return NextResponse.json({
    counts: {
      cases: cases.length,
      watch: cases.filter((item) => item.level === "watch").length,
      risk: cases.filter((item) => item.level === "risk").length,
      critical: cases.filter((item) => item.level === "critical").length,
      banned: cases.filter((item) => item.enforcement?.blocked).length,
      promptClusters: clusters.filter((item) => item.riskLevel !== "normal").length,
      pendingRefunds: settlements.filter((item) => item.status === "pending-reconciliation" || item.status === "manual-review").length,
      ipEvidence: ipEvidence.length,
      actions: actions.length,
    },
  });
}