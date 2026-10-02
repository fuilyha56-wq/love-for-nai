import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomProvider } from "@/lib/provider/store";
const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/provider/http", () => ({ safeProviderFetch: network.fetch }));
const { discoverProviderModels } = await import("@/lib/provider/models");
const provider = { id: "id", name: "test", baseUrl: "https://api.example.com", apiKey: "private-key", models: [], createdAt: "now" } as CustomProvider;
beforeEach(() => network.fetch.mockReset());

describe("图像来源协议模型发现", () => {
  it("Google原生使用models名称，识别Gemini图像且不误收普通LLM和Imagen predict", async () => {
    network.fetch.mockResolvedValue(Response.json({ models: [{ name: "models/gemini-3-pro-image-preview" }, { name: "models/gemini-3.1-flash-image" }, { name: "models/nano-banana-pro" }, { name: "models/gemini-3-pro" }, { name: "models/imagen-4.0-generate-001" }] }));
    const models = await discoverProviderModels({ ...provider, baseUrl: "https://generativelanguage.googleapis.com" });
    expect(models).toEqual(["gemini-3-pro-image-preview", "gemini-3.1-flash-image", "nano-banana-pro"]);
    expect(network.fetch).toHaveBeenCalledWith("https://generativelanguage.googleapis.com", "/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": "private-key" } });
  });
  it("兼容端点识别GPT/Nano Banana/元数据别名，手动指定协议不会漏发Authorization", async () => {
    network.fetch.mockResolvedValue(Response.json({ data: [{ id: "chatgpt-image-latest" }, { id: "nano-banana-pro" }, { id: "gemini-2.5-flash-image" }, { id: "gpt-4o" }, { id: "my-draw", capabilities: ["image"] }] }));
    expect(await discoverProviderModels({ ...provider, protocol: "openai-images" })).toEqual(["chatgpt-image-latest", "gemini-2.5-flash-image", "my-draw", "nano-banana-pro"]);
    expect(network.fetch).toHaveBeenCalledWith(provider.baseUrl, "/v1/models", { headers: { Authorization: "Bearer private-key" } });
  });
});
