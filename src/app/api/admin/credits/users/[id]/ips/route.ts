import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { optionalString, parseJsonBody } from "@/lib/request";
import { userIpHistory } from "@/lib/user-ip-history";
import { recordRiskAction } from "@/lib/risk-control";
async function respond(
  request: Request,
  context: { params: Promise<{ id: string }> },
  reveal: boolean,
) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  const userId = Number((await context.params).id);
  if (!Number.isSafeInteger(userId) || userId <= 0)
    return NextResponse.json({ message: "用户 ID 无效" }, { status: 400 });
  const rawRevealEnabled = process.env.LFN_IP_RAW_REVEAL_ENABLED === "true";
  try {
    let reason = "";
    if (reveal) {
      if (!rawRevealEnabled)
        return NextResponse.json(
          { message: "完整 IP 查询未启用" },
          { status: 403 },
        );
      reason =
        optionalString(
          (await parseJsonBody<Record<string, unknown>>(request)).reason,
        )
          ?.trim()
          .slice(0, 500) || "";
      if (!reason)
        return NextResponse.json(
          { message: "完整 IP 查询必须填写原因" },
          { status: 400 },
        );
    }
    const items = await userIpHistory(userId, reveal);
    if (reveal)
      await recordRiskAction({
        action: "reveal-ip",
        operatorUsername: gate.session.username,
        targetUserId: userId,
        reason,
        before: { revealed: false },
        after: {
          evidenceCount: items.length,
          revealedCount: items.filter((item) => item.ip).length,
          geoResolvedCount: items.filter(
            (item) => item.geo?.status === "resolved",
          ).length,
        },
        affectedUserIds: [userId],
      });
    return NextResponse.json(
      {
        userId,
        items,
        total: items.length,
        rawRevealEnabled,
        geoResolvedCount: items.filter(
          (item) => item.geo?.status === "resolved",
        ).length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "IP 证据读取失败，请检查数据库和证据存储" },
      { status: 503 },
    );
  }
}
export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return respond(request, context, false);
}
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return respond(request, context, true);
}
