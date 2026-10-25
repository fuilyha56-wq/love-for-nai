import { withRegistrationIdentity } from "@/lib/registration-identities";
import {
  DEFAULT_AUTH_POLICY,
  registrationEmailError,
  registrationMethodError,
  registrationUsernameMaxLength,
  type RegistrationMethod,
} from "@/lib/auth-policy";
import { resolvedAdminHeaders } from "@/lib/admin-auth";
import {
  consumeRegistrationEmail,
  sendRegistrationEmail,
  smtpConfigured,
} from "@/lib/registration-email";
import { NextResponse } from "next/server";
import {
  callNewApi,
  establishLocalSession,
  establishSession,
  requiresTwoFactor,
} from "@/lib/login";
import {
  newApiRegistrationAffCode,
  RegistrationInviteError,
  upstreamRegistrationPolicy,
} from "@/lib/newapi-registration";
import { resolvedNewApiBaseUrl } from "@/lib/newapi";
import {
  canonicalReferralLink,
  redeemReferral,
  findReferralByCode,
} from "@/lib/referral";
import { createLocalUser } from "@/lib/local-users";
import { resolvedAuthProviderId } from "@/lib/platform";
import { getRuntimeSettings, type RuntimeSettings } from "@/lib/runtime-config";
import { resolveTrustedClientIp } from "@/lib/risk-ip";
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

