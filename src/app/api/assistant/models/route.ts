import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";

type ModelItem = string | { id?: string; model?: string; name?: string };

function collectModels(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectModels);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = [record.id, record.model, record.name].filter(
    (item): item is string => typeof item === "string",
  );
  return [
    ...direct,
    ...[record.data, record.items, record.models].flatMap(collectModels),
  ];
}

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后选择智能助手模型" },
      { status: 401 },
    );

  try {
    const response = await fetch(`${newApiBaseUrl()}/api/user/models`, {
      headers: userHeaders(session),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as { data?: ModelItem[] };
    if (!response.ok) throw new Error("无法读取可用模型");
    const models = [...new Set(collectModels(result.data || result))]
      .filter((model) => model && !model.toLowerCase().startsWith("nai-"))
      .sort((left, right) => left.localeCompare(right));
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "无法读取可用模型" },
      { status: 502 },
    );
  }
}
