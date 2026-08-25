import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, newApiBaseUrl, userHeaders } from "@/lib/newapi";

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
      { message: "请先登录后查看可用模型", sessionExpired: true },
      { status: 401 },
    );
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/user/models`, {
      headers: userHeaders(session),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json();
    if (!upstream.ok || result.success === false)
      throw new Error(result.message || "无法读取可用模型");
    const names = [...new Set(collectModels(result.data || result))].sort(
      (a, b) => a.localeCompare(b),
    );
    return NextResponse.json({
      items: names.map((name) => ({
        id: name,
        kind: name.toLowerCase().startsWith("nai-") ? "图像模型" : "助手模型",
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取可用模型";
    if (isUpstreamAuthError(message))
      return NextResponse.json(
        { message: "登录状态已过期，请重新登录", sessionExpired: true },
        { status: 401 },
      );
    return NextResponse.json({ message }, { status: 502 });
  }
}
