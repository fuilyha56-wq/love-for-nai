import { NextResponse } from "next/server";
import { listAnnouncements } from "@/lib/announcements";

export async function GET() {
  const items = await listAnnouncements();
  return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
}
