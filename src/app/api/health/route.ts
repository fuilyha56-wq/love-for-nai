import { NextResponse } from "next/server";
import { getResolvedPlatformCapabilities } from "@/lib/platform";

export async function GET() {
  const capabilities = await getResolvedPlatformCapabilities();
  return NextResponse.json({
    status: "ok",
    service: "love-for-nai",
    version: "0.1.0",
    capabilities,
  });
}
