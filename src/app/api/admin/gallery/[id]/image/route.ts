import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { galleryImagePath, getGalleryItem } from "@/lib/gallery";
import { createImageThumbnail } from "@/lib/image-processing";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return new NextResponse(null, { status: 403 });
  const item = await getGalleryItem((await params).id);
  if (!item) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(galleryImagePath(item.imageFile));
    const ext = item.imageFile.split(".").pop();
    const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail";
    const bytes = thumbnail ? await createImageThumbnail(data) : data;
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": thumbnail ? "image/webp" : ext === "jpg" ? "image/jpeg" : `image/${ext}`, "Cache-Control": thumbnail ? "private, max-age=86400" : "private, no-store" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
