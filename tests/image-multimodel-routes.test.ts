import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), allowed: vi.fn(), token: vi.fn(), spend: vi.fn(), history: vi.fn(), personal: vi.fn(), suggestion: vi.fn(), chatToken: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ userId: 78501, username: "models-test" }) }));
vi.mock("@/lib/platform", () => ({ resolvedAuthProviderId: mocks.auth }));
vi.mock("@/lib/provider/newapi-models", () => ({ userCanGenerateWithNewApiModel: mocks.allowed }));
vi.mock("@/lib/newapi", () => ({ getImageToken: mocks.token, getChatToken: mocks.chatToken, resolvedNewApiBaseUrl: async () => "https://newapi.example.com", resolvedImageUpstream: async () => null, resolvedNaiImageUpstream: async () => null, imageFromResult: () => [] }));
vi.mock("@/lib/aff", () => ({ trySpendImageCredits: mocks.spend, refundImageCredits: vi.fn() }));
vi.mock("@/lib/history", () => ({ saveHistory: mocks.history }));
vi.mock("@/lib/provider/generate", () => ({ handlePersonalProviderGeneration: mocks.personal }));
vi.mock("@/lib/image-prompt-suggestion", () => ({ runImagePromptSuggestion: mocks.suggestion }));
vi.mock("@/lib/gateway-log", () => ({ gatewayLogStart: () => () => undefined }));
vi.mock("@/lib/provider/http", () => ({ downloadProviderImage: mocks.download }));

