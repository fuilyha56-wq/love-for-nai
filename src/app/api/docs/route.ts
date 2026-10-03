import { NextResponse } from "next/server";
import { listDocuments, publicDocument } from "@/lib/documents";

export async function GET() {
  const items = (await listDocuments({ publishedOnly: true })).map(publicDocument);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
