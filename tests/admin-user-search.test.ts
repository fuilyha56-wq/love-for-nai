import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  baseUrl: vi.fn(),
  userHeaders: vi.fn(),
  affStatus: vi.fn(),
  authProvider: vi.fn(),
  quotaPerUnit: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.gate }));
vi.mock("@/lib/newapi", () => ({
  resolvedNewApiBaseUrl: mocks.baseUrl,
  userHeaders: mocks.userHeaders,
}));
vi.mock("@/lib/aff", () => ({
  affStatus: mocks.affStatus,
  adjustAff: vi.fn(),
}));
vi.mock("@/lib/local-users", () => ({
  createLocalUser: vi.fn(),
  listLocalUsers: vi.fn(),
  publicLocalUser: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({ resolvedAuthProviderId: mocks.authProvider }));
vi.mock("@/lib/runtime-config", () => ({ runtimeQuotaPerUnit: mocks.quotaPerUnit }));

import { GET } from "@/app/api/admin/users/route";

const session = {
  userId: 1,
  username: "admin",
  systemToken: "system-token",
  accessToken: "",
  upstreamCookie: "",
  expiresAt: Date.now() + 60_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({ session });
  mocks.baseUrl.mockResolvedValue("https://newapi.test");
  mocks.userHeaders.mockReturnValue({ Authorization: "Bearer test" });
  mocks.affStatus.mockResolvedValue({ balance: 0 });
  mocks.authProvider.mockResolvedValue("newapi");
  mocks.quotaPerUnit.mockResolvedValue(500_000);
});

describe("admin user list search", () => {
  it("uses NewAPI's dedicated keyword search endpoint and documented pagination parameters", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return Response.json({
          success: true,
          data: {
            items: [{ id: 352, username: "caicai", email: "test@example.com" }],
            total: 1,
          },
        });
      }),
    );

    const response = await GET(
      new Request("https://lfn.test/api/admin/users?p=1&size=20&keyword=caicai"),
    );
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "https://newapi.test/api/user/search?p=1&page_size=20&keyword=caicai",
    ]);
    expect(result).toMatchObject({ total: 1, items: [{ id: 352, username: "caicai" }] });
  });

  it("keeps unfiltered pagination on the NewAPI user-list endpoint", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return Response.json({ success: true, data: { items: [], total: 0 } });
      }),
    );

    const response = await GET(
      new Request("https://lfn.test/api/admin/users?p=2&size=20"),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual(["https://newapi.test/api/user/?p=2&page_size=20"]);
  });
});
