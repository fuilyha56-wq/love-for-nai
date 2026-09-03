import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { registry } from "@/lib/adapters/registry";
import type { EndpointConfig } from "@/lib/adapters/types";
import {
  InvalidJsonError,
  invalidJsonResponse,
  optionalNumber,
  optionalString,
  parseJsonBody,
} from "@/lib/request";
import {
  deleteRuntimeEndpoint,
  getRuntimeEndpoints,
  publicEndpoint,
  upsertRuntimeEndpoint,
} from "@/lib/runtime-config";

const TYPES = new Set(["auth", "image", "wallet"]);
const ADAPTERS = new Set(["newapi", "local", "openai_compat", "gateway"]);

function parseEndpoint(raw: Record<string, unknown>, partial = false): Partial<EndpointConfig> {
  const type = optionalString(raw.type);
  const adapterType = optionalString(raw.adapterType);
  if (type && !TYPES.has(type)) throw new Error("端点类型不合法");
  if (adapterType && !ADAPTERS.has(adapterType)) throw new Error("适配器类型不合法");
  if (!partial && (!type || !adapterType || !optionalString(raw.name)?.trim()))
    throw new Error("请填写端点类型、适配器和名称");
  const configRaw = raw.config && typeof raw.config === "object" && !Array.isArray(raw.config)
    ? (raw.config as Record<string, unknown>)
    : {};
  return {
    id: optionalString(raw.id),
    type: type as EndpointConfig["type"] | undefined,
    adapterType,
    name: optionalString(raw.name),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    priority: optionalNumber(raw.priority),
    config: {
      baseUrl: optionalString(configRaw.baseUrl) ?? optionalString(raw.baseUrl),
      token: optionalString(configRaw.token) ?? optionalString(raw.token),
    },
  };
}

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
    const endpoint = await upsertRuntimeEndpoint(parseEndpoint(raw));
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
    const endpoint = await upsertRuntimeEndpoint({ id, ...parseEndpoint(raw, true) });
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
