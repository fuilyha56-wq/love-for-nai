import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { affLedger, listAffLedgers } from "@/lib/aff";
import { findLocalUserById } from "@/lib/local-users";
import { authProviderId } from "@/lib/platform";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const userId = Number(new URL(request.url).searchParams.get("userId") || "");
  if (Number.isInteger(userId) && userId > 0) {
    const ledger = await affLedger(userId);
    const local =
      authProviderId() === "local" ? await findLocalUserById(userId) : null;
    return NextResponse.json({
      item: {
        ...ledger,
        username: local?.username,
        displayName: local?.displayName,
      },
    });
  }
  const keyword = new URL(request.url).searchParams.get("keyword")?.trim() || "";
  const items = await listAffLedgers();
  const filtered = keyword
    ? items.filter((item) => String(item.userId).includes(keyword))
    : items;
  return NextResponse.json({ items: filtered, total: filtered.length });
}
