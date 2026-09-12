import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import {
  getModelBilling,
  runtimeImageUpstream,
  updateModelBilling,
  type ModelBillingMap,
} from "@/lib/runtime-config";

// LFN 管理中心 → NovelAI Gateway 管理代理：
// 渠道（NAI 账号池）启停/测试/重置、每账号原始 NAI 订阅与额度、模型计费配置。
// 仅在图像端点为 gateway 适配器时可用。

async function gatewayUpstream(): Promise<
  { baseUrl: string; token: string } | { error: NextResponse }
> {
  const upstream = await runtimeImageUpstream();
  if (!upstream || upstream.adapterType !== "gateway") {
    return {
      error: NextResponse.json(
        { message: "未配置 NovelAI Gateway 图像端点，此模块不可用" },
        { status: 503 },
      ),
    };
  }
  return { baseUrl: upstream.baseUrl.replace(/\/+$/, ""), token: upstream.token };
}

async function forwardGateway(
  gateway: { baseUrl: string; token: string },
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<NextResponse> {
  const response = await fetch(`${gateway.baseUrl}${path}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${gateway.token}`,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.trim() ? JSON.parse(text) : null;
  } catch {
    payload = { message: text.slice(0, 300) };
  }
  return NextResponse.json(payload, { status: response.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const gateway = await gatewayUpstream();
  if ("error" in gateway) return gateway.error;

  const naiAccountId = new URL(request.url).searchParams.get("nai");
  if (naiAccountId) {
    try {
      return await forwardGateway(
        gateway,
        `/admin/api/upstream/account-data?account_id=${encodeURIComponent(naiAccountId)}`,
      );
    } catch {
      return NextResponse.json({ message: "Gateway 无响应" }, { status: 502 });
    }
  }

  try {
    const response = await forwardGateway(gateway, "/admin/api/overview");
    const payload = (await response.json()) as {
      models?: unknown;
      usage?: unknown;
      accounts?: unknown;
    };
    return NextResponse.json({
      accounts: payload.accounts ?? [],
      models: payload.models ?? [],
      usage: payload.usage ?? null,
      modelBilling: await getModelBilling(),
    });
  } catch {
    return NextResponse.json({ message: "Gateway 无响应，请确认其正在运行" }, { status: 502 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });

  let body: {
    action?: string;
    accountId?: string;
    enabled?: boolean;
    weight?: number;
    name?: string;
    modelBilling?: ModelBillingMap;
  };
  try {
    body = (await parseJsonBody(request)) as typeof body;
  } catch (error) {
    return invalidJsonResponse(error);
  }

  if (body.action === "save-billing") {
    if (!body.modelBilling || typeof body.modelBilling !== "object")
      return NextResponse.json({ message: "modelBilling 必须是对象" }, { status: 400 });
    const saved = await updateModelBilling(body.modelBilling);
    return NextResponse.json({ modelBilling: saved });
  }

  const gateway = await gatewayUpstream();
  if ("error" in gateway) return gateway.error;
  const accountId = String(body.accountId || "").trim();
  if (!accountId)
    return NextResponse.json({ message: "缺少 accountId" }, { status: 400 });

  try {
    if (body.action === "account-update") {
      const patch: Record<string, unknown> = {};
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (Number.isFinite(Number(body.weight))) patch.weight = Number(body.weight);
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      return await forwardGateway(gateway, `/admin/api/accounts/${encodeURIComponent(accountId)}`, {
        method: "PUT",
        body: patch,
      });
    }
    if (body.action === "account-test")
      return await forwardGateway(
        gateway,
        `/admin/api/accounts/${encodeURIComponent(accountId)}/test`,
        { method: "POST", body: {} },
      );
    if (body.action === "account-reset")
      return await forwardGateway(
        gateway,
        `/admin/api/accounts/${encodeURIComponent(accountId)}/reset`,
        { method: "POST", body: {} },
      );
    return NextResponse.json({ message: "未知操作" }, { status: 400 });
  } catch {
    return NextResponse.json({ message: "Gateway 无响应" }, { status: 502 });
  }
}
