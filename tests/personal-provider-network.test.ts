import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), close: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
  Agent: class { close = network.close; },
  fetch: network.fetch,
}));

const { safeProviderFetch } = await import("@/lib/provider/http");

beforeEach(() => { network.lookup.mockReset(); network.fetch.mockReset(); network.close.mockReset(); });

describe("第三方 API 出站网络校验", () => {
  it("DNS 解析含有内网地址时，在发送 Key 前拒绝连接", async () => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(safeProviderFetch("https://api.example.com", "/v1/models", { headers: { Authorization: "Bearer secret" } })).rejects.toThrow("非公网");
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("只允许固定 API 路径，且不跟随重定向", async () => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    await expect(safeProviderFetch("https://api.example.com", "/internal", {})).rejects.toThrow("不支持的第三方 API 路径");
    network.fetch.mockResolvedValue(Response.json({ data: [] }));
    const response = await safeProviderFetch("https://api.example.com", "/v1/models", { headers: { Authorization: "Bearer secret" } });
    expect(response.ok).toBe(true);
    expect(network.fetch).toHaveBeenCalledWith(new URL("https://api.example.com/v1/models"), expect.objectContaining({ redirect: "manual" }));
    expect(network.close).toHaveBeenCalledOnce();
  });
});
