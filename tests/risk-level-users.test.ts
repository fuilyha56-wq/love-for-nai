import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  cases: vi.fn(),
  usage: vi.fn(),
  names: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.gate }));
vi.mock("@/lib/risk-control", () => ({ listRiskCases: mocks.cases }));
vi.mock("@/lib/request-audit", () => ({ requestUsageByUser: mocks.usage }));
vi.mock("@/lib/user-display", () => ({ userDisplayNames: mocks.names }));
vi.mock("@/lib/risk-settings", () => ({
  getRiskSettings: async () => ({
    version: "fixture",
    levels: [
      { id: "normal", minimum: 0 },
      { id: "critical", minimum: 90 },
    ],
  }),
}));
import { GET } from "@/app/api/admin/risk/level-users/route";
beforeEach(() => {
  mocks.gate.mockResolvedValue({ session: { userId: 1 } });
  mocks.cases.mockResolvedValue([
    { userId: 2, username: "high", status: "open", score: 100 },
    {
      userId: 3,
      username: "banned",
      status: "confirmed",
      score: 100,
      enforcement: { blocked: true },
    },
  ]);
  mocks.usage.mockResolvedValue(
    new Map(Array.from({ length: 13 }, (_, i) => [i + 1, {}])),
  );
  mocks.names.mockResolvedValue(new Map([[1, { name: "Alice" }]]));
});
describe("risk level users", () => {
  it("lists observed normal users without inventing old marks and paginates before return", async () => {
    const first = await (
      await GET(new Request("https://lfn.test?level=normal"))
    ).json();
    expect(first.total).toBe(11);
    expect(first.items).toHaveLength(10);
    expect(first.items[0]).toMatchObject({
      userId: 1,
      username: "Alice",
      score: 0,
    });
    const second = await (
      await GET(new Request("https://lfn.test?level=normal&page=2"))
    ).json();
    expect(second.items).toHaveLength(1);
    const high = await (
      await GET(new Request("https://lfn.test?level=critical"))
    ).json();
    expect(high.items).toEqual([{ userId: 2, username: "high", score: 100 }]);
  });
  it("filters by username and denies non-admin requests", async () => {
    const filtered = await (
      await GET(new Request("https://lfn.test?level=normal&keyword=alice"))
    ).json();
    expect(filtered.total).toBe(1);
    mocks.gate.mockResolvedValue({ error: "仅管理员可用" });
    expect(
      (await GET(new Request("https://lfn.test?level=normal"))).status,
    ).toBe(403);
  });
});
