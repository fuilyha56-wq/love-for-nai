import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { galleryImagePath, getGalleryItem } from "@/lib/gallery";
import { getSession } from "@/lib/session";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const item = await getGalleryItem((await params).id);
  const session = await getSession();
  if (!item || (item.status !== "approved" && session?.userId !== item.ownerId)) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(galleryImagePath(item.imageFile));
    const ext = item.imageFile.split(".").pop();
    return new NextResponse(data, { headers: { "Content-Type": ext === "jpg" ? "image/jpeg" : `image/${ext}`, "Cache-Control": item.status === "approved" ? "public, max-age=3600" : "private, no-store" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}