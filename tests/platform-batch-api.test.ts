import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  updateRuntimeSettings: vi.fn(),
  upsertRuntimeEndpoint: vi.fn(),
  deleteRuntimeEndpoint: vi.fn(),
  updateModelBilling: vi.fn(),
  publicSettings: vi.fn((value) => value),
  publicEndpoint: vi.fn((value) => value),
  reload: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: mocks.requireAdminRequest,
}));
vi.mock("@/lib/adapters/registry", () => ({
  registry: { reload: mocks.reload },
}));
vi.mock("@/lib/runtime-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/runtime-config")>();
  return {
    ...original,
    updateRuntimeSettings: mocks.updateRuntimeSettings,
    upsertRuntimeEndpoint: mocks.upsertRuntimeEndpoint,
    deleteRuntimeEndpoint: mocks.deleteRuntimeEndpoint,
    updateModelBilling: mocks.updateModelBilling,
    publicSettings: mocks.publicSettings,
    publicEndpoint: mocks.publicEndpoint,
  };
});

function request(operations: unknown[], token = "admin-token") {
  return new Request("http://localhost/api/admin/platform/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operations }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminRequest.mockResolvedValue({ source: "token" });
  mocks.updateRuntimeSettings.mockResolvedValue({ registerGroup: "ikun", publicUrl: "https://lfn.test" });
  mocks.upsertRuntimeEndpoint.mockResolvedValue({ id: "image-main", name: "Gateway" });
  mocks.deleteRuntimeEndpoint.mockResolvedValue(true);
  mocks.updateModelBilling.mockResolvedValue({ "nai-v5-full": { mode: "fixed", fixedCost: 2 } });
  mocks.reload.mockResolvedValue(undefined);
});

describe("平台批量配置 API", () => {
  it("严格按顺序执行并在首个错误后停止", async () => {
    mocks.upsertRuntimeEndpoint.mockRejectedValue(new Error("端点令牌无效：gateway denied"));
    const { POST } = await import("@/app/api/admin/platform/batch/route");
    const response = await POST(request([
      { id: "settings", action: "settings.update", params: { publicUrl: "https://lfn.test" } },
      { id: "gateway", action: "endpoint.upsert", params: { type: "image", adapterType: "gateway", name: "Gateway" } },
      { id: "billing", action: "billing.replace", params: { modelBilling: {} } },
    ]));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body).toMatchObject({ success: false, stoppedOnError: true, committed: 1, total: 3 });
    expect(body.results).toEqual([
      expect.objectContaining({ index: 0, id: "settings", status: "committed" }),
      expect.objectContaining({
        index: 1,
        id: "gateway",
        status: "failed",
        error: { name: "Error", message: "端点令牌无效：gateway denied" },
      }),
      { index: 2, id: "billing", action: "billing.replace", status: "not_executed" },
    ]);
    expect(mocks.updateRuntimeSettings).toHaveBeenCalledTimes(1);
    expect(mocks.upsertRuntimeEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.updateModelBilling).not.toHaveBeenCalled();
  });

  it("全成功时按输入顺序提交所有操作", async () => {
    const { POST } = await import("@/app/api/admin/platform/batch/route");
    const response = await POST(request([
      { action: "endpoint.delete", params: { id: "old" } },
      { action: "billing.replace", params: { modelBilling: { "nai-v5-full": { mode: "fixed", fixedCost: 2 } } } },
    ]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results.map((item: { status: string }) => item.status)).toEqual(["committed", "committed"]);
    expect(mocks.deleteRuntimeEndpoint).toHaveBeenCalledWith("old");
    expect(mocks.updateModelBilling).toHaveBeenCalledTimes(1);
  });

  it("管理认证失败时不执行任何操作", async () => {
    mocks.requireAdminRequest.mockResolvedValue({ error: "管理令牌无效" });
    const { POST } = await import("@/app/api/admin/platform/batch/route");
    const response = await POST(request([
      { action: "settings.update", params: { publicUrl: "https://lfn.test" } },
    ], "bad-token"));

    expect(response.status).toBe(403);
    expect(mocks.updateRuntimeSettings).not.toHaveBeenCalled();
  });
});