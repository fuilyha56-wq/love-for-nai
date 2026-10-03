import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { galleryImagePath, getGalleryItem } from "@/lib/gallery";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return new NextResponse(null, { status: 403 });
  const item = await getGalleryItem((await params).id);
  if (!item) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(galleryImagePath(item.imageFile));
    const ext = item.imageFile.split(".").pop();
    return new NextResponse(data, { headers: { "Content-Type": ext === "jpg" ? "image/jpeg" : `image/${ext}`, "Cache-Control": "private, no-store" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
