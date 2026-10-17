import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivitiesPage from "@/app/admin/activities/page";

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
beforeEach(() => vi.clearAllMocks());
describe("activity admin canonical route", () => {
  it("opens the activity tab in the shared admin shell", async () => {
    mocks.admin.mockResolvedValue({ session: { userId: 1 }, role: 100 });
    await expect(ActivitiesPage()).rejects.toThrow("REDIRECT:/admin?tab=activities");
  });
  it("returns unauthenticated users to that same tab after sign-in", async () => {
    mocks.admin.mockResolvedValue({ error: "请先登录" });
    await expect(ActivitiesPage()).rejects.toThrow("REDIRECT:/sign-in?next=%2Fadmin%3Ftab%3Dactivities");
  });
});
