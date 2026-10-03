import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const dbNoneMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: { none: dbNoneMock } }));

const { createNewApiAuthAdapter } = await import("@/lib/adapters/auth/newapi");
const { createLocalAuthAdapter } = await import("@/lib/adapters/auth/local");

const config = {
  id: "test-auth",
  type: "auth" as const,
  adapterType: "newapi",
  name: "Test auth",
  enabled: true,
  config: { baseUrl: "http://newapi.test" },
  priority: 1,
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  dbNoneMock.mockReset();
  dbNoneMock.mockResolvedValue(undefined);
});

describe("auth adapter logout semantics", () => {
  it("normalizes Bearer tokens and uses the auth logout endpoint", async () => {
    const adapter = createNewApiAuthAdapter(config);
    await adapter.logout?.("  Bearer upstream-token  ");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://newapi.test/api/user/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer upstream-token" },
      }),
    );
  });

  it("swallows upstream logout failures as best-effort", async () => {
    fetchMock.mockRejectedValue(new Error("upstream down"));
    const adapter = createNewApiAuthAdapter(config);
    await expect(adapter.logout?.("token")).resolves.toBeUndefined();
  });

  it("uses the same normalized token for local logout", async () => {
    const adapter = createLocalAuthAdapter({ ...config, adapterType: "local" });
    await adapter.logout?.("Bearer local-token");
    expect(dbNoneMock).toHaveBeenCalledWith(
      "DELETE FROM lfn_sessions WHERE token = $1",
      ["local-token"],
    );
  });

  it("keeps local logout best-effort when the database is unavailable", async () => {
    dbNoneMock.mockRejectedValue(new Error("database down"));
    const adapter = createLocalAuthAdapter({ ...config, adapterType: "local" });
    await expect(adapter.logout?.("local-token")).resolves.toBeUndefined();
  });
});
