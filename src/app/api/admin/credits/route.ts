import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { affLedger, listAffLedgers } from "@/lib/aff";
import { findLocalUserById } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import { requestUsageByUser } from "@/lib/request-audit";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const userId = Number(new URL(request.url).searchParams.get("userId") || "");
  if (Number.isInteger(userId) && userId > 0) {
    const ledger = await affLedger(userId);
    const usage = await requestUsageByUser();
    const local =
      (await resolvedAuthProviderId()) === "local" ? await findLocalUserById(userId) : null;
    return NextResponse.json({
      item: {
        ...ledger,
        usage: usage.get(userId) || { requests5h: 0, requests7d: 0, requests30d: 0, retainedRecords: 0 },
        username: local?.username,
        displayName: local?.displayName,
      },
    });
  }
  const keyword = new URL(request.url).searchParams.get("keyword")?.trim() || "";
  const [items, usage] = await Promise.all([listAffLedgers(), requestUsageByUser()]);
  const filtered = (keyword
    ? items.filter((item) => String(item.userId).includes(keyword))
    : items).map((item) => ({
      ...item,
      usage: usage.get(item.userId) || { requests5h: 0, requests7d: 0, requests30d: 0, retainedRecords: 0 },
    }));
  return NextResponse.json({ items: filtered, total: filtered.length });
}
