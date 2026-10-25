import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { recordGalleryMetric } from "@/lib/gallery";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const result = await recordGalleryMetric(id, "use");
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ message: "图库作品不存在" }, { status: 404 });
}