const { POST: operate } = await import("@/app/api/images/operate/route");
const { POST: generate } = await import("@/app/api/images/generate/route");
const request = (body: Record<string, unknown>) => new Request("http://localhost/api/images/operate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const base = { model: "gpt-image-1.5", prompt: "A quiet forest", width: 832, height: 1216, n: 1 };
const raster = async (color: string) => `data:image/png;base64,${(await sharp({ create: { width: 64, height: 64, channels: 4, background: color } }).png().toBuffer()).toString("base64")}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue("newapi");
  mocks.allowed.mockResolvedValue(true);
  mocks.token.mockResolvedValue("image-key");
  mocks.chatToken.mockResolvedValue("chat-key");
  mocks.history.mockResolvedValue([{ id: "history-1" }]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ b64_json: "aGVsbG8=" }] })));
});
afterEach(() => vi.unstubAllGlobals());

describe("图像模型路由和计费适配", () => {
  it("GPT 生成按模型尺寸协议请求；不使用 NAI AFF，也不发送 diffusion 扩展字段", async () => {
    const response = await operate(request({ ...base, operation: "generate", steps: 28, seed: 100, scale: 5 }));
    expect(response.status).toBe(200);
    expect((await response.json()).paymentSource).toBe("newapi");
    expect(mocks.spend).not.toHaveBeenCalled();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://newapi.example.com/v1/images/generations");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer image-key");
    const payload = JSON.parse(init?.body as string);
    expect(payload.size).toBe("1024x1536");
    expect(payload).not.toHaveProperty("response_format");
    expect(payload).not.toHaveProperty("seed");
    expect(mocks.history).toHaveBeenCalled();
    expect(mocks.history).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 1024, height: 1536 }), expect.anything(), null);
  });
  it("Gemini 多张请求逐张使用原生端点，保留已生成图片和历史", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] })).mockResolvedValueOnce(Response.json({ error: { message: "quota exceeded" } }, { status: 429 })));
    const response = await operate(request({ ...base, model: "gemini-2.5-flash-image", imageProtocol: "gemini", n: 2 }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ images: ["data:image/png;base64,aGVsbG8="], partial: true, historyIds: ["history-1"], width: 832, height: 1216 });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://newapi.example.com/v1beta/models/gemini-2.5-flash-image:generateContent");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("image-key");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });
  it("GPT 编辑使用 edits multipart，editor_composite 避免保存未合成补丁", async () => {
    const response = await operate(request({ ...base, operation: "img2img", image: await raster("red"), editor_composite: true }));
    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://newapi.example.com/v1/images/edits");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("Gemini 无原生蒙版也保持编辑区外像素", async () => {
    const source = await raster("red");
    const maskPixels = Buffer.alloc(64 * 64 * 4, 255);
    for (let i = 0; i < 32 * 64 * 4; i += 4) maskPixels[i] = maskPixels[i + 1] = maskPixels[i + 2] = 0;
    const mask = `data:image/png;base64,${(await sharp(maskPixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()).toString("base64")}`;
    const green = await raster("green");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: green.split(",")[1] } }] } }] })));
    const response = await operate(request({ ...base, model: "gemini-3-pro-image-preview", operation: "inpainting", imageProtocol: "gemini", image: source, mask }));
    expect(response.status).toBe(200);
    const result = await response.json();
    const pixels = await sharp(Buffer.from(result.image.split(",")[1], "base64")).ensureAlpha().raw().toBuffer();
    expect(Array.from(pixels.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(pixels.subarray(pixels.length - 4))).toEqual([0, 128, 0, 255]);
    expect(mocks.history).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 64, height: 64 }), expect.anything(), null);
  });
  it("返回URL时安全取回PNG供历史和继续编辑，实际返回尺寸写入历史", async () => {
    const image = await raster("green");
    mocks.download.mockResolvedValue(image);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ url: "https://cdn.example.com/generated.png?signature=secret" }] })));
    const response = await operate(request(base));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image, width: 64, height: 64 });
    expect(mocks.download).toHaveBeenCalledWith("https://cdn.example.com/generated.png?signature=secret", expect.any(AbortSignal));
    expect(mocks.history).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 64, height: 64 }), [image], null);
  });
  it("非NAI超分使用图像编辑而非NAI上游，并返回确定2x尺寸", async () => {
    const green = await raster("green");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ b64_json: green.split(",")[1] }] })));
    const response = await operate(request({ ...base, operation: "upscale", image: await raster("red") }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ width: 128, height: 128, method: "generative-edit", paymentSource: "newapi" });
    const dims = await sharp(Buffer.from(result.image.split(",")[1], "base64")).metadata();
    expect(dims.width).toBe(128);
    expect(dims.height).toBe(128);
    expect(mocks.spend).not.toHaveBeenCalled();
  });
  it("模型授权失败、未知编辑能力、错误协议不发送图像上游请求", async () => {
    mocks.allowed.mockResolvedValueOnce(false);
    expect((await operate(request(base))).status).toBe(400);
    expect((await operate(request({ ...base, model: "unknown-image", operation: "img2img", image: await raster("red") }))).status).toBe(400);
    expect((await operate(request({ ...base, imageProtocol: "arbitrary" }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("本地账号不能把未配置非NAI模型路由到平台图包", async () => {
    mocks.auth.mockResolvedValue("local");
    const response = await operate(request(base));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.spend).not.toHaveBeenCalled();
  });
  it("旧 generate 入口支持个人来源，且只允许生成操作", async () => {
    mocks.personal.mockResolvedValue(Response.json({ images: ["personal"] }));
    const response = await generate(request({ ...base, operation: "director-lineart", providerId: "personal-provider" }));
    expect(response.status).toBe(200);
    expect(mocks.personal).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ userId: 78501 }), expect.objectContaining({ operation: "generate", providerId: "personal-provider" }), "personal-provider");
  });
  it("自然语言提示词补写用助手模型密钥，不将图像模型或其密钥发送到聊天端点", async () => {
    mocks.suggestion.mockResolvedValue({ prompt: "A quiet forest at sunrise", tags: [], promptStyle: "natural" });
    const response = await operate(request({ ...base, operation: "suggest-tags", assistantModel: "gemini-3-pro" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prompt: "A quiet forest at sunrise", tags: [] });
    expect(mocks.chatToken).toHaveBeenCalledWith(expect.anything(), "gemini-3-pro");
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.suggestion).toHaveBeenCalledWith(expect.objectContaining({ key: "chat-key", chatModel: "gemini-3-pro", imageModel: "gpt-image-1.5", prompt: "A quiet forest" }));
    expect((await operate(request({ ...base, operation: "suggest-tags", assistantModel: "gpt-image-1" }))).status).toBe(400);
  });
});
