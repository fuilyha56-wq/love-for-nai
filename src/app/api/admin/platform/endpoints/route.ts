import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { affGateway } from "@/lib/newapi";
import { genericImageProvider } from "@/lib/platform";
import {
  invalidJsonResponse,
  optionalNumber,
  optionalString,
  parseJsonBody,
} from "@/lib/request";
import type { EndpointConfig } from "@/lib/adapters/types";

function nowIso() {
  return new Date().toISOString();
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function environmentEndpoints(): EndpointConfig[] {
  const createdAt = nowIso();
  const items: EndpointConfig[] = [];
  const newApiBase = process.env.NEWAPI_BASE_URL?.trim();
  const newApiToken = process.env.LFN_ADMIN_TOKEN?.trim();
  if (newApiBase) {
    items.push({
      id: "env-newapi-auth",
      type: "auth",
      adapterType: "newapi",
      name: "NewAPI 账号（环境变量）",
      enabled: true,
      config: { baseUrl: newApiBase, token: maskSecret(newApiToken) },
      priority: 100,
      createdAt,
      updatedAt: createdAt,
    });
    items.push({
      id: "env-newapi-wallet",
      type: "wallet",
      adapterType: "newapi",
      name: "NewAPI 余额（环境变量）",
      enabled: true,
      config: { baseUrl: newApiBase, token: maskSecret(newApiToken) },
      priority: 100,
      createdAt,
      updatedAt: createdAt,
    });
  }
  const gateway = affGateway();
  if (gateway) {
    items.push({
      id: "env-gateway-image",
      type: "image",
      adapterType: "openai_compat",
      name: "NovelAI Gateway（环境变量）",
      enabled: true,
      config: { baseUrl: gateway.baseUrl, token: maskSecret(gateway.token) },
      priority: 100,
      createdAt,
      updatedAt: createdAt,
    });
  }
  const generic = genericImageProvider();
  if (generic) {
    items.push({
      id: "env-generic-image",
      type: "image",
      adapterType: "openai_compat",
      name: "OpenAI 兼容图像接口（环境变量）",
      enabled: true,
      config: { baseUrl: generic.baseUrl, token: maskSecret(generic.token) },
      priority: 90,
      createdAt,
      updatedAt: createdAt,
    });
  }
  if (process.env.LFN_AUTH_PROVIDER === "local") {
    items.push({
      id: "env-local-auth",
      type: "auth",
      adapterType: "local",
      name: "本地账号（环境变量）",
      enabled: true,
      config: {},
      priority: 80,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return items;
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  return NextResponse.json({
    endpoints: environmentEndpoints(),
    source: "environment",
    writable: false,
  });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  return NextResponse.json(
    { message: "当前部署尚未接入端点数据库，请用环境变量配置上游。" },
    { status: 400 },
  );
}

export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  try {
    const raw = await parseJsonBody<Record<string, unknown>>(request);
    optionalString(raw.id);
    optionalNumber(raw.priority);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  return NextResponse.json(
    { message: "当前部署尚未接入端点数据库，请用环境变量配置上游。" },
    { status: 400 },
  );
}

export async function DELETE() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  return NextResponse.json(
    { message: "当前部署尚未接入端点数据库，请用环境变量配置上游。" },
    { status: 400 },
  );
}
