import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  names: vi.fn(),
  cases: vi.fn(),
  provider: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.gate }));
vi.mock("@/lib/user-display", () => ({ userDisplayNames: mocks.names }));
vi.mock("@/lib/platform", () => ({ resolvedAuthProviderId: mocks.provider }));
vi.mock("@/lib/risk-control", () => ({
  getRiskPolicy: async () => ({ referralMaxDepth: 10 }),
  riskCasesForUsers: mocks.cases,
}));
vi.mock("@/lib/referral", () => ({
  referralRiskComponent: async () => ({
    rootUserId: 10,
    userIds: [10, 11, 12, 13],
    contextUserIds: [9, 10, 11, 12, 13],
    ancestors: [],
    descendants: [11, 12, 13],
    edges: [],
  }),
}));
import { POST } from "@/app/api/admin/risk/chain-preview/route";
import { referralAccountStatusText } from "@/lib/referral-account-status";
const request = () =>
  new Request("https://lfn.test/api/admin/risk/chain-preview", {
    method: "POST",
    body: JSON.stringify({ userId: 10 }),
  });
beforeEach(() => {
  mocks.gate.mockResolvedValue({ session: { userId: 1 } });
  mocks.provider.mockResolvedValue("newapi");
  mocks.names.mockResolvedValue(
    new Map([
      [9, { username: "ancestor", status: "2" }],
      [10, { username: "normal", status: "1" }],
      [11, { username: "disabled", status: "2" }],
      [12, { username: "local-ban", status: 1 }],
    ]),
  );
  mocks.cases.mockResolvedValue(
    new Map([
      [12, { score: 90, level: "critical", enforcement: { blocked: true } }],
    ]),
  );
});
describe("referral account status", () => {
  it("reads fresh upstream statuses for the entire tree separately from local enforcement", async () => {
    const response = await POST(request());
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(mocks.names).toHaveBeenCalledWith([9, 10, 11, 12, 13], {
      fresh: true,
    });
    expect(body.accountProvider).toBe("NewAPI");
    expect(body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 9,
          accountStatus: "disabled",
          blocked: false,
        }),
        expect.objectContaining({
          userId: 10,
          accountStatus: "active",
          blocked: false,
        }),
        expect.objectContaining({
          userId: 11,
          accountStatus: "disabled",
          blocked: false,
        }),
        expect.objectContaining({
          userId: 12,
          accountStatus: "active",
          blocked: true,
        }),
        expect.objectContaining({
          userId: 13,
          accountStatus: "unknown",
          blocked: false,
        }),
      ]),
    );
    expect(
      referralAccountStatusText(
        body.users.find((u: { userId: number }) => u.userId === 13)
          .accountStatus,
      ),
    ).toBe("状态未知");
  });
  it("updates bans and unbans on the next preview and labels local authentication correctly", async () => {
    await POST(request());
    mocks.names.mockResolvedValue(
      new Map([
        [10, { username: "normal", status: 0 }],
        [11, { username: "disabled", status: 1 }],
      ]),
    );
    mocks.provider.mockResolvedValue("local");
    const body = await (await POST(request())).json();
    expect(body.accountProvider).toBe("LFN");
    expect(
      body.users.find((u: { userId: number }) => u.userId === 10).accountStatus,
    ).toBe("disabled");
    expect(
      body.users.find((u: { userId: number }) => u.userId === 11).accountStatus,
    ).toBe("active");
  });
  it("rejects non-admin reads before accessing account information", async () => {
    mocks.names.mockClear();
    mocks.gate.mockResolvedValue({ error: "仅管理员可用" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.names).not.toHaveBeenCalled();
  });
});
