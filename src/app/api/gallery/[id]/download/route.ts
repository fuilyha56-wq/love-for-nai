import { NextResponse } from "next/server";
import { recordGalleryMetric } from "@/lib/gallery";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await recordGalleryMetric(id, "download");
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ message: "图库作品不存在" }, { status: 404 });
}
