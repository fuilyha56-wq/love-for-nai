import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { affLedger, listAffLedgers } from "@/lib/aff";
import { findLocalUserById } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import { requestUsageByUser } from "@/lib/request-audit";
import { userDisplayNames } from "@/lib/user-display";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });
  const userId = Number(new URL(request.url).searchParams.get("userId") || "");
  if (Number.isInteger(userId) && userId > 0) {
    const ledger = await affLedger(userId);
    const page = Math.max(
      1,
      Math.floor(Number(new URL(request.url).searchParams.get("page")) || 1),
    );
    const usage = await requestUsageByUser();
    const local =
      (await resolvedAuthProviderId()) === "local"
        ? await findLocalUserById(userId)
        : null;
    return NextResponse.json({
      item: {
        ...ledger,
        transactions: ledger.transactions.slice((page - 1) * 10, page * 10),
        transactionTotal: ledger.transactions.length,
        page,
        pageSize: 10,
        usage: usage.get(userId) || {
          requests5h: 0,
          requests7d: 0,
          requests30d: 0,
          retainedRecords: 0,
        },
        username: local?.username,
        displayName:
          local?.displayName ||
          (await userDisplayNames([userId])).get(userId)?.name,
      },
    });
  }
  const keyword =
    new URL(request.url).searchParams.get("keyword")?.trim() || "";
  const [items, usage] = await Promise.all([
    listAffLedgers(),
    requestUsageByUser(),
  ]);
  const filtered = (
    keyword
      ? items.filter((item) => String(item.userId).includes(keyword))
      : items
  ).map((item) => ({
    ...item,
    usage: usage.get(item.userId) || {
      requests5h: 0,
      requests7d: 0,
      requests30d: 0,
      retainedRecords: 0,
    },
  }));
  return NextResponse.json({ items: filtered, total: filtered.length });
}
