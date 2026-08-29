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
// new-api 的两条上游约束（实测 + 源码确认）：
// 1. PUT /api/user/ 必须带 username，漏传直接 Invalid parameters；
//    且它按列覆盖，username/display_name/group/remark 缺省会被写成空值。
// 2. quota 不走 PUT（EditWithTx 不含该列），必须 POST /api/user/manage
//    的 add_quota(override)。
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
  if (typeof balanceUsd === "number" && balanceUsd < 0)
    return NextResponse.json({ message: "余额不能为负数" }, { status: 400 });
  if (typeof affDelta === "undefined" && raw.affDelta !== undefined)
    return NextResponse.json({ message: "AFF 调整必须是有效数字" }, { status: 400 });
  if (typeof affDelta === "number" && !Number.isInteger(affDelta))
    return NextResponse.json({ message: "AFF 调整必须是整数" }, { status: 400 });

  if (password && (password.length < 8 || password.length > 64))
    return NextResponse.json({ message: "密码需为 8–64 个字符" }, { status: 400 });
  if (remark !== undefined && remark.length > 255)
    return NextResponse.json({ message: "备注最多 255 个字符" }, { status: 400 });

  try {
    // 1. 先取当前资料：PUT 按列覆盖，缺省字段必须回填当前值，否则会被清空。
    const currentResponse = await fetch(
      `${newApiBaseUrl()}/api/user/${userId}`,
      {
        headers: userHeaders(gate.session),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    const currentResult = (await currentResponse.json()) as {
      success?: boolean;
      message?: string;
      data?: {
        username?: string;
        display_name?: string;
        group?: string;
        remark?: string;
        quota?: number;
      };
    };
    if (!currentResponse.ok || !currentResult.success || !currentResult.data)
      return NextResponse.json(
        { message: currentResult.message || "无法读取用户当前资料" },
        { status: currentResponse.ok ? 400 : currentResponse.status },
      );
    const current = currentResult.data;

    // 2. 基础资料走 NewAPI 管理接口 PUT /api/user/（username 必传）。
    const upstreamBody: Record<string, unknown> = {
      id: userId,
      username,
      display_name: displayName ?? current.display_name ?? "",
      remark: remark ?? current.remark ?? "",
      group: group || current.group || "default",
    };
    if (password) upstreamBody.password = password;
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

    // 3. 余额：POST /api/user/manage 的 add_quota(override)。
    //    与当前值相同时跳过，避免用弹窗打开时的旧值覆盖用户刚消费的额度。
    if (typeof balanceUsd === "number") {
      const quotaValue = Math.round(balanceUsd * QUOTA_PER_UNIT());
      if (quotaValue !== current.quota) {
        const quotaResponse = await fetch(
          `${newApiBaseUrl()}/api/user/manage`,
          {
            method: "POST",
            headers: userHeaders(gate.session),
            body: JSON.stringify({
              id: userId,
              action: "add_quota",
              value: quotaValue,
              mode: "override",
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          },
        );
        const quotaResult = (await quotaResponse.json()) as {
          success?: boolean;
          message?: string;
        };
        if (!quotaResponse.ok || !quotaResult.success)
          return NextResponse.json(
            {
              message: `资料已更新，但余额写入失败：${quotaResult.message || "上游拒绝该数值"}`,
            },
            { status: quotaResponse.ok ? 400 : quotaResponse.status },
          );
      }
    }

    // 4. AFF 增减（正数发放 / 负数回收）。
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
