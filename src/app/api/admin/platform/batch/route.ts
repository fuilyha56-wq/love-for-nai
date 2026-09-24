import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { registry } from "@/lib/adapters/registry";
import { parseRuntimeEndpoint, parseRuntimeSettingsPatch } from "@/lib/platform-config-input";
import { assertBodySize } from "@/lib/image-request";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import {
  deleteRuntimeEndpoint,
  publicEndpoint,
  publicSettings,
  updateModelBilling,
  updateRuntimeSettings,
  upsertRuntimeEndpoint,
  type ModelBillingMap,
} from "@/lib/runtime-config";

const MAX_BATCH_OPERATIONS = 50;
const ACTIONS = [
  "settings.update",
  "endpoint.upsert",
  "endpoint.delete",
  "billing.replace",
] as const;
type BatchAction = (typeof ACTIONS)[number];

type BatchOperation = {
  id?: string;
  action?: string;
  params?: unknown;
};

type BatchResult = {
  index: number;
  id?: string;
  action: string;
  status: "committed" | "failed" | "not_executed";
  data?: unknown;
  error?: { name: string; message: string };
};

function paramsRecord(operation: BatchOperation): Record<string, unknown> {
  if (!operation.params || typeof operation.params !== "object" || Array.isArray(operation.params))
    throw new Error("params 必须是 JSON 对象");
  return operation.params as Record<string, unknown>;
}

async function executeOperation(operation: BatchOperation): Promise<unknown> {
  if (!ACTIONS.includes(operation.action as BatchAction))
    throw new Error(`不支持的操作：${operation.action || "(empty)"}`);
  const params = paramsRecord(operation);
  switch (operation.action as BatchAction) {
    case "settings.update": {
      const settings = await updateRuntimeSettings(parseRuntimeSettingsPatch(params));
      await registry.reload();
      return { settings: publicSettings(settings) };
    }
    case "endpoint.upsert": {
      const id = typeof params.id === "string" && params.id.trim() ? params.id.trim() : undefined;
      const endpoint = await upsertRuntimeEndpoint({
        ...(id ? { id } : {}),
        ...parseRuntimeEndpoint(params, Boolean(id)),
      });
      await registry.reload();
      return { endpoint: publicEndpoint(endpoint) };
    }
    case "endpoint.delete": {
      const id = typeof params.id === "string" ? params.id.trim() : "";
      if (!id) throw new Error("缺少端点 id");
      if (!(await deleteRuntimeEndpoint(id))) throw new Error("端点不存在");
      await registry.reload();
      return { deleted: id };
    }
    case "billing.replace": {
      const modelBilling = params.modelBilling;
      if (!modelBilling || typeof modelBilling !== "object" || Array.isArray(modelBilling))
        throw new Error("modelBilling 必须是对象");
      return { modelBilling: await updateModelBilling(modelBilling as ModelBillingMap) };
    }
  }
}

export async function POST(request: Request) {
  const gate = await requireAdminRequest(request);
  if ("error" in gate)
    return NextResponse.json({ message: gate.error }, { status: 403 });

  let body: { operations?: unknown };
  try {
    assertBodySize(request);
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (!Array.isArray(body.operations) || body.operations.length === 0)
    return NextResponse.json({ message: "operations 必须是非空数组" }, { status: 400 });
  if (body.operations.length > MAX_BATCH_OPERATIONS)
    return NextResponse.json(
      { message: `单批最多 ${MAX_BATCH_OPERATIONS} 项操作` },
      { status: 400 },
    );

  const operations = body.operations as BatchOperation[];
  const results: BatchResult[] = [];
  let failed = false;
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const action = typeof operation?.action === "string" ? operation.action : "";
    const id = typeof operation?.id === "string" ? operation.id : undefined;
    if (failed) {
      results.push({ index, id, action, status: "not_executed" });
      continue;
    }
    try {
      const data = await executeOperation(operation || {});
      results.push({ index, id, action, status: "committed", data });
    } catch (error) {
      failed = true;
      results.push({
        index,
        id,
        action,
        status: "failed",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const committed = results.filter((result) => result.status === "committed").length;
  return NextResponse.json(
    {
      success: !failed,
      stoppedOnError: failed,
      committed,
      total: results.length,
      results,
    },
    { status: failed ? 207 : 200 },
  );
}