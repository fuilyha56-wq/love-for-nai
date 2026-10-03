import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { assertGalleryStatus, listGalleryAdmin, type GalleryStatus } from "@/lib/gallery";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const rawStatus = new URL(request.url).searchParams.get("status");
  let status: GalleryStatus | "all";
  try { status = rawStatus && rawStatus !== "all" ? assertGalleryStatus(rawStatus) : "all"; }
  catch { return NextResponse.json({ message: "审核状态不合法" }, { status: 400 }); }
  const items = await listGalleryAdmin(status);
  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      imageUrl: `/api/admin/gallery/${item.id}/image`,
    })),
    total: items.length,
  });
}
