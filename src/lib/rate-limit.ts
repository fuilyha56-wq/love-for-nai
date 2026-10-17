import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { resolveClientIp } from "./risk-ip";

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  maxKeys?: number;
};

// 进程内滑动窗口限流器。多副本部署时应换成 Redis 等共享存储。
export class SlidingWindowRateLimiter {
  private readonly requests = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor({ limit, windowMs, maxKeys = 5_000 }: RateLimiterOptions) {
    if (!Number.isInteger(limit) || limit <= 0)
      throw new Error("Rate limit must be a positive integer");
    if (!Number.isFinite(windowMs) || windowMs <= 0)
      throw new Error("Rate limit window must be positive");
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  check(key: string, now = Date.now(), configuredLimit = this.limit): RateLimitResult {
    const limit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : this.limit;
    // Insertion order tracks last access. Bound cleanup work per check rather
    // than scanning every active caller on the hot path.
    let cleanupBudget = 64;
    while (cleanupBudget-- > 0) {
      const first = this.requests.entries().next().value as [string, number[]] | undefined;
      if (!first || first[1].some(time => now - time < this.windowMs)) break;
      this.requests.delete(first[0]);
    }

    if (this.requests.size >= this.maxKeys && !this.requests.has(key))
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
      };

    const recent = (this.requests.get(key) || []).filter(
      (time) => now - time < this.windowMs,
    );
    this.requests.delete(key);
    if (recent.length >= limit) {
      this.requests.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((this.windowMs - (now - recent[0])) / 1000),
        ),
      };
    }

    recent.push(now);
    this.requests.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  clear() {
    this.requests.clear();
  }
}

// 只有受信反向代理覆盖该头时才使用客户端 IP，避免调用方自行伪造。
export function trustedClientKey(
  request: Pick<Request, "headers">,
): string | null {
  if (process.env.LFN_TRUST_PROXY !== "true") return null;
  const ip = resolveClientIp(request as Request).ip;
  return ip && isIP(ip) ? ip : null;
}

export function privateKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
