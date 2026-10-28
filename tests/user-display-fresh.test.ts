import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/newapi-db", () => ({
  newApiDbPool: () => ({ query: mocks.query }),
}));
vi.mock("@/lib/platform", () => ({
  resolvedAuthProviderId: async () => "newapi",
}));
vi.mock("@/lib/local-users", () => ({ findLocalUsersByIds: vi.fn() }));
import { userDisplayNames } from "@/lib/user-display";
beforeEach(() => {
  mocks.query.mockReset();
});
it("bypasses a cached normal account when an admin refreshes ban status, batching requested IDs", async () => {
  mocks.query.mockResolvedValue({
    rows: [{ id: "910001", username: "test", status: 1 }],
  });
  expect((await userDisplayNames([910001])).get(910001)?.status).toBe(1);
  mocks.query.mockResolvedValue({
    rows: [
      { id: "910001", username: "test", status: 2 },
      { id: 910002, username: "other", status: 1 },
    ],
  });
  expect((await userDisplayNames([910001])).get(910001)?.status).toBe(1);
  const fresh = await userDisplayNames([910001, 910002, 910001], {
    fresh: true,
  });
  expect(fresh.get(910001)?.status).toBe(2);
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.query.mock.lastCall?.[1]).toEqual([[910001, 910002]]);
  expect((await userDisplayNames([910001])).get(910001)?.status).toBe(2);
});
