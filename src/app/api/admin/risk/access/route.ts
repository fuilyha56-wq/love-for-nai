import { requireAdmin } from "@/lib/admin-auth";
import { decideRiskAccessRequest, listRiskAccessRequests } from "@/lib/risk-access";
import { readRiskJson, validRiskMutation } from "@/lib/risk-http";
export async function GET() {
  const gate = await requireAdmin(); if ("error" in gate) return Response.json({ message: gate.error }, { status: 403 });
  return Response.json({ requests: await listRiskAccessRequests() }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const gate = await requireAdmin(); if ("error" in gate) return Response.json({ message: gate.error }, { status: 403 });
  if (!validRiskMutation(request)) return Response.json({ message: "请求来源无效" }, { status: 403 });
  try { const body = await readRiskJson(request, 5000); if (!["approve", "decline", "revoke"].includes(String(body.action))) throw new Error("审批动作无效"); return Response.json({ request: await decideRiskAccessRequest(String(body.id), body.action as "approve" | "decline" | "revoke", String(gate.session.userId), String(body.reason || "")) }); }
  catch (e) { return Response.json({ message: e instanceof Error ? e.message : "审批失败" }, { status: 400 }); }
}
