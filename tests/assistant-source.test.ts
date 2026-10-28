import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), refresh: vi.fn(), models: vi.fn(), providers: vi.fn(), resolve: vi.fn(), groups: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/newapi", () => ({ getChatToken: mocks.token, refreshChatToken: mocks.refresh, readUsableGroups: mocks.groups, resolvedNewApiBaseUrl: async () => "https://newapi.test", userHeaders: () => ({}) }));
vi.mock("@/lib/provider/newapi-models", () => ({ loadNewApiModels: mocks.models }));
vi.mock("@/lib/provider/store", () => ({ listRegistryEntries: mocks.providers, resolveTextProviderModel: mocks.resolve }));
vi.mock("@/lib/provider/http", () => ({ safeProviderFetch: mocks.fetch }));
vi.mock("@/lib/shared-user-self", () => ({ fetchNewApiSelf: async () => Response.json({ success: true, data: { group: "vip" } }) }));
import { loadAssistantCatalog } from "@/lib/assistant-catalog";
import { resolveAssistantSource } from "@/lib/assistant-source";
import { fetchAssistantModel } from "@/lib/assistant-model-request";
const session = { userId: 123 } as Parameters<typeof resolveAssistantSource>[0];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockResolvedValue("newapi-fixture-key");
  mocks.groups.mockResolvedValue(["vip", "gemini"]);
  mocks.models.mockResolvedValue([{ id: "text-chat", kind: "助手模型", groups: ["vip", "private"] }, { id: "gpt-image-1", kind: "图像模型", groups: ["vip"] }]);
  mocks.providers.mockResolvedValue([{ id: "own-provider", kind: "openai", name: "我的模型源", baseUrl: "https://private-config.test", secret: "custom-fixture-key", modelEntries: [{ id: "vision-chat", capabilities: "text" }, { id: "gpt-image-1", capabilities: "image" }] }]);
  mocks.resolve.mockResolvedValue({ model: "vision-chat", provider: { apiKey: "custom-fixture-key", baseUrl: "https://custom.test" } });
  mocks.fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "hello" } }] }));
});
describe("assistant source and group routing", () => {
  it("publishes owned text models and accessible groups without endpoints or secrets, creating no keys", async () => {
    const catalog = await loadAssistantCatalog(session);
    expect(catalog.sources).toEqual([
      { id: "newapi", name: "NewAPI", models: [{ id: "text-chat", groups: ["vip"] }] },
      { id: "own-provider", name: "我的模型源", models: [{ id: "vision-chat", groups: [] }] },
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/private-config|fixture-key/);
    expect(mocks.providers).toHaveBeenCalledWith(123, "text");
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it("keeps custom sources usable during a NewAPI outage", async () => {
    mocks.models.mockRejectedValue(new Error("upstream unavailable"));
    const catalog = await loadAssistantCatalog(session);
    expect(catalog.sources[1].models[0].id).toBe("vision-chat");
    expect(catalog.message).toBe("upstream unavailable");
  });
  it("uses the selected group for initial credentials and bounded refresh", async () => {
    const source = await resolveAssistantSource(session, "text-chat", "newapi", "vip");
    expect(mocks.token).toHaveBeenCalledWith(session, "text-chat", "vip");
    await source.refreshKey!("rejected-fixture");
    expect(mocks.refresh).toHaveBeenCalledWith(session, "text-chat", "rejected-fixture", "vip");
  });
  it("routes a custom model through the protected transport, with reasoning and no NewAPI credentials", async () => {
    const source = await resolveAssistantSource(session, "vision-chat", "own-provider");
    await fetchAssistantModel(`${source.baseUrl}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "hello" }] }) }, { ...source, reasoningEffort: "high" });
    expect(mocks.resolve).toHaveBeenCalledWith(123, "own-provider", "vision-chat");
    expect(mocks.fetch).toHaveBeenCalledWith("https://custom.test", "/v1/chat/completions", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer custom-fixture-key" }) }));
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body).reasoning_effort).toBe("high");
    expect(source.refreshKey).toBeUndefined();
    expect(mocks.token).not.toHaveBeenCalled(); expect(mocks.models).not.toHaveBeenCalled();
  });
  it("rejects another user's, removed or image-only sources instead of falling back to NewAPI", async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(resolveAssistantSource(session, "vision-chat", "other-provider")).rejects.toThrow("不可访问");
    expect(mocks.token).not.toHaveBeenCalled();
    await expect(resolveAssistantSource(session, "text-chat", { baseUrl: "http://localhost" })).rejects.toThrow("来源无效");
    await expect(resolveAssistantSource(session, "text-chat", "newapi", ["vip"])).rejects.toThrow("分组无效");
  });
});
