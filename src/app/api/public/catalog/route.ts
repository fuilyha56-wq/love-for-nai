import { NextResponse } from "next/server";
import { getPublicCatalog } from "@/lib/public-catalog";

export async function GET() {
  const catalog = await getPublicCatalog();
  return NextResponse.json(catalog, {
    headers: {
      // The catalog payload is filtered against current runtime policy per request.
      "Cache-Control": "no-store",
    },
  });
}
