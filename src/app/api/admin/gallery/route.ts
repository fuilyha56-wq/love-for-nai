import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listGalleryAdmin } from "@/lib/gallery";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const items = await listGalleryAdmin();
  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      imageUrl: `/api/gallery/${item.id}/image`,
    })),
    total: items.length,
  });
}
