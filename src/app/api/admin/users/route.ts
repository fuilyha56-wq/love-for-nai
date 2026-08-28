import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";
import { affStatus } from "@/lib/aff";

// 用户列表（代理 NewAPI 管理端点，并补充 LFN AFF 余额）。
export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const page = params.get("p") || "1";
  const size = params.get("size") || "20";
  const keyword = params.get("keyword") || "";
  try {
    const query = new URLSearchParams({ p: page, size });
    if (keyword) query.set("keyword", keyword);
    const upstream = await fetch(`${newApiBaseUrl()}/api/user/?${query}`, {
      headers: userHeaders(gate.session),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await upstream.json()) as {
      success?: boolean;
      message?: string;
      data?: { items?: unknown[]; total?: number; page?: number } | unknown[];
    };
    if (!upstream.ok || !result.success)
      return NextResponse.json(
        { message: result.message || "无法读取用户列表" },
        { status: upstream.ok ? 400 : upstream.status },
      );
    const items = Array.isArray(result.data)
      ? result.data
      : result.data?.items || [];
    const total = Array.isArray(result.data) ? items.length : result.data?.total ?? items.length;
    // AFF 余额并行补齐（失败时静默为 null）。
    const enriched = await Promise.all(
      (items as Array<Record<string, unknown>>).map(async (user) => ({
        ...user,
        aff: await affStatus(Number(user.id)).catch(() => null),
      })),
    );
    return NextResponse.json({
      items: enriched,
      total,
      quotaPerUnit: Number(process.env.QUOTA_PER_UNIT || 500000),
    });
  } catch {
    return NextResponse.json({ message: "暂时无法连接账号服务" }, { status: 502 });
  }
}
