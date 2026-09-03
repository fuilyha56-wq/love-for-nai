import { NextResponse } from "next/server";
import { getPlatformCapabilities } from "@/lib/platform";

export function GET() {
  const capabilities = getPlatformCapabilities();
  return NextResponse.json({
    status: "ok",
    service: "love-for-nai",
    version: "0.1.0",
    capabilities,
  });
}
