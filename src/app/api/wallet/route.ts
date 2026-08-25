import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { newApiBaseUrl, userHeaders } from "@/lib/newapi";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看余额钱包" },
      { status: 401 },
    );
  try {
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
    return NextResponse.json({
      newApi: {
        balance: Number(user?.quota || 0) / quotaPerUnit,
        used: Number(user?.used_quota || 0) / quotaPerUnit,
        group: user?.group || "未知",
      },
      aff: { enabled: false, balance: 0 },
      rechargeEnabled: false,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "无法读取钱包余额" },
      { status: 502 },
    );
  }
}
