import { NextResponse } from "next/server";
import { getResolvedPlatformCapabilities } from "@/lib/platform";
import { freeGrantReadiness } from "@/lib/light-risk";

export async function GET(request: Request) {
  const capabilities = await getResolvedPlatformCapabilities();
  const admissionReady = await freeGrantReadiness(request).catch(() => false);
  return NextResponse.json({
    status: "ok",
    service: "love-for-nai",
    version: "0.1.0",
    capabilities,
    readiness: { freeImageAdmission: admissionReady ? "ready" : "unavailable" },
  }, { headers: { "Cache-Control": "no-store" } });
}
