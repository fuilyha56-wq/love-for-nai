import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody, optionalNumber, optionalString } from "@/lib/request";
import { createRedeemCodes, listRedeemCodes, updateRedeemCode } from "@/lib/redeem-codes";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const items = await listRedeemCodes();
  return NextResponse.json({ items, total: items.length });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const items = await createRedeemCodes({
      code: optionalString(body.code), count: optionalNumber(body.count), campaignId: optionalString(body.campaignId),
      rewardType: body.rewardType === undefined ? "aff" : body.rewardType as "aff",
      amount: optionalNumber(body.amount) ?? 0, maxUses: optionalNumber(body.maxUses) ?? 1,
      expiresAt: optionalString(body.expiresAt), enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      createdBy: gate.session.userId,
    });
    return NextResponse.json({ items }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "创建兑换码失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const id = optionalString(body.id);
    if (!id) return NextResponse.json({ message: "缺少兑换码 id" }, { status: 400 });
    const item = await updateRedeemCode(id, {
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      expiresAt: body.expiresAt === null ? null : optionalString(body.expiresAt),
      maxUses: optionalNumber(body.maxUses),
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "更新兑换码失败" }, { status: 400 });
  }
}
