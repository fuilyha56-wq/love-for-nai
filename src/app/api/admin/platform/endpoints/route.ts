import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { registry } from "@/lib/adapters/registry";
import { parseRuntimeEndpoint } from "@/lib/platform-config-input";
import {
  InvalidJsonError,
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";
import {
  deleteRuntimeEndpoint,
  getRuntimeEndpoints,
  publicEndpoint,
  upsertRuntimeEndpoint,
} from "@/lib/runtime-config";

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const endpoints = await getRuntimeEndpoints();
  return NextResponse.json({
    endpoints: endpoints
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .map(publicEndpoint),
    writable: true,
    source: "runtime",
  });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
    const endpoint = await upsertRuntimeEndpoint(parseRuntimeEndpoint(raw));
    await registry.reload();
    return NextResponse.json({ endpoint: publicEndpoint(endpoint) });
  } catch (error) {
    if (error instanceof InvalidJsonError)
      return invalidJsonResponse(error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "保存失败" },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const raw = await parseJsonBody<Record<string, unknown>>(request);
    const id = optionalString(raw.id);
    if (!id) return NextResponse.json({ message: "缺少端点 id" }, { status: 400 });
    const endpoint = await upsertRuntimeEndpoint({ id, ...parseRuntimeEndpoint(raw, true) });
    await registry.reload();
    return NextResponse.json({ endpoint: publicEndpoint(endpoint) });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "保存失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ message: "缺少端点 id" }, { status: 400 });
  const removed = await deleteRuntimeEndpoint(id);
  if (!removed) return NextResponse.json({ message: "端点不存在" }, { status: 404 });
  await registry.reload();
  return NextResponse.json({ success: true });
}
