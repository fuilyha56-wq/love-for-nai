import { afterEach, describe, expect, it } from "vitest";
import {
  privateKey,
  SlidingWindowRateLimiter,
  trustedClientKey,
} from "@/lib/rate-limit";

const originalTrustProxy = process.env.LFN_TRUST_PROXY;

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.LFN_TRUST_PROXY;
  else process.env.LFN_TRUST_PROXY = originalTrustProxy;
});

describe("SlidingWindowRateLimiter", () => {
  it("blocks requests after the configured limit and reports retry time", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1_000 });

    expect(limiter.check("user", 0).allowed).toBe(true);
    expect(limiter.check("user", 100).allowed).toBe(true);
    expect(limiter.check("user", 200)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("allows requests again after the sliding window expires", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 1_000 });

    expect(limiter.check("user", 0).allowed).toBe(true);
    expect(limiter.check("user", 999).allowed).toBe(false);
    expect(limiter.check("user", 1_000).allowed).toBe(true);
  });

  it("fails closed when the tracked-key capacity is exhausted", () => {
    const limiter = new SlidingWindowRateLimiter({
      limit: 2,
      windowMs: 1_000,
      maxKeys: 1,
    });

    expect(limiter.check("first", 0).allowed).toBe(true);
    expect(limiter.check("second", 1).allowed).toBe(false);
    expect(limiter.check("second", 1_000).allowed).toBe(true);
  });
});

describe("trustedClientKey", () => {
  it("ignores forwarded headers unless the proxy is trusted", () => {
    delete process.env.LFN_TRUST_PROXY;
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "203.0.113.7" },
    });
    expect(trustedClientKey(request)).toBeNull();
  });

  it("accepts only a valid IP from a trusted proxy", () => {
    process.env.LFN_TRUST_PROXY = "true";
    const valid = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "203.0.113.7, 10.0.0.1" },
    });
    const invalid = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "not-an-ip" },
    });
    expect(trustedClientKey(valid)).toBe("203.0.113.7");
    expect(trustedClientKey(invalid)).toBeNull();
  });
});

it("hashes private rate-limit keys without retaining the source value", () => {
  const hashed = privateKey("person@example.com");
  expect(hashed).toHaveLength(64);
  expect(hashed).not.toContain("person@example.com");
  expect(hashed).toBe(privateKey("person@example.com"));
});
