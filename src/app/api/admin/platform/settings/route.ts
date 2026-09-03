import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { registry } from "@/lib/adapters/registry";
import {
  invalidJsonResponse,
  optionalNumber,
  optionalString,
  parseJsonBody,
} from "@/lib/request";
import {
  getRuntimeSettings,
  publicSettings,
  updateRuntimeSettings,
  type RuntimeSettings,
} from "@/lib/runtime-config";

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const settings = await getRuntimeSettings();
  return NextResponse.json({ settings: publicSettings(settings), writable: true });
}

export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const authProvider = optionalString(raw.authProvider);
  if (authProvider && authProvider !== "newapi" && authProvider !== "local")
    return NextResponse.json({ message: "账号提供者只能是 newapi 或 local" }, { status: 400 });
  const quotaPerUnit = optionalNumber(raw.quotaPerUnit);
  if (quotaPerUnit !== undefined && (!Number.isInteger(quotaPerUnit) || quotaPerUnit <= 0))
    return NextResponse.json({ message: "余额单位必须是正整数" }, { status: 400 });
  const patch: Partial<RuntimeSettings> = {
    authProvider: authProvider as RuntimeSettings["authProvider"] | undefined,
    newApiBaseUrl: optionalString(raw.newApiBaseUrl),
    newApiAdminToken: optionalString(raw.newApiAdminToken),
    newApiAdminUserId: optionalString(raw.newApiAdminUserId),
    registerGroup: optionalString(raw.registerGroup),
    quotaPerUnit,
    affGatewayUrl: optionalString(raw.affGatewayUrl),
    affGatewayToken: optionalString(raw.affGatewayToken),
    imageProviderUrl: optionalString(raw.imageProviderUrl),
    imageProviderToken: optionalString(raw.imageProviderToken),
    publicUrl: optionalString(raw.publicUrl),
    sourceCodeUrl: optionalString(raw.sourceCodeUrl),
    outboundProxy: optionalString(raw.outboundProxy),
    trustProxy: parseBoolean(raw.trustProxy),
    cookieSecure: parseBoolean(raw.cookieSecure),
    remoteHistoryUrl: optionalString(raw.remoteHistoryUrl),
    remoteHistoryToken: optionalString(raw.remoteHistoryToken),
  };
  const settings = await updateRuntimeSettings(patch);
  await registry.reload();
  return NextResponse.json({ settings: publicSettings(settings) });
}
