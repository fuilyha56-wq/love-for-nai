import { NextResponse } from "next/server";
import { affStatus } from "@/lib/aff";
import { imagePackageProduct } from "@/lib/image-packages";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError, newApiBaseUrl, userHeaders } from "@/lib/newapi";
import { getPlatformCapabilities } from "@/lib/platform";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看余额钱包", sessionExpired: true },
      { status: 401 },
    );
  try {
    const capabilities = getPlatformCapabilities();
    const aff = await affStatus(session.userId);
    const product = imagePackageProduct();
    let newApi: { balance: number; used: number; group: string } | null = null;
    if (capabilities.wallet.upstreamBalance) {
      const upstream = await fetch(`${newApiBaseUrl()}/api/user/self`, {
        headers: userHeaders(session),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const result = await upstream.json();
      if (!upstream.ok || !result.success)
        throw new Error(result.message || "无法读取钱包余额");
      const quotaPerUnit = Number(process.env.QUOTA_PER_UNIT || 500000);
      const user = result.data?.user ?? result.data;
      newApi = {
        balance: Number(user?.quota || 0) / quotaPerUnit,
        used: Number(user?.used_quota || 0) / quotaPerUnit,
        group: user?.group || "未知",
      };
    }
    return NextResponse.json({
      capabilities,
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
