import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listIpEvidence } from "@/lib/risk-ip";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const limit = Number(new URL(request.url).searchParams.get("limit") || 100);
  const items = (await listIpEvidence(Number.isFinite(limit) ? limit : 100)).map((item) => ({
    ...item,
    encryptedIp: undefined,
    masked: item.family === "ipv4" ? "已加密 IPv4" : "已加密 IPv6",
  }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}