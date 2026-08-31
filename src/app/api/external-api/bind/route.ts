import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  bindExternalApiKey,
  verifyExternalApiKey,
} from "@/lib/external-api-bindings";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后绑定 API 密钥", sessionExpired: true },
      { status: 401 },
    );
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const authorization =
    typeof raw.authorization === "string" ? raw.authorization.trim() : "";
  if (!/^Bearer\s+\S+$/i.test(authorization))
    return NextResponse.json({ message: "缺少合法的 Bearer API 密钥" }, { status: 400 });
  try {
    await verifyExternalApiKey(authorization);
    await bindExternalApiKey(session.userId, authorization);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "API 密钥绑定失败" },
      { status: 400 },
    );
  }
}
