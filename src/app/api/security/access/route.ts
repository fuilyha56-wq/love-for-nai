import { getSession } from "@/lib/session";
import { listRiskAccessRequests, submitRiskAccessRequest } from "@/lib/risk-access";
import { readRiskJson, validRiskMutation } from "@/lib/risk-http";
export async function GET() {
  const session = await getSession(); if (!session) return Response.json({ message: "请先登录" }, { status: 401 });
  return Response.json({ requests: await listRiskAccessRequests(session.userId) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const session = await getSession(); if (!session) return Response.json({ message: "请先登录" }, { status: 401 });
  if (!validRiskMutation(request)) return Response.json({ message: "请求来源无效" }, { status: 403 });
  try { const body = await readRiskJson(request, 5000); return Response.json({ request: await submitRiskAccessRequest(session.userId, { reason: String(body.reason || ""), perMinute: Number(body.perMinute), concurrency: Number(body.concurrency), hours: Number(body.hours) }) }); }
  catch (e) { return Response.json({ message: e instanceof Error ? e.message : "提交失败" }, { status: 400 }); }
}
