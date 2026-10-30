import { NextResponse } from "next/server";
import { getGalleryItem, readGalleryImage } from "@/lib/gallery";
import { getSession } from "@/lib/session";
import { createImageThumbnail } from "@/lib/image-processing";
import { requireAdmin } from "@/lib/admin-auth";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const item = await getGalleryItem((await params).id);
  const session = await getSession();
  if (!item || (item.status !== "approved" && session?.userId !== item.ownerId && "error" in await requireAdmin())) return new NextResponse(null, { status: 404 });
  try {
    const { data, extension } = await readGalleryImage(item);
    const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail";
    const bytes = thumbnail ? await createImageThumbnail(data) : data;
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": thumbnail ? "image/webp" : extension === "jpg" ? "image/jpeg" : `image/${extension}`, "Cache-Control": thumbnail && item.status === "approved" ? "public, max-age=300" : "private, no-store" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
