import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isUpstreamAuthError } from "@/lib/newapi";
import { loadNewApiModels } from "@/lib/provider/newapi-models";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后查看可用模型", sessionExpired: true },
      { status: 401 },
    );
  try {
    return NextResponse.json({ items: await loadNewApiModels(session) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取可用模型";
    if (isUpstreamAuthError(message))
      return NextResponse.json(
        { message: "登录状态已过期，请重新登录", sessionExpired: true },
        { status: 401 },
      );
    return NextResponse.json({ message }, { status: 502 });
  }
}
