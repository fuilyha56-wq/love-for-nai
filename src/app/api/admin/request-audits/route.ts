import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listRequestAudits } from "@/lib/request-audit";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const limit = Number(new URL(request.url).searchParams.get("limit") || 100);
  return NextResponse.json({ items: await listRequestAudits(Number.isFinite(limit) ? limit : 100) });
}
