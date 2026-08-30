import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";

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
    // 并行取模型计价 + 用户分组（含倍率）。
    const [pricingResponse, selfResponse] = await Promise.all([
      fetch(`${newApiBaseUrl()}/api/pricing`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }),
      fetch(`${newApiBaseUrl()}/api/user/self`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!pricingResponse.ok)
      return NextResponse.json({ message: "无法读取模型计价" }, { status: 502 });
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

    // 两档计费（tiered_expr）：p < 100 走档内固定价，否则按 token 动态计价。
    // 实测换算：quota = p × 系数 × 0.5（Draw 渠道），$1 = 500000 quota；
    // 档内 p=8（V5），故 档内价 = limit 系数 × 8e-6，档外单价 = full 系数 × 1e-6。
    const tieredExpr =
      entry.billing_mode === "tiered_expr" && typeof entry.billing_expr === "string"
        ? entry.billing_expr
        : "";
    const limitCoeff = tieredExpr.match(
      /tier\(\s*["']limit["']\s*,\s*p\s*\*\s*(\d+)\s*\)/,
    );
    const fullCoeff = tieredExpr.match(
      /tier\(\s*["']full["']\s*,\s*p\s*\*\s*(\d+)\s*\)/,
    );
    const tiered = Boolean(limitCoeff && fullCoeff);

    // 用户分组倍率：self 接口返回 group 名，倍率要查 GroupRatio 配置。
    // NewAPI 的 /api/user/self/groups 返回 {组名: {desc, ratio}} 映射。
    let groupRatio = 1;
    let groupName = "";
    if (selfResponse.ok) {
      const self = (await selfResponse.json()) as {
        data?: { group?: string; user?: { group?: string } };
      };
      groupName = self.data?.user?.group ?? self.data?.group ?? "";
    }
    // 密钥分组逻辑与 newapi.ts 一致：图像模型优先渠道 Draw 分组。
    const modelGroups = entry.enable_groups ?? [];
    const effectiveGroup =
      modelGroups.find((group) => group.toLowerCase() === "draw") ||
      groupName ||
      modelGroups[0] ||
      "default";
    try {
      const groupsResponse = await fetch(
        `${newApiBaseUrl()}/api/user/self/groups`,
        {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (groupsResponse.ok) {
        const groups = (await groupsResponse.json()) as {
          data?: Record<string, { ratio?: number }>;
        };
        const ratio = groups.data?.[effectiveGroup]?.ratio;
        if (typeof ratio === "number" && Number.isFinite(ratio))
          groupRatio = ratio;
      }
    } catch {
      // 倍率读取失败按 1 计。
    }

    return NextResponse.json({
      model,
      modelRatio: entry.model_ratio ?? 0,
      modelPrice: entry.model_price ?? 0,
      quotaType: entry.quota_type ?? 0,
      effectiveGroup,
      groupRatio,
      ...(tiered && limitCoeff && fullCoeff
        ? {
            tiered: true,
            // 档内固定价（USD/张，V5=$8、V4.5=$0）与档外动态价（USD/张）。
            // 实测换算（Draw 渠道倍率 0.5，500000 quota=$1）：
            // 档内 p=8 → 8 × limit系数 × 0.5 ÷ 500000；
            // 档外 p=pixels/500 → tokens × full系数 × 0.5 ÷ 500000。
            inEnvelopeUsd:
              (8 * Number(limitCoeff[1]) * 0.5 * groupRatio) / 500_000,
            outOfEnvelopeUsdPerMillion:
              (Number(fullCoeff[1]) * 0.5 * groupRatio * 1_000_000) /
              500_000 /
              1_000_000,
          }
        : {}),
    });
  } catch {
    return NextResponse.json({ message: "暂时无法连接账号服务" }, { status: 502 });
  }
}
