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
    // 同时取用户可选分组，创建密钥时用；失败不影响密钥列表。
    let groups: Array<{ name: string; desc: string; ratio: number }> = [];
    try {
      const groupResponse = await fetch(
        `${newApiBaseUrl()}/api/user/self/groups`,
        {
          headers: auth.headers,
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        },
      );
      const groupResult = await groupResponse.json();
      const data = groupResult?.data;
      if (groupResponse.ok && groupResult.success && data && typeof data === "object") {
        groups = Object.entries(data as Record<string, unknown>)
          .filter(([, value]) => value && typeof value === "object")
          .map(([name, value]) => {
            const info = value as { desc?: unknown; ratio?: unknown };
            return {
              name,
              desc: typeof info.desc === "string" ? info.desc : "",
              ratio: Number(info.ratio) || 0,
            };
          });
      }
    } catch {
      // 分组读取失败时仅省略，前端隐藏分组选择即可。
    }
    return NextResponse.json({
      items: Array.isArray(source) ? source : source.items || [],
      groups,
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
  const group = optionalString(raw.group)?.trim() || "";
  if (group.length > 50)
    return NextResponse.json({ message: "分组名不合法" }, { status: 400 });
  const unlimitedQuota = raw.unlimitedQuota !== false;
  // NewAPI 以配额整数计（500000 = $1）；无限额度时忽略额度值。
  let remainQuota = 0;
  if (!unlimitedQuota) {
    const dollars = Number(raw.remainDollars);
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000_000)
      return NextResponse.json(
        { message: "额度需为 0–1000000000 的美元数" },
        { status: 400 },
      );
    remainQuota = Math.round(dollars * 500_000);
  }
  // 过期时间：-1 永不过期；否则为 epoch 秒。
  let expiredTime = -1;
  if (raw.expireDays != null) {
    const days = Number(raw.expireDays);
    if (!Number.isFinite(days) || days < 0 || days > 3650)
      return NextResponse.json(
        { message: "有效期需为 0–3650 天（0 表示永不过期）" },
        { status: 400 },
      );
    expiredTime = days > 0 ? Math.floor(Date.now() / 1000) + days * 86400 : -1;
  }
  // 模型限制：逗号分隔的模型名列表；空串表示不限制。
  const modelLimitsRaw = optionalString(raw.modelLimits) ?? "";
  const modelLimitsEnabled = modelLimitsRaw.trim().length > 0;
  const modelLimits = modelLimitsRaw
    .split(/[,，\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 100)
    .join(",");
  const allowIps = (optionalString(raw.allowIps) ?? "")
    .split(/[,，\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20)
    .join(",");
  if (allowIps && allowIps.split(",").some((ip) => !/^[\w.:/-]+$/.test(ip)))
    return NextResponse.json(
      { message: "IP 限制格式不正确（仅支持 IP/CIDR，逗号分隔）" },
      { status: 400 },
    );

  try {
    const upstream = await fetch(`${newApiBaseUrl()}/api/token/`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        name,
        expired_time: expiredTime,
        remain_quota: remainQuota,
        unlimited_quota: unlimitedQuota,
        model_limits_enabled: modelLimitsEnabled,
        model_limits: modelLimits,
        allow_ips: allowIps,
        group,
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
