import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { LFN_MODEL_GROUP, resolvedNewApiBaseUrl, selectModelGroup, userHeaders } from "@/lib/newapi";
import { snapshotFromRawPricing } from "@/lib/image-pricing";
import { runtimeModelFixedCost } from "@/lib/runtime-config";

// 计费预期：把当前模型的 NewAPI 计价信息 + 用户分组倍率发给前端，
// 前端用实测公式实时估算消耗。
export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const model = new URL(request.url).searchParams.get("model") || "";
  if (!model)
    return NextResponse.json({ message: "缺少 model 参数" }, { status: 400 });

  const headers = userHeaders(session);
  try {
    // 与实际取图像密钥时使用同一组用户权限和模型渠道。
    const baseUrl = await resolvedNewApiBaseUrl();
    const [pricingResponse, selfResponse, groupsResponse] = await Promise.all([
      fetch(`${baseUrl}/api/pricing`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }),
      fetch(`${baseUrl}/api/user/self`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(`${baseUrl}/api/user/self/groups`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!pricingResponse.ok)
      return NextResponse.json({ message: "无法读取模型计价" }, { status: 502 });
    if (!selfResponse.ok || !groupsResponse.ok)
      return NextResponse.json({ message: "无法读取用户分组倍率" }, { status: 502 });
    const pricing = (await pricingResponse.json()) as {
      data?: Array<{
        model_name?: string;
        model_ratio?: number;
        model_price?: number;
        quota_type?: number;
        enable_groups?: string[];
        billing_mode?: string;
        billing_expr?: string;
      }>;
    };
    const entry = pricing.data?.find((item) => item.model_name === model);
    if (!entry)
      return NextResponse.json({ message: "模型不存在" }, { status: 404 });

    const self = (await selfResponse.json()) as {
      success?: boolean;
      data?: { group?: string; user?: { group?: string } };
    };
    const groups = (await groupsResponse.json()) as {
      success?: boolean;
      data?: Record<string, { ratio?: number }> | string[];
    };
    if (self.success !== true || groups.success !== true || !groups.data)
      return NextResponse.json({ message: "无法读取用户分组倍率" }, { status: 502 });
    const selfGroup = self.data?.user?.group ?? self.data?.group;
    const usableGroups = Array.isArray(groups.data)
      ? groups.data.filter((item): item is string => typeof item === "string")
      : Object.keys(groups.data);
    const modelGroups = entry.enable_groups?.filter((item) => typeof item === "string") ?? [];
    const effectiveGroup = selectModelGroup(modelGroups, usableGroups, selfGroup, LFN_MODEL_GROUP);
    if (!effectiveGroup)
      return NextResponse.json({ message: "当前账号没有该模型的可用分组" }, { status: 403 });
    const groupDetails = Array.isArray(groups.data) ? undefined : groups.data[effectiveGroup];
    const groupRatio = groupDetails?.ratio;
    if (typeof groupRatio !== "number" || !Number.isFinite(groupRatio) || groupRatio < 0)
      return NextResponse.json({ message: "无法读取用户分组倍率" }, { status: 502 });

    const snapshot = snapshotFromRawPricing(model, entry, groupRatio, effectiveGroup);
    // 管理员配置了固定 AFF 单价时透出给前端，Studio 优先按它估算。
    const affFixedCost = await runtimeModelFixedCost(model);
    return NextResponse.json({ ...snapshot, affFixedCost });
  } catch {
    return NextResponse.json({ message: "暂时无法连接账号服务" }, { status: 502 });
  }
}
