import { NextResponse } from "next/server";
import { dailyImagePolicy } from "@/lib/daily-image-billing";
import { CNY_PER_AFF } from "@/lib/image-pricing";
import { getModelBilling } from "@/lib/runtime-config";

export async function GET() {
  try {
    const [policy, billing] = await Promise.all([dailyImagePolicy(), getModelBilling()]);
    // Explicit allowlist: never return runtime settings, credentials or account usage.
    const fixedCosts = Object.fromEntries(Object.entries(billing)
      .filter(([, entry]) => entry.mode === "fixed")
      .map(([model, entry]) => [model, entry.fixedCost]));
    return NextResponse.json({ policy, cnyPerAff: CNY_PER_AFF, fixedCosts, asOf: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "暂时无法读取本站计价，请稍后重试" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
