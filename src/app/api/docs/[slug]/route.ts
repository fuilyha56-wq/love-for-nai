import { NextResponse } from "next/server";
import { getDocumentBySlug, publicDocument } from "@/lib/documents";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const document = await getDocumentBySlug((await params).slug, { publishedOnly: true });
  if (!document) return NextResponse.json({ message: "文档不存在" }, { status: 404 });
  return NextResponse.json({ item: publicDocument(document) }, { headers: { "Cache-Control": "no-store" } });
}
