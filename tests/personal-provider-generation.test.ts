import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addProvider, getProvider, setNovelaiKey } from "@/lib/provider/store";
import type { LfnSession } from "@/lib/session";
import sharp from "sharp";

const calls = vi.hoisted(() => ({ providerFetch: vi.fn(), novelaiGenerate: vi.fn(), saveHistory: vi.fn() }));
vi.mock("@/lib/provider/http", () => ({ safeProviderFetch: calls.providerFetch }));
vi.mock("@/lib/provider/novelai", async (importOriginal) => ({ ...(await importOriginal<object>()), generateNovelaiImage: calls.novelaiGenerate }));
vi.mock("@/lib/history", () => ({ saveHistory: calls.saveHistory }));

const { handlePersonalProviderGeneration } = await import("@/lib/provider/generate");
let directory: string;
const oldDataDir = process.env.LFN_DATA_DIR;
const oldSecret = process.env.LFN_PROVIDER_ENCRYPTION_KEY;
const session = { userId: 72001, username: "test", displayName: "test", upstreamCookie: "", expiresAt: Date.now() + 60_000 } as LfnSession;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lfn-provider-generate-"));
  process.env.LFN_DATA_DIR = directory;
  process.env.LFN_PROVIDER_ENCRYPTION_KEY = "test-provider-key-longer-than-thirty-two-bytes";
  calls.saveHistory.mockResolvedValue([{ id: "history-1" }]);
});

afterAll(async () => {
  if (oldDataDir === undefined) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = oldDataDir;
  if (oldSecret === undefined) delete process.env.LFN_PROVIDER_ENCRYPTION_KEY;
  else process.env.LFN_PROVIDER_ENCRYPTION_KEY = oldSecret;
  await rm(directory, { recursive: true, force: true });
});

describe("个人密钥生成路由", () => {
  it("只向所属提供商发送白名单模型，正常返回图片与历史", async () => {
    const provider = await addProvider(session.userId, { name: "Own", baseUrl: "https://api.example.com", apiKey: "secret", models: ["flux-dev"] });
    calls.providerFetch.mockResolvedValue(Response.json({ data: [{ b64_json: "aGVsbG8=" }] }));
    const request = new Request("http://localhost/api/images/operate", { method: "POST" });
    const response = await handlePersonalProviderGeneration(request, session, { model: "flux-dev", operation: "generate", prompt: "cat", width: 1024, height: 1024, n: 1 }, provider.id);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.images).toEqual(["data:image/png;base64,aGVsbG8="]);
    expect(result.paymentSource).toBe("personal-key");
    expect(result.historyIds).toEqual(["history-1"]);
    expect(calls.providerFetch).toHaveBeenCalledWith("https://api.example.com", "/v1/images/generations", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      body: JSON.stringify({ model: "flux-dev", prompt: "cat", n: 1, size: "1024x1024", response_format: "b64_json" }),
    }));
    const denied = await handlePersonalProviderGeneration(request, session, { model: "chat-only", operation: "generate", width: 1024, height: 1024 }, provider.id);
    expect(denied.status).toBe(400);
    const foreign = await handlePersonalProviderGeneration(request, { ...session, userId: 72002 }, { model: "flux-dev", operation: "generate", width: 1024, height: 1024 }, provider.id);
    expect(foreign.status).toBe(404);
    expect(calls.providerFetch.mock.calls.filter(([, endpoint]) => endpoint === "/v1/images/generations")).toHaveLength(1);
  });

  it("自动发现的模型保存后，后续生成不再依赖模型列表接口", async () => {
    const provider = await addProvider(session.userId, { name: "Discovered", baseUrl: "https://api.example.com", apiKey: "secret", models: [] });
    calls.providerFetch.mockReset();
    calls.providerFetch.mockImplementation(async (_baseUrl: string, endpoint: string) => {
      if (endpoint === "/v1/models") return Response.json({ data: [{ id: "flux-discovered", type: "image" }] });
      return Response.json({ data: [{ b64_json: "aGVsbG8=" }] });
    });
    const request = new Request("http://localhost/api/images/operate", { method: "POST" });
    const body = { model: "flux-discovered", operation: "generate", prompt: "cat", width: 1024, height: 1024, n: 1 };
    expect((await handlePersonalProviderGeneration(request, session, body, provider.id)).status).toBe(200);
    expect((await getProvider(session.userId, provider.id))?.discoveredModels).toEqual(["flux-discovered"]);
    calls.providerFetch.mockImplementation(async (_baseUrl: string, endpoint: string) => {
      if (endpoint === "/v1/models") throw new Error("model list unavailable");
      return Response.json({ data: [{ b64_json: "aGVsbG8=" }] });
    });
    expect((await handlePersonalProviderGeneration(request, session, body, provider.id)).status).toBe(200);
    expect(calls.providerFetch.mock.calls.filter(([, endpoint]) => endpoint === "/v1/models")).toHaveLength(1);
  });

  it("NovelAI Key 走官方原生请求体", async () => {
    await setNovelaiKey(session.userId, "pst-test");
    calls.novelaiGenerate.mockResolvedValue(["data:image/png;base64,aGVsbG8="]);
    const request = new Request("http://localhost/api/images/operate", { method: "POST" });
    const response = await handlePersonalProviderGeneration(request, session, { model: "nai-v5-full", operation: "generate", prompt: "cat", width: 1024, height: 1024, steps: 28 }, "novelai");
    expect(response.status).toBe(200);
    expect(calls.novelaiGenerate).toHaveBeenCalledWith("pst-test", expect.objectContaining({ model: "nai-diffusion-5-full", input: "cat", action: "generate" }));
  });
  it("个人GPT编辑来源使用配置的协议和密钥，记录原生输出尺寸", async () => {
    const provider = await addProvider(session.userId, { name: "Own GPT", baseUrl: "https://api.example.com", apiKey: "gpt-key", models: ["gpt-image-1.5"], protocol: "openai-images" });
    const image = `data:image/png;base64,${(await sharp({ create: { width: 64, height: 64, channels: 4, background: "red" } }).png().toBuffer()).toString("base64")}`;
    calls.providerFetch.mockReset();
    calls.providerFetch.mockResolvedValue(Response.json({ data: [{ b64_json: image.split(",")[1] }] }));
    const response = await handlePersonalProviderGeneration(new Request("http://localhost/api/images/operate"), session, { model: "gpt-image-1.5", operation: "img2img", prompt: "Make it blue", width: 832, height: 1216, image }, provider.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ paymentSource: "personal-key", width: 64, height: 64 });
    expect(calls.providerFetch).toHaveBeenCalledWith(provider.baseUrl, "/v1/images/edits", expect.objectContaining({ headers: { Authorization: "Bearer gpt-key" }, body: expect.any(FormData) }));
  });
  it("个人Google自动来源使用Gemini原生协议，不发送其他来源的Bearer密钥", async () => {
    const provider = await addProvider(session.userId, { name: "Own Google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "google-key", models: ["gemini-2.5-flash-image"], protocol: "auto" });
    calls.providerFetch.mockReset();
    calls.providerFetch.mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
    const response = await handlePersonalProviderGeneration(new Request("http://localhost/api/images/operate"), session, { model: "gemini-2.5-flash-image", operation: "generate", prompt: "A red cat", width: 1024, height: 1024 }, provider.id);
    expect(response.status).toBe(200);
    expect(calls.providerFetch).toHaveBeenCalledWith(provider.baseUrl, "/v1beta/models/gemini-2.5-flash-image:generateContent", expect.objectContaining({ headers: { "x-goog-api-key": "google-key", "Content-Type": "application/json" } }));
  });
});
