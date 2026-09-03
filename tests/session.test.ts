import { describe, expect, it } from "vitest";
import { validateSessionConfiguration } from "@/lib/session";

describe("validateSessionConfiguration", () => {
  it("rejects a missing production secret", () => {
    expect(() =>
      validateSessionConfiguration({ NODE_ENV: "production" }),
    ).toThrow("LFN_SESSION_SECRET is required in production");
  });

  it("rejects short and public development secrets in production", () => {
    expect(() =>
      validateSessionConfiguration({
        NODE_ENV: "production",
        LFN_SESSION_SECRET: "short",
      }),
    ).toThrow("at least 32 bytes");
    expect(() =>
      validateSessionConfiguration({
        NODE_ENV: "production",
        LFN_SESSION_SECRET: "lfn-development-secret-change-me",
      }),
    ).toThrow("development default");
  });

  it("rejects the public placeholder secret in production", () => {
    expect(() =>
      validateSessionConfiguration({
        NODE_ENV: "production",
        LFN_SESSION_SECRET: "replace-with-at-least-32-random-bytes",
      }),
    ).toThrow("public or development default");
  });

  it("accepts a sufficiently long production secret", () => {
    expect(() =>
      validateSessionConfiguration({
        NODE_ENV: "production",
        LFN_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      }),
    ).not.toThrow();
  });

  it("allows the fallback only outside production", () => {
    expect(() =>
      validateSessionConfiguration({ NODE_ENV: "development" }),
    ).not.toThrow();
  });
});
