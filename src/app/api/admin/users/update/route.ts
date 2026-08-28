import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";
import {
  invalidJsonResponse,
  optionalNumber,
  optionalString,
  parseJsonBody,
} from "@/lib/request";
import { adjustAff } from "@/lib/aff";

const QUOTA_PER_UNIT = () => Number(process.env.QUOTA_PER_UNIT || 500000);

// 修改用户：密码 / 显示名 / 备注 / 分组 / NewAPI 余额（USD）/ AFF 调整。
export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ message: gate.error }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const userId = optionalNumber(raw.id);
  if (!userId) return NextResponse.json({ message: "缺少用户 id" }, { status: 400 });
  const username = optionalString(raw.username)?.trim() || "";
  if (!username) return NextResponse.json({ message: "缺少用户名" }, { status: 400 });

  const password = optionalString(raw.password)?.trim() || "";
  const displayName = optionalString(raw.displayName);
  const remark = optionalString(raw.remark);
  const group = optionalString(raw.group)?.trim() || "";
  const balanceUsdRaw = raw.balanceUsd;
  const balanceUsd = optionalNumber(balanceUsdRaw);
  const affDelta = optionalNumber(raw.affDelta);
  if (balanceUsdRaw !== undefined && balanceUsd === undefined)
    return NextResponse.json({ message: "NewAPI 余额必须是有效数字" }, { status: 400 });
  if (typeof affDelta === "undefined" && raw.affDelta !== undefined)
    return NextResponse.json({ message: "AFF 调整必须是有效数字" }, { status: 400 });
  if (typeof affDelta === "number" && !Number.isInteger(affDelta))
    return NextResponse.json({ message: "AFF 调整必须是整数" }, { status: 400 });

  if (password && (password.length < 8 || password.length > 64))
    return NextResponse.json({ message: "密码需为 8–64 个字符" }, { status: 400 });

  try {
    // 1. 基础资料走 NewAPI 管理接口 PUT /api/user/。
    const upstreamBody: Record<string, unknown> = { id: userId };
    if (password) upstreamBody.password = password;
    if (typeof displayName === "string") upstreamBody.display_name = displayName;
    if (typeof remark === "string") upstreamBody.remark = remark;
    if (group) upstreamBody.group = group;
    if (typeof balanceUsd === "number") {
      if (balanceUsd < 0)
        return NextResponse.json({ message: "余额不能为负数" }, { status: 400 });
      upstreamBody.quota = Math.round(balanceUsd * QUOTA_PER_UNIT());
    }
    const upstream = await fetch(`${newApiBaseUrl()}/api/user/`, {
      method: "PUT",
      headers: userHeaders(gate.session),
      body: JSON.stringify(upstreamBody),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await upstream.json()) as { success?: boolean; message?: string };
    if (!upstream.ok || !result.success)
      return NextResponse.json(
        { message: result.message || "用户信息更新失败" },
        { status: upstream.ok ? 400 : upstream.status },
      );

    // 2. AFF 增减（正数发放 / 负数回收）。
    if (typeof affDelta === "number" && Number.isInteger(affDelta) && affDelta !== 0) {
      try {
        await adjustAff(
          userId,
          affDelta,
          `管理员调整（${gate.session.username}）`,
        );
      } catch (error) {
        return NextResponse.json(
          {
            message: `用户信息已更新，但 AFF 调整失败：${error instanceof Error ? error.message : "未知错误"}`,
          },
          { status: 400 },
        );
      }
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ message: "暂时无法连接账号服务" }, { status: 502 });
  }
}
