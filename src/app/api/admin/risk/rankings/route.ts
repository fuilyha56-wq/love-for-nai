import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { requestRankings, type RequestRankingMetric } from "@/lib/request-audit";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const days = Number(params.get("days") || 1);
  const metric: RequestRankingMetric = params.get("metric") === "anlas" ? "anlas" : "calls";
  const userId = params.has("userId") ? Number(params.get("userId")) : undefined;
  if (!Number.isInteger(days) || days < 1 || days > 30 || (userId != null && (!Number.isSafeInteger(userId) || userId <= 0)))
    return NextResponse.json({ message: "时间范围或用户 ID 无效" }, { status: 400 });
  const source = params.get("source");
  const bucket = params.get("bucket");
  return NextResponse.json(await requestRankings(days, metric, Date.now(), { userId, keyword: params.get("keyword") || undefined,
    ...(source === "lfn" || source === "api" ? { source } : {}), ...(bucket === "hour" || bucket === "day" ? { bucket } : {}),
  }), { headers: { "Cache-Control": "private, no-store" } });
}
