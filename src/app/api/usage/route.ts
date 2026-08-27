import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, newApiBaseUrl, userHeaders } from "@/lib/newapi";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看使用记录", sessionExpired: true },
      { status: 401 },
    );
  const requested = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), 1000)
    : 1;
  // NewAPI 各版本在 p/page 与 size/page_size 之间不统一，同时提供两套命名。
  // 只拉取 nai-* 模型：后端按 model_name 过滤，总数也只统计 NAI 记录。
  const params = new URLSearchParams({
    p: String(page),
    page: String(page),
    size: "20",
    page_size: "20",
    model_name: "nai-",
  });
  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/log/self?${params}`, {
      headers: userHeaders(session),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json();
    if (!upstream.ok || !result.success)
      throw new Error(result.message || "无法读取使用记录");
    const source = result.data || {};
    return NextResponse.json({
      items: Array.isArray(source) ? source : source.items || source.data || [],
      total: Number(source.total || source.total_count || 0),
      page,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取使用记录";
    if (isUpstreamAuthError(message))
      return NextResponse.json(
        { message: "登录状态已过期，请重新登录", sessionExpired: true },
        { status: 401 },
      );
    return NextResponse.json({ message }, { status: 502 });
  }
}
