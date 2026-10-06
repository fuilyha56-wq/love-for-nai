import { NextResponse } from "next/server";
import { getGalleryItem, readGalleryImage } from "@/lib/gallery";
import { getSession } from "@/lib/session";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const item = await getGalleryItem((await params).id);
  const session = await getSession();
  if (!item || (item.status !== "approved" && session?.userId !== item.ownerId)) return new NextResponse(null, { status: 404 });
  try {
    const { data, extension } = await readGalleryImage(item);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": extension === "jpg" ? "image/jpeg" : `image/${extension}`, "Cache-Control": item.status === "approved" ? "public, max-age=3600" : "private, no-store" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}