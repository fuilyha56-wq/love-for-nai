import { NextResponse } from "next/server";
import { getPublicCatalog } from "@/lib/public-catalog";

export async function GET() {
  const catalog = await getPublicCatalog();
  return NextResponse.json(catalog, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
    },
  });
}
