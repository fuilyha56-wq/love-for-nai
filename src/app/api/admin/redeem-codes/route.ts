import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody, optionalNumber, optionalString } from "@/lib/request";
import {
  createRedeemCodes,
  listRedeemCodes,
  updateRedeemCode,
} from "@/lib/redeem-codes";
import {
  listNewApiRedemptions,
  toggleNewApiRedemption,
} from "@/lib/newapi-redemptions";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const page = Math.max(
      1,
      Math.floor(Number(new URL(request.url).searchParams.get("page")) || 1),
    );
    const source = new URL(request.url).searchParams.get("source");
    if (source === "newapi")
      return NextResponse.json(
        { ...(await listNewApiRedemptions(page)), page, pageSize: 20 },
        { headers: { "Cache-Control": "no-store" } },
      );
    const all = await listRedeemCodes();
    return NextResponse.json(
      {
        items: all
          .slice((page - 1) * 20, page * 20)
          .map((item) => ({ ...item, source: "lfn" })),
        total: all.length,
        page,
        pageSize: 20,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "兑换码读取失败，请检查 NewAPI 数据库连接" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const items = await createRedeemCodes({
      code: optionalString(body.code),
      count: optionalNumber(body.count),
      campaignId: optionalString(body.campaignId),
      rewardType:
        body.rewardType === undefined ? "aff" : (body.rewardType as "aff"),
      amount: optionalNumber(body.amount) ?? 0,
      maxUses: optionalNumber(body.maxUses) ?? 1,
      expiresAt: optionalString(body.expiresAt),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      createdBy: gate.session.userId,
    });
    return NextResponse.json({ items }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "创建兑换码失败" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const id = optionalString(body.id);
    if (!id)
      return NextResponse.json({ message: "缺少兑换码 id" }, { status: 400 });
    if (id.startsWith("newapi-")) {
      if (typeof body.enabled !== "boolean") throw new Error("缺少启用状态");
      await toggleNewApiRedemption(Number(id.slice(7)), body.enabled);
      return NextResponse.json({ success: true });
    }
    const item = await updateRedeemCode(id, {
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      expiresAt:
        body.expiresAt === null ? null : optionalString(body.expiresAt),
      maxUses: optionalNumber(body.maxUses),
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "更新兑换码失败" },
      { status: 400 },
    );
  }
}
