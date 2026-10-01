import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), close: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
  Agent: class { close = network.close; },
  fetch: network.fetch,
}));

const { safeProviderFetch, downloadProviderImage } = await import("@/lib/provider/http");

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
  it("新编辑/聊天/原生 Gemini 路径仍受相同公网验证，multipart 保留自动 boundary", async () => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    network.fetch.mockImplementation(async () => Response.json({ data: [] }));
    const form = new FormData();
    form.set("model", "gpt-image-1.5");
    await safeProviderFetch("https://api.example.com/v1", "/v1/images/edits", { method: "POST", headers: { Authorization: "Bearer secret" }, body: form });
    expect(network.fetch).toHaveBeenCalledWith(new URL("https://api.example.com/v1/images/edits"), expect.objectContaining({ body: form, headers: { Authorization: "Bearer secret" }, redirect: "manual" }));
    await safeProviderFetch("https://api.example.com", "/v1/chat/completions");
    await safeProviderFetch("https://generativelanguage.googleapis.com/v1beta", "/v1beta/models/gemini-3-pro-image-preview:generateContent");
    await expect(safeProviderFetch("https://api.example.com", "/v1beta/models/../../internal:generateContent")).rejects.toThrow("不支持");
  });
  it("下载上游URL图片不携带模型Key，保留CDN签名查询且拒绝内网和重定向", async () => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    network.fetch.mockImplementation(async () => new Response(Buffer.from([137,80,78,71,13,10,26,10]), { headers: { "Content-Type": "image/png" } }));
    const result = await downloadProviderImage("https://cdn.example.com/result.png?signature=abc");
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(network.fetch).toHaveBeenCalledWith(new URL("https://cdn.example.com/result.png?signature=abc"), expect.objectContaining({ headers: { Accept: "image/png,image/jpeg,image/webp" }, redirect: "manual" }));
    network.fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }));
    await expect(downloadProviderImage("https://cdn.example.com/result.png")).rejects.toThrow("302");
    network.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(downloadProviderImage("https://cdn.example.com/result.png")).rejects.toThrow("非公网");
  });
  it("Google 的原生和 OpenAI 兼容地址复用配置时不会重复版本前缀", async () => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    network.fetch.mockImplementation(async () => Response.json({ data: [] }));
    await safeProviderFetch("https://generativelanguage.googleapis.com/v1beta/openai/", "/v1beta/models/gemini-2.5-flash-image:generateContent");
    expect(network.fetch).toHaveBeenLastCalledWith(new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent"), expect.anything());
    await safeProviderFetch("https://generativelanguage.googleapis.com/v1beta/openai/", "/v1/images/generations");
    expect(network.fetch).toHaveBeenLastCalledWith(new URL("https://generativelanguage.googleapis.com/v1beta/openai/images/generations"), expect.anything());
    await safeProviderFetch("https://generativelanguage.googleapis.com", "/v1/models");
    expect(network.fetch).toHaveBeenLastCalledWith(new URL("https://generativelanguage.googleapis.com/v1beta/openai/models"), expect.anything());
  });
});
