import { NextResponse } from "next/server";
import { fetchNewApiSelf } from "@/lib/shared-user-self";
import { affStatus } from "@/lib/aff";
import { resolvedImagePackageProduct } from "@/lib/image-packages";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, resolvedNewApiBaseUrl, userHeaders } from "@/lib/newapi";
import { getResolvedPlatformCapabilities } from "@/lib/platform";
import { runtimeQuotaPerUnit } from "@/lib/runtime-config";
import { dailyImageBillingState } from "@/lib/daily-image-billing";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看余额钱包", sessionExpired: true },
      { status: 401 },
    );
  try {
    const capabilities = await getResolvedPlatformCapabilities();
    const [aff, product, dailyBilling] = await Promise.all([affStatus(session.userId), resolvedImagePackageProduct(), dailyImageBillingState(session.userId)]);
    let newApi: { balance: number; used: number; group: string } | null = null;
    if (capabilities.wallet.upstreamBalance) {
      const upstream = await fetchNewApiSelf(await resolvedNewApiBaseUrl(), userHeaders(session));
      const result = await upstream.json();
      if (!upstream.ok || !result.success)
        throw new Error(result.message || "无法读取钱包余额");
      const quotaPerUnit = await runtimeQuotaPerUnit();
      const user = result.data?.user ?? result.data;
      newApi = {
        balance: Number(user?.quota || 0) / quotaPerUnit,
        used: Number(user?.used_quota || 0) / quotaPerUnit,
        group: user?.group || "未配置分组",
      };
    }
    return NextResponse.json({
      capabilities,
      dailyBilling,
      newApi,
      aff: {
        enabled: capabilities.wallet.credits,
        ...aff,
      },
      imagePackage: {
        balance: aff.packageBalance,
        totalBalance: aff.totalBalance,
        ...product,
        purchaseEnabled: capabilities.wallet.packages && product.purchaseEnabled,
      },
      rechargeEnabled: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取钱包余额";
    if (isUpstreamAuthError(message))
      return NextResponse.json(
        { message: "登录状态已过期，请重新登录", sessionExpired: true },
        { status: 401 },
      );
    return NextResponse.json({ message }, { status: 502 });
  }
}
