import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), local: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/newapi", () => ({
  newApiBaseUrl: () => "https://usage.invalid",
  userHeaders: () => ({}),
  isUpstreamAuthError: (message: string) => message.includes("expired"),
}));
vi.mock("@/lib/history", () => ({ listHistory: async () => [] }));
vi.mock("@/lib/request-audit", () => ({ listUserImageUsage: mocks.local }));
import { GET } from "@/app/api/usage/route";
import { paymentMatches, usageCost } from "@/lib/usage-billing";
const now = Math.floor(Date.now() / 1000);
const row = (index: number, payment = "personal") => ({
  request_id: `owned-${index}`,
  model_name: "nai-v5-full",
  created_at: now - index,
  payment_source: payment,
  charged_aff: 4,
  provider_id: "lfn",
  status: "success",
});
const query = (value = "") =>
  new NextRequest(
    `https://lfn.test/api/usage?start=${now - 10000}&end=${now}&${value}`,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: 71 });
  mocks.local.mockResolvedValue([row(1)]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/api/user/models")
        ? Response.json({ data: ["nai-v5-full"] })
        : Response.json({
            success: true,
            data: {
              total: 1,
              items: [
                {
                  request_id: "remote-one",
                  model_name: "nai-v5-full",
                  created_at: now,
                  quota: 4000000,
                  type: 2,
                },
              ],
            },
          }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("usage payment filtering", () => {
  it("filters local wallets before pagination without a NewAPI request", async () => {
    mocks.local.mockResolvedValue([
      ...Array.from({ length: 25 }, (_, i) => row(i)),
      row(30, "mixed"),
      row(31, "package"),
    ]);
    const first = await (await GET(query("payment=aff"))).json();
    expect(first).toMatchObject({ total: 26, hasMore: true, page: 1 });
    expect(first.items).toHaveLength(20);
    const second = await (await GET(query("payment=aff&page=2"))).json();
    expect(second.items).toHaveLength(6);
    expect(second.hasMore).toBe(false);
    expect(mocks.local).toHaveBeenCalledWith(71);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("merges independently billed NewAPI logs with local credits and keeps payment units", async () => {
    const result = await (await GET(query())).json();
    expect(result.total).toBe(2);
    expect(
      result.items.map((item: Record<string, unknown>) => item.payment_source),
    ).toEqual(["newapi", "personal"]);
    expect(usageCost(result.items[0])).toBe("$8.00");
    expect(usageCost(result.items[1])).toBe("4 AFF");
    const remote = await (
      await GET(query("payment=newapi&status=success"))
    ).json();
    expect(remote.total).toBe(1);
    expect(remote.items[0].request_id).toBe("remote-one");
  });
  it("matches mixed payments in both relevant filters and treats zero as a real zero", () => {
    const mixed = row(1, "mixed");
    expect(paymentMatches(mixed, "aff")).toBe(true);
    expect(paymentMatches(mixed, "package")).toBe(true);
    expect(paymentMatches(mixed, "newapi")).toBe(false);
    expect(usageCost({ ...mixed, charged_aff: 0 })).toBe("0 AFF");
    expect(usageCost({ payment_source: "newapi", quota: 0 })).toBe("$0.00");
    expect(usageCost({ payment_source: "newapi" })).toBe("—");
  });
  it("returns visible bounded-result coverage instead of a false total", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes("/api/user/models")
        ? Response.json({ data: ["nai-v5-full"] })
        : Response.json({ success: true, data: { total: 5000, items: [] } }),
    );
    const body = await (await GET(query())).json();
    expect(body.total).toBe(1);
    expect(body.notice).toContain("上限");
  });
  it("can show local rows during an upstream outage without fabricating NewAPI rows", async () => {
    vi.mocked(fetch).mockRejectedValue(Error("upstream offline"));
    const local = await (await GET(query())).json();
    expect(local.items).toHaveLength(1);
    expect(local.notice).toContain("暂时不可用");
    expect((await GET(query("payment=newapi"))).status).toBe(502);
  });
  it("rejects invalid filters and unauthenticated reads before loading account data", async () => {
    expect((await GET(query("payment=bogus"))).status).toBe(400);
    mocks.session.mockResolvedValue(null);
    expect((await GET(query())).status).toBe(401);
    expect(mocks.local).not.toHaveBeenCalled();
  });
});
