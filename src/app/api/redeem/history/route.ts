import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listRedemptionHistory } from "@/lib/redeem-codes";
import { listNewApiRedemptions } from "@/lib/newapi-redemptions";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录", sessionExpired: true },
      { status: 401 },
    );
  const [lfn, newapi] = await Promise.all([
    listRedemptionHistory(session.userId),
    listNewApiRedemptions(1, session.userId),
  ]);
  return NextResponse.json(
    {
      items: [...lfn, ...newapi.items].sort((a, b) =>
        (b.redeemedAt || "").localeCompare(a.redeemedAt || ""),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
