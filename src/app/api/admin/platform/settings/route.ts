import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { registry } from "@/lib/adapters/registry";
import { parseRuntimeSettingsPatch } from "@/lib/platform-config-input";
import {
  invalidJsonResponse,
  parseJsonBody,
} from "@/lib/request";
import {
  getRuntimeSettings,
  publicSettings,
  updateRuntimeSettings,
} from "@/lib/runtime-config";

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
  try {
    const settings = await updateRuntimeSettings(parseRuntimeSettingsPatch(raw));
    await registry.reload();
    return NextResponse.json({ settings: publicSettings(settings) });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "保存失败" },
      { status: 400 },
    );
  }
}
