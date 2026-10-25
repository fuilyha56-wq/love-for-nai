import { NextResponse } from "next/server";
import { DEFAULT_AUTH_POLICY } from "@/lib/auth-policy";
import { getRuntimeSettings } from "@/lib/runtime-config";
import { resolvedAuthProviderId } from "@/lib/platform";
import { upstreamRegistrationPolicy } from "@/lib/newapi-registration";

export async function GET() {
  let settings = await getRuntimeSettings();
  const provider = await resolvedAuthProviderId();
  if (provider === "newapi") {
    try {
      settings = (await upstreamRegistrationPolicy(settings)).settings;
    } catch {
      // Keep login available when only registration policy cannot be read.
      settings = { ...settings, registrationEnabled: false };
    }
  }
  const policy = Object.fromEntries(
    Object.keys(DEFAULT_AUTH_POLICY).map((key) => [
      key,
      settings[key as keyof typeof DEFAULT_AUTH_POLICY],
    ]),
  );
  return NextResponse.json(
    { policy, provider },
    { headers: { "Cache-Control": "no-store" } },
  );
}
