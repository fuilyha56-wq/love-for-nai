import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, newApiBaseUrl, userHeaders } from "@/lib/newapi";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

async function requireSession() {
  const session = await getSession();
  if (!session) return null;
  return { session, headers: userHeaders(session) };
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (isUpstreamAuthError(message))
    return NextResponse.json(
      { message: "登录状态已过期，请重新登录", sessionExpired: true },
      { status: 401 },
    );
  return NextResponse.json({ message }, { status: 502 });
}

export async function GET() {
  const auth = await requireSession();
  if (!auth)
    return NextResponse.json(
      { message: "请先登录后管理 API 密钥", sessionExpired: true },
      { status: 401 },
    );
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/token/?p=1&size=100`, {
      headers: auth.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json();
    if (!upstream.ok || !result.success)
      throw new Error(result.message || "无法读取 API 密钥");
    const source = result.data || {};
    return NextResponse.json({
      items: Array.isArray(source) ? source : source.items || [],
    });
  } catch (error) {
    return failure(error, "无法读取 API 密钥");
  }
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (!auth) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const name = optionalString(raw.name)?.trim() || "";
  if (name.length < 2 || name.length > 40)
    return NextResponse.json(
      { message: "密钥名称需为 2–40 个字符" },
      { status: 400 },
    );
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/token/`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        name,
        expired_time: -1,
        remain_quota: 0,
        unlimited_quota: true,
        model_limits_enabled: false,
        model_limits: "",
        allow_ips: "",
        group: "default",
        cross_group_retry: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json();
    if (!upstream.ok || !result.success)
      throw new Error(result.message || "创建 API 密钥失败");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "创建 API 密钥失败" },
      { status: 502 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireSession();
  if (!auth) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  let body: Record<string, unknown> & { id?: number };
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0)
    return NextResponse.json({ message: "缺少密钥 ID" }, { status: 400 });
  // NewAPI 只在带 status_only 时更新启停状态，否则会静默忽略 status 字段。
  const statusOnly = body.statusOnly === true;
  delete body.statusOnly;
  try {
    const upstream = await fetch(
      `${newApiBaseUrl()}/api/token/${statusOnly ? "?status_only=true" : ""}`,
      {
        method: "PUT",
        headers: auth.headers,
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const result = await upstream.json();
    if (!upstream.ok || !result.success)
      throw new Error(result.message || "更新 API 密钥失败");
    return NextResponse.json({ success: true });
  } catch (error) {
    return failure(error, "更新 API 密钥失败");
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession();
  if (!auth) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ message: "无效的密钥 ID" }, { status: 400 });
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/token/${id}`, {
      method: "DELETE",
      headers: auth.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json();
    if (!upstream.ok || !result.success)
      throw new Error(result.message || "删除 API 密钥失败");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "删除 API 密钥失败" },
      { status: 502 },
    );
  }
}