function safeInviteLandingPath(
  value: string | undefined,
  inviteCode: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "http://lfn.invalid");
    if (url.origin !== "http://lfn.invalid" || url.pathname !== "/sign-in")
      return undefined;
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
const registrationClientLimiter = new SlidingWindowRateLimiter({
  limit: 20,
  windowMs: TEN_MINUTES,
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
  request?: Request,
): Promise<NextResponse> {
  try {
    const headers = new Headers(init.headers);
    if (request) {
      try {
        const clientIp = (await resolveTrustedClientIp(request)).ip;
        if (clientIp) headers.set("X-Forwarded-For", clientIp);
      } catch {
        // Keep the upstream call available if proxy metadata cannot be resolved.
      }
    }
    const upstream = await fetch(`${await resolvedNewApiBaseUrl()}${path}`, {
      ...init,
      headers,
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

async function registrationContext(
  raw: Record<string, unknown>,
): Promise<
  | { error: NextResponse }
  | {
      settings: RuntimeSettings;
      method: RegistrationMethod;
      provider: string;
      upstreamEmailVerification?: boolean;
    }
> {
  let settings = { ...DEFAULT_AUTH_POLICY, ...(await getRuntimeSettings()) };
  // Legacy clients used the email registration flow without a method field.
  const method = raw.method === undefined ? "email" : raw.method;
  const message = registrationMethodError(settings, method);
  if (message)
    return { error: NextResponse.json({ message }, { status: 403 }) };
  const provider = await resolvedAuthProviderId();
  let upstreamEmailVerification: boolean | undefined;
  if (provider === "newapi") {
    try {
      const upstream = await upstreamRegistrationPolicy(settings);
      settings = upstream.settings;
      upstreamEmailVerification = upstream.emailVerification;
    } catch {
      return {
        error: NextResponse.json(
          { message: "账号注册服务暂时不可用，请稍后重试" },
          { status: 503 },
        ),
      };
    }
    const upstreamMessage = registrationMethodError(settings, method);
    if (upstreamMessage)
      return {
        error: NextResponse.json({ message: upstreamMessage }, { status: 403 }),
      };
  }
  if (method === "invite" || settings.requireInviteCode) {
    const invite = optionalString(raw.inviteCode)?.trim() || "";
    if (!invite || invite.length > 32 || !(await findReferralByCode(invite)))
      return {
        error: NextResponse.json(
          { message: "邀请码无效，请检查后重试" },
          { status: 400 },
        ),
      };
  }
  return {
    settings,
    method: method as RegistrationMethod,
    provider,
    upstreamEmailVerification,
  };
}

function requireUpstreamEmailVerification(enabled?: boolean) {
  if (enabled !== true)
    throw new Error(
      "上游尚未启用邮箱验证，请在 NewAPI 开启邮箱验证或配置本站 SMTP",
    );
}

// 发送邮箱验证码。
export async function PUT(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const context = await registrationContext(raw);
  if ("error" in context) return context.error;
  const { settings, provider } = context;
  if (!settings.requireEmailVerification)
    return NextResponse.json(
      { message: "当前注册无需邮箱验证码" },
      { status: 403 },
    );
  const email = optionalString(raw.email)?.trim().toLowerCase() || "";
  const emailError = registrationEmailError(settings, email);
  if (emailError)
    return NextResponse.json({ message: emailError }, { status: 400 });

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

  try {
    if (provider === "local" || smtpConfigured(settings)) {
      await sendRegistrationEmail(settings, email);
      return NextResponse.json({ success: true });
    }
    requireUpstreamEmailVerification(context.upstreamEmailVerification);
  } catch {
    return NextResponse.json(
      {
        message: "邮箱验证服务不可用，请联系管理员检查 SMTP 或上游邮箱验证配置",
      },
      { status: 503 },
    );
  }
  return forward(
    `/api/verification?email=${encodeURIComponent(email)}`,
    { method: "GET" },
    "验证码发送失败",
    "验证码发送过于频繁，请稍后再试",
    request,
  );
}

export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await parseJsonBody<Record<string, unknown>>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const context = await registrationContext(raw);
  if ("error" in context) return context.error;
  const { settings, method, provider } = context;
  const username = optionalString(raw.username)?.trim() || "";
  const password = optionalString(raw.password) || "";
  const email = optionalString(raw.email)?.trim().toLowerCase() || "";
  const code = optionalString(raw.verificationCode)?.trim() || "";
  const inviteCode = optionalString(raw.inviteCode)?.trim() || "";
  const inviteLandingPath =
    optionalString(raw.inviteLandingPath)?.trim().slice(0, 512) || undefined;
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

  const usernameMax = registrationUsernameMaxLength(provider);
  if (
    !/^[a-zA-Z0-9_\-.]{3,32}$/.test(username) ||
    username.length > usernameMax
  )
    return NextResponse.json(
      { message: `用户名需为 3–${usernameMax} 位字母、数字或 _-.` },
      { status: 400 },
    );
  if (password.length < 8 || password.length > 64)
    return NextResponse.json(
      { message: "密码需为 8–64 个字符" },
      { status: 400 },
    );
  const needsEmail =
    method === "email" ||
    settings.requireEmailVerification ||
    settings.emailDomainRestrictionEnabled;
  if (needsEmail || email) {
    const emailError = registrationEmailError(settings, email);
    if (emailError)
      return NextResponse.json({ message: emailError }, { status: 400 });
  }
  if (settings.requireEmailVerification && !code)
    return NextResponse.json({ message: "请输入邮箱验证码" }, { status: 400 });

  const registrationRate = registrationEmailLimiter.check(
    privateKey(email || username.toLowerCase()),
  );
  if (!registrationRate.allowed)
    return tooManyRequests(
      registrationRate.retryAfterSeconds,
      "注册尝试过于频繁，请稍后再试",
    );

  const clientRate = registrationClientLimiter.check(trustedIp || "unknown");
  if (!clientRate.allowed)
    return tooManyRequests(
      clientRate.retryAfterSeconds,
      "注册尝试过于频繁，请稍后再试",
    );
  const ownEmailVerification = provider === "local" || smtpConfigured(settings);
  if (settings.requireEmailVerification) {
    try {
      if (ownEmailVerification) {
        if (!(await consumeRegistrationEmail(email, code)))
          return NextResponse.json(
            { message: "邮箱验证码错误或已过期" },
            { status: 400 },
          );
      } else {
        requireUpstreamEmailVerification(context.upstreamEmailVerification);
      }
    } catch {
      return NextResponse.json(
        { message: "邮箱验证服务不可用，请联系管理员检查配置" },
        { status: 503 },
      );
    }
  }

  return withRegistrationIdentity(
    email,
    username,
    settings.requireEmailVerification,
    async () => {
      if (provider === "local") {
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
          try {
            const session = await establishLocalSession(
              user,
              raw.remember === true,
            );
            return registrationSuccess(session);
          } catch {
            return registrationSuccess();
          }
        } catch (error) {
          return NextResponse.json(
            { message: error instanceof Error ? error.message : "注册失败" },
            { status: 400 },
          );
        }
      }

      const adminRegistration =
        !settings.requireEmailVerification || ownEmailVerification;
      let affCode = "";
      if (!adminRegistration) {
        try {
          affCode = await newApiRegistrationAffCode(inviteCode);
        } catch (error) {
          return NextResponse.json(
            {
              message:
                error instanceof RegistrationInviteError
                  ? error.message
                  : "邀请验证服务暂时不可用",
            },
            {
              status:
                error instanceof RegistrationInviteError ? error.status : 503,
            },
          );
        }
      }
      let adminHeaders: Record<string, string> | undefined;
      if (adminRegistration) {
        try {
          adminHeaders = await resolvedAdminHeaders();
          if (email) {
            const lookup = await fetch(
              `${await resolvedNewApiBaseUrl()}/api/user/search?keyword=${encodeURIComponent(email)}&p=1&size=100`,
              {
                headers: adminHeaders,
                cache: "no-store",
                signal: AbortSignal.timeout(15_000),
              },
            );
            const result = await lookup.json();
            if (!lookup.ok || result.success !== true)
              throw new Error("无法检查邮箱身份");
            const users = Array.isArray(result.data)
              ? result.data
              : result.data?.items || [];
            if (
              users.some(
                (user: { email?: string }) =>
                  user.email?.toLowerCase() === email,
              )
            )
              return NextResponse.json(
                { message: "邮箱已被占用" },
                { status: 400 },
              );
          }
        } catch {
          return NextResponse.json(
            { message: "此注册方式需要配置 NewAPI 管理员令牌，请联系管理员" },
            { status: 503 },
          );
        }
      }
      const registered = await forward(
        adminRegistration ? "/api/user/" : "/api/user/register",
        {
          method: "POST",
          headers: adminHeaders || { "Content-Type": "application/json" },
          body: JSON.stringify(
            adminRegistration
              ? {
                  username,
                  password,
                  display_name: username,
                  role: 1,
                  group: "default",
                }
              : {
                  username,
                  password,
                  password2: password,
                  email,
                  verification_code: code,
                  aff_code: affCode,
                },
          ),
        },
        "注册失败",
        "注册请求过于频繁，请稍后再试",
        request,
      );
      if (!registered.ok) return registered;

      // new-api 的注册接口会丢弃 group 字段（服务端白名单），新用户一律落到
      // default 分组。这里保持 default（用户面板体验正常），模型渠道权限由
      // LFN 托管密钥解决：注册后异步为用户预创建一把可用分组（如 Draw）的
      // 密钥，与生图时的托管回退共用同一把，NewAPI 余额照常计入本人。
      let loggedInUserId: number | null = null;
      let session: NextResponse | undefined;
      try {
        const loginResult = await callNewApi(
          "/api/user/login",
          {
            username,
            password,
          },
          request,
        );
        const user = loginResult.result.data?.user ?? loginResult.result.data;
        if (
          loginResult.result.success &&
          !requiresTwoFactor(loginResult.result) &&
          typeof user?.id === "number"
        ) {
          loggedInUserId = user.id;
          try {
            const established = await establishSession(
              loginResult.result,
              loginResult.response,
              raw.remember === true,
            );
            if (established.ok) session = established;
          } catch {
            // The account exists. Offer normal sign-in if session creation fails.
          }
          const { resolvedAdminTokenValue } = await import("@/lib/admin-auth");
          const token = await resolvedAdminTokenValue();
          if (token) {
            const { ensureManagedFallbackToken } =
              await import("@/lib/newapi-db");
            await ensureManagedFallbackToken(user.id, "nai-v4.5-full").catch(
              () => null,
            );
          }
        }
      } catch {
        // 注册已成功，但自动登录失败时不影响上游账号创建。
      }

      if (!inviteCode || loggedInUserId == null)
        return registrationSuccess(session);

      try {
        const settings = await getRuntimeSettings();
        const origin = settings.publicUrl || new URL(request.url).origin;
        const reward = await redeemReferral(inviteCode, loggedInUserId, {
          ...provenance,
          invitationLink: canonicalReferralLink(origin, inviteCode),
        });
        return registrationSuccess(session, {
          referralReward: reward.reward,
          referralApplied: reward.applied,
        });
      } catch {
        // 注册已成功，但邀请写入失败时不影响上游账号创建。
      }
      return registrationSuccess(session);
    },
  );
}

function registrationSuccess(
  session?: NextResponse,
  extra: Record<string, unknown> = {},
) {
  const response = NextResponse.json({
    success: true,
    signedIn: Boolean(session?.ok),
    ...extra,
  });
  if (session?.ok) {
    for (const cookie of session.cookies.getAll()) response.cookies.set(cookie);
  }
  return response;
}
