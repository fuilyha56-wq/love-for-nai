import { beforeEach, describe, expect, it, vi } from "vitest";

describe("registration verification rate limiting", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true }, { status: 200 })),
    );
  });

  it("limits repeated verification messages to one email", async () => {
    const { PUT } = await import("@/app/api/auth/register/route");
    const request = () =>
      new Request("http://localhost/api/auth/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@example.com" }),
      });

    expect((await PUT(request())).status).toBe(200);
    expect((await PUT(request())).status).toBe(200);
    expect((await PUT(request())).status).toBe(200);
    const blocked = await PUT(request());

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
