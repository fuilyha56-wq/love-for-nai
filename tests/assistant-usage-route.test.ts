import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), refresh: vi.fn(), image: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/assistant-jobs", () => ({ findAssistantJob: mocks.find }));
vi.mock("@/lib/assistant-usage-billing", () => ({ refreshAssistantJobUsage: mocks.refresh, assistantImageReceipt: mocks.image }));
import { POST } from "@/app/api/assistant/usage/route";
const request = (body: unknown) => new Request("http://localhost/api/assistant/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ userId: 77 }); });
describe("private assistant receipts", () => {
  it("requires authentication and bounds IDs before any lookup", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(request({}))).status).toBe(401);
    for (const body of [null, { jobs: ["unsafe/id"] }, { images: Array(102).fill("id") }]) expect((await POST(request(body))).status).toBe(400);
    expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it("only returns allowlisted receipt fields for records owned by the signed-in user", async () => {
    mocks.find.mockImplementation((user, id) => user === 77 && id === "own" ? { status: "done", usage: [], key: "never-return-key", message: "never-return-message" } : null);
    mocks.image.mockImplementation(async (user, id) => user === 77 && id === "own-image" ? { id, aff: 5.75, balanceCost: null, billing: "settled" } : null);
    const response = await POST(request({ jobs: ["own", "foreign", "own"], images: ["own-image", "foreign-image"] }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ jobs: { own: { status: "done", usage: [] } }, images: [{ id: "own-image", aff: 5.75, balanceCost: null, billing: "settled" }] });
    expect(mocks.find.mock.calls).toEqual([[77, "own"], [77, "foreign"]]);
  });
});
