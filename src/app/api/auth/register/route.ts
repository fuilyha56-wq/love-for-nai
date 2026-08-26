import { NextResponse } from "next/server";
import { callNewApi } from "@/lib/login";
import { newApiBaseUrl } from "@/lib/newapi";
import { redeemReferral } from "@/lib/referral";
import {
  invalidJsonResponse,
  optionalString,
  parseJsonBody,
} from "@/lib/request";
import {
  privateKey,
  SlidingWindowRateLimiter,
  trustedClientKey,
} from "@/lib/rate-limit";

type UpstreamResult = { success: boolean; message?: string };

const TEN_MINUTES = 10 * 60_000;
const verificationEmailLimiter = new SlidingWindowRateLimiter({
  limit: 3,
  windowMs: TEN_MINUTES,
});
const verificationClientLimiter = new SlidingWindowRateLimiter({
  limit: 10,
  windowMs: TEN_MINUTES,
});
const verificationGlobalLimiter = new SlidingWindowRateLimiter({
  limit: 100,
  windowMs: TEN_MINUTES,
  maxKeys: 1,
});
const registrationEmailLimiter = new SlidingWindowRateLimiter({
  limit: 10,
  windowMs: TEN_MINUTES,
});

function tooManyRequests(retryAfterSeconds: number, message: string) {
  return NextResponse.json(
    { message },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

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
    return NextResponse.json(
      { message: "请输入有效的邮箱地址" },
      { status: 400 },
    );

  const now = Date.now();
  const globalRate = verificationGlobalLimiter.check("global", now);
  if (!globalRate.allowed)
    return tooManyRequests(
      globalRate.retryAfterSeconds,
      "验证码发送过于频繁，请稍后再试",
    );
  const client = trustedClientKey(request);
  if (client) {
    const clientRate = verificationClientLimiter.check(client, now);
    if (!clientRate.allowed)
      return tooManyRequests(
        clientRate.retryAfterSeconds,
        "验证码发送过于频繁，请稍后再试",
      );
  }
  const emailRate = verificationEmailLimiter.check(
    privateKey(email.toLowerCase()),
    now,
  );
  if (!emailRate.allowed)
    return tooManyRequests(
      emailRate.retryAfterSeconds,
      "该邮箱验证码发送过于频繁，请稍后再试",
    );

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
  const inviteCode = optionalString(raw.inviteCode)?.trim() || "";

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
    return NextResponse.json(
      { message: "请输入有效的邮箱地址" },
      { status: 400 },
    );
  if (!code)
    return NextResponse.json({ message: "请输入邮箱验证码" }, { status: 400 });

  const registrationRate = registrationEmailLimiter.check(
    privateKey(email.toLowerCase()),
  );
  if (!registrationRate.allowed)
    return tooManyRequests(
      registrationRate.retryAfterSeconds,
      "注册尝试过于频繁，请稍后再试",
    );

  const registered = await forward(
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
  if (!registered.ok || !inviteCode) return registered;

  try {
    const { result } = await callNewApi("/api/user/login", {
      username,
      password,
    });
    const user = result.data?.user ?? result.data;
    if (result.success && typeof user?.id === "number") {
      const reward = await redeemReferral(inviteCode, user.id);
      return NextResponse.json({ success: true, referralReward: reward.reward });
    }
  } catch {
    // 注册已成功，但自动登录失败时不影响上游账号创建。
  }
  return registered;
}
