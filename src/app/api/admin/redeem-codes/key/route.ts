import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseJsonBody, optionalString } from "@/lib/request";
import { adminRedeemCodeValue } from "@/lib/redeem-codes";
import { newApiDbPool } from "@/lib/newapi-db";
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const id =
      optionalString(
        (await parseJsonBody<Record<string, unknown>>(request)).id,
      ) || "";
    let code: string | null = null;
    if (/^newapi-\d+$/.test(id)) {
      const result = await newApiDbPool()?.query(
        'SELECT "key" FROM redemptions WHERE id=$1 AND deleted_at IS NULL',
        [Number(id.slice(7))],
      );
      code = result?.rows[0]?.key?.trim() || null;
    } else code = await adminRedeemCodeValue(id);
    return code
      ? NextResponse.json(
          { code },
          { headers: { "Cache-Control": "no-store" } },
        )
      : NextResponse.json({ message: "兑换码不存在" }, { status: 404 });
  } catch {
    return NextResponse.json({ message: "兑换码读取失败" }, { status: 400 });
  }
}
