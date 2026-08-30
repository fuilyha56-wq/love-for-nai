import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  checkPurchaseRateLimit,
  imagePackageProduct,
  normalizePackageRequest,
  purchaseImagePackages,
  readImagePackageOrder,
  orderResponse,
} from "@/lib/image-packages";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看图包订单", sessionExpired: true },
      { status: 401 },
    );
  const requestId = new URL(request.url).searchParams.get("requestId") || "";
  if (!requestId)
    return NextResponse.json({ message: "缺少订单请求编号" }, { status: 400 });
  const order = await readImagePackageOrder(session.userId, requestId);
  if (!order)
    return NextResponse.json({ message: "图包订单不存在" }, { status: 404 });
  return NextResponse.json(orderResponse(order));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后购买图包", sessionExpired: true },
      { status: 401 },
    );
  const product = imagePackageProduct();
  if (!product.purchaseEnabled)
    return NextResponse.json(
      { message: "图包购买服务尚未启用，请联系管理员", product },
      { status: 503 },
    );

  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  let normalized: ReturnType<typeof normalizePackageRequest>;
  try {
    normalized = normalizePackageRequest(raw);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "图包数量无效" },
      { status: 400 },
    );
  }

  // 已完成/失败订单是幂等查询，不应因为重复点击消耗购买限流次数。
  const existing = await readImagePackageOrder(
    session.userId,
    normalized.requestId,
  );
  if (existing)
    return NextResponse.json(orderResponse(existing), {
      status: existing.status === "completed" ? 200 : 409,
    });

  const rate = checkPurchaseRateLimit(session.userId);
  if (!rate.allowed)
    return NextResponse.json(
      { message: "购买请求过于频繁，请稍后再试", retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );

  try {
    const result = await purchaseImagePackages(
      session.userId,
      normalized.requestId,
      normalized.packageCount,
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "图包购买失败";
    return NextResponse.json({ message }, { status: 400 });
  }
}
