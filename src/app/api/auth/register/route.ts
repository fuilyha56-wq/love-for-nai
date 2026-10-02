import { NextResponse } from "next/server";
import { callNewApi } from "@/lib/login";
import { resolvedNewApiBaseUrl } from "@/lib/newapi";
import {
  canonicalReferralLink,
  redeemReferral,
} from "@/lib/referral";
import { createLocalUser } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import { getRuntimeSettings } from "@/lib/runtime-config";
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
import { createHash, randomUUID } from "node:crypto";

type UpstreamResult = { success?: boolean; message?: string };

const LANDING_QUERY_KEYS = new Set([
  "invite",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
]);

function safeInviteLandingPath(value: string | undefined, inviteCode: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "http://lfn.invalid");
    if (url.origin !== "http://lfn.invalid" || url.pathname !== "/sign-in") return undefined;
    const invite = url.searchParams.get("invite");
    if (!invite || invite !== inviteCode) return undefined;
    const safe = new URLSearchParams({ invite });
    for (const key of LANDING_QUERY_KEYS) {
      if (key === "invite") continue;
      const source = url.searchParams.get(key)?.trim() || "";
      if (/^[a-zA-Z0-9._~-]{1,64}$/.test(source)) safe.set(key, source);
    }
    return `/sign-in?${safe.toString()}`.slice(0, 512);
  } catch {
    return undefined;
  }
}

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
  rateLimitFallback: string,
): Promise<NextResponse> {
  try {
    const upstream = await fetch(`${await resolvedNewApiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await upstream.text();
    let result: UpstreamResult | null = null;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object")
        result = parsed as UpstreamResult;
    } catch {
      // 上游在网关错误或限流时可能返回空内容/HTML，统一转换为 JSON 响应。
    }

    if (!upstream.ok || result?.success !== true) {
      const status = upstream.ok ? (result ? 400 : 502) : upstream.status;
      const retryAfter = upstream.headers.get("Retry-After");
      const headers =
        status === 429 ? { "Retry-After": retryAfter || "60" } : undefined;
      return NextResponse.json(
        {
          message:
            result?.message || (status === 429 ? rateLimitFallback : fallback),
        },
        { status, headers },
      );
    }
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
    "验证码发送过于频繁，请稍后再试",
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
  const inviteLandingPath = optionalString(raw.inviteLandingPath)?.trim().slice(0, 512) || undefined;
  const registrationRequestId = randomUUID();
  const trustedIp = trustedClientKey(request);
  const landingPath = safeInviteLandingPath(inviteLandingPath, inviteCode);
  const provenance = {
    landingPath,
    referer: request.headers.get("referer")?.slice(0, 512) || undefined,
    clientIpHash: trustedIp
      ? createHash("sha256").update(trustedIp).digest("hex")
      : undefined,
    userAgent: request.headers.get("user-agent")?.slice(0, 512) || undefined,
    requestId: registrationRequestId,
  };

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
  if ((await resolvedAuthProviderId()) !== "local" && !code)
    return NextResponse.json({ message: "请输入邮箱验证码" }, { status: 400 });

  const registrationRate = registrationEmailLimiter.check(
    privateKey(email.toLowerCase()),
  );
  if (!registrationRate.allowed)
    return tooManyRequests(
      registrationRate.retryAfterSeconds,
      "注册尝试过于频繁，请稍后再试",
    );

  if ((await resolvedAuthProviderId()) === "local") {
    try {
      const user = await createLocalUser({
        username,
        password,
        displayName: username,
        email,
      });
      if (inviteCode) {
        try {
          const settings = await getRuntimeSettings();
          const origin = settings.publicUrl || new URL(request.url).origin;
          await redeemReferral(inviteCode, user.id, {
            ...provenance,
            invitationLink: canonicalReferralLink(origin, inviteCode),
          });
        } catch {
          // 邀请失败不影响注册本身。
        }
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "注册失败" },
        { status: 400 },
      );
    }
  }

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
    "注册请求过于频繁，请稍后再试",
  );
  if (!registered.ok) return registered;

  // new-api 的注册接口会丢弃 group 字段（服务端白名单），新用户一律落到
  // default 分组。这里保持 default（用户面板体验正常），模型渠道权限由
  // LFN 托管密钥解决：注册后异步为用户预创建一把可用分组（如 Draw）的
  // 密钥，与生图时的托管回退共用同一把，NewAPI 余额照常计入本人。
  let loggedInUserId: number | null = null;
  try {
    const loginResult = await callNewApi("/api/user/login", {
      username,
      password,
    });
    const user = loginResult.result.data?.user ?? loginResult.result.data;
    if (loginResult.result.success && typeof user?.id === "number") {
      loggedInUserId = user.id;
      const { resolvedAdminTokenValue } = await import("@/lib/admin-auth");
      const token = await resolvedAdminTokenValue();
      if (token) {
        const { ensureManagedFallbackToken } = await import("@/lib/newapi-db");
        await ensureManagedFallbackToken(user.id, "nai-v4.5-full").catch(
          () => null,
        );
      }
    }
  } catch {
    // 注册已成功，但自动登录失败时不影响上游账号创建。
  }

  if (!inviteCode || loggedInUserId == null) return registered;

  try {
    const settings = await getRuntimeSettings();
    const origin = settings.publicUrl || new URL(request.url).origin;
    const reward = await redeemReferral(inviteCode, loggedInUserId, {
      ...provenance,
      invitationLink: canonicalReferralLink(origin, inviteCode),
    });
    return NextResponse.json({
      success: true,
      referralReward: reward.reward,
      referralApplied: reward.applied,
    });
  } catch {
    // 注册已成功，但邀请写入失败时不影响上游账号创建。
  }
  return registered;
}
