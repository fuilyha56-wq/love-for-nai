import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { runtimeAffGateway } from "@/lib/runtime-config";
import type { GatewayImageCapacity } from "@/lib/image-gateway-capacity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GatewayCapacity = {
  total?: unknown;
  v5?: unknown;
  v45?: unknown;
  anlas?: unknown;
  v5_and_anlas?: unknown;
  v45_and_anlas?: unknown;
  concurrency?: unknown;
  queue_policy?: unknown;
};

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const count = (value: unknown) => validCount(value) ? value : 0;

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });

  try {
    const gateway = await runtimeAffGateway();
    if (!gateway) return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });
    const root = gateway.baseUrl.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
    const response = await fetch(`${root}/admin/api/concurrency`, {
      headers: { Authorization: `Bearer ${gateway.token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
    const raw = await response.json() as GatewayCapacity;
    const capabilityQueue = raw.queue_policy === "capability-v1";
    if (capabilityQueue && ![raw.total, raw.v5, raw.v45, raw.anlas, raw.v5_and_anlas, raw.v45_and_anlas, raw.concurrency].every(validCount)) {
      throw new Error("Gateway capability counts are incomplete");
    }
    const capacity: GatewayImageCapacity = {
      total: count(raw.total),
      v5: count(raw.v5),
      v45: count(raw.v45),
      anlas: count(raw.anlas),
      v5_and_anlas: count(raw.v5_and_anlas),
      v45_and_anlas: count(raw.v45_and_anlas),
      concurrency: capabilityQueue ? count(raw.concurrency) : Math.max(1, count(raw.concurrency)),
      capabilityQueue,
    };
    return NextResponse.json({ available: true, capacity }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "暂时无法读取 Gateway 实时账号能力" }, { status: 502 });
  }
}
