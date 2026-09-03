import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { resolvedNewApiBaseUrl, userHeaders } from "@/lib/newapi";
import { affStatus, adjustAff } from "@/lib/aff";
import { createLocalUser, listLocalUsers, publicLocalUser } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import { runtimeQuotaPerUnit } from "@/lib/runtime-config";
import {
  invalidJsonResponse,
  optionalNumber,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const page = params.get("p") || "1";
  const size = params.get("size") || "20";
  const keyword = params.get("keyword") || "";
  try {
    if ((await resolvedAuthProviderId()) === "local") {
      const listed = await listLocalUsers({
        page: Number(page) || 1,
        size: Number(size) || 20,
        keyword,
      });
      const enriched = await Promise.all(
        listed.items.map(async (user) => ({
          ...user,
          aff: await affStatus(Number(user.id)).catch(() => null),
        })),
      );
      return NextResponse.json({
        items: enriched,
        total: listed.total,
        quotaPerUnit: await runtimeQuotaPerUnit(),
      });
    }
    const query = new URLSearchParams({ p: page, size });
    if (keyword) query.set("keyword", keyword);
    const upstream = await fetch(`${await resolvedNewApiBaseUrl()}/api/user/?${query}`, {
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
    const enriched = await Promise.all(
      (items as Array<Record<string, unknown>>).map(async (user) => ({
        ...user,
        aff: await affStatus(Number(user.id)).catch(() => null),
      })),
    );
    return NextResponse.json({
      items: enriched,
      total,
      quotaPerUnit: await runtimeQuotaPerUnit(),
    });
  } catch {
    return NextResponse.json({ message: "暂时无法连接账号服务" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  if ((await resolvedAuthProviderId()) !== "local")
    return NextResponse.json({ message: "当前账号上游不支持在此创建用户" }, { status: 400 });
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const username = optionalString(raw.username)?.trim() || "";
  const password = optionalString(raw.password) || "";
  const displayName = optionalString(raw.displayName)?.trim();
  const email = optionalString(raw.email)?.trim();
  const credits = optionalNumber(raw.credits) ?? 0;
  if (!username) return NextResponse.json({ message: "缺少用户名" }, { status: 400 });
  if (password.length < 8 || password.length > 64)
    return NextResponse.json({ message: "密码需为 8–64 个字符" }, { status: 400 });
  if (!Number.isInteger(credits) || credits < 0)
    return NextResponse.json({ message: "初始额度必须是非负整数" }, { status: 400 });
  try {
    const user = await createLocalUser({ username, password, displayName, email });
    if (credits > 0)
      await adjustAff(user.id, credits, `管理员发放初始额度（${gate.session.username}）`);
    return NextResponse.json({
      item: {
        ...publicLocalUser(user),
        aff: await affStatus(user.id).catch(() => null),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "创建用户失败" },
      { status: 400 },
    );
  }
}
