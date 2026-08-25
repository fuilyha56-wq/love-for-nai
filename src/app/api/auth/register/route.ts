import { NextResponse } from "next/server";
import { newApiBaseUrl } from "@/lib/newapi";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";

type UpstreamResult = { success: boolean; message?: string };

async function forward(
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<NextResponse> {
  try {
    const upstream = await fetch(`${newApiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await upstream.json()) as UpstreamResult;
    if (!upstream.ok || !result.success)
      return NextResponse.json(
        { message: result.message || fallback },
        { status: upstream.status === 200 ? 400 : upstream.status },
      );
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { message: "暂时无法连接账号服务" },
      { status: 502 },
    );
  }
}

// 发送邮箱验证码。
export async function PUT(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const email = optionalString(raw.email)?.trim() || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120)
    return NextResponse.json({ message: "请输入有效的邮箱地址" }, { status: 400 });
  return forward(
    `/api/verification?email=${encodeURIComponent(email)}`,
    { method: "GET" },
    "验证码发送失败",
  );
}

export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const username = optionalString(raw.username)?.trim() || "";
  const password = optionalString(raw.password) || "";
  const email = optionalString(raw.email)?.trim() || "";
  const code = optionalString(raw.verificationCode)?.trim() || "";
  const affCode = optionalString(raw.affCode)?.trim() || "";

  if (!/^[a-zA-Z0-9_\-.]{3,32}$/.test(username))
    return NextResponse.json(
      { message: "用户名需为 3–32 位字母、数字或 _-." },
      { status: 400 },
    );
  if (password.length < 8 || password.length > 64)
    return NextResponse.json(
      { message: "密码需为 8–64 个字符" },
      { status: 400 },
    );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return NextResponse.json({ message: "请输入有效的邮箱地址" }, { status: 400 });
  if (!code)
    return NextResponse.json({ message: "请输入邮箱验证码" }, { status: 400 });

  return forward(
    "/api/user/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        password2: password,
        email,
        verification_code: code,
        aff_code: affCode,
      }),
    },
    "注册失败",
  );
}
