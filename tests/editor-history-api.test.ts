import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sessionState = vi.hoisted(() => ({
  value: null as null | { userId: number; username: string; displayName: string },
}));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => sessionState.value),
}));

import { imageHistoryReuseHref, parseImageHistoryMetadata, saveEditorComposite } from "@/lib/editor-composite-history";
import { findHistory, historyImagePath } from "@/lib/history";

import { POST } from "@/app/api/history/editor/route";

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lfn-editor-history-"));
  process.env.LFN_DATA_DIR = dataDir;
  sessionState.value = { userId: 17, username: "editor", displayName: "Editor" };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  sessionState.value = null;
  delete process.env.LFN_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/history/editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("编辑器完整合成图历史接口", () => {
  it("client saves the composite bytes and returns its own persisted history id", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/history/editor");
      return POST(new Request(`http://localhost${url}`, init));
    }));
    const id = await saveEditorComposite({
      image: onePixelPng, model: "nai-v4.5-inpaint", prompt: "composite",
      negative_prompt: "", width: 1, height: 1, steps: 28, scale: 5,
      sampler: "k_euler_ancestral", strength: 0.7,
    });
    const saved = await findHistory(17, id);
    expect(saved?.parameters).toMatchObject({ operation: "editor-composite", model: "nai-v4.5-inpaint", width: 1, height: 1 });
    const bytes = await readFile(historyImagePath(17, saved!.imagePath));
    expect(bytes).toEqual(Buffer.from(onePixelPng.split(",")[1], "base64"));
  });

  it("client surfaces history failures instead of attaching a patch id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "保存失败" }, { status: 500 })));
    await expect(saveEditorComposite({
      image: onePixelPng, model: "nai-v4.5-inpaint", prompt: "",
      negative_prompt: "", width: 1, height: 1, steps: 28, scale: 5,
      sampler: "k_euler_ancestral", strength: 0.7,
    })).rejects.toThrow("保存失败");
  });

  it("编辑器模型来源和输出选项经客户端、接口和历史存储完整保留", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => POST(new Request(`http://localhost${url}`, init))));
    const metadata = { providerId: "personal-image-provider", imageProtocol: "gemini" as const, quality: "high", imageSize: "4K", background: "transparent" };
    const id = await saveEditorComposite({
      image: onePixelPng, model: "gemini-3-pro-image-preview", prompt: "extend the scene",
      negative_prompt: "", width: 1, height: 1, steps: 28, scale: 5,
      sampler: "k_euler_ancestral", strength: 0.7, ...metadata,
    });
    const saved = await findHistory(17, id);
    expect(saved?.parameters).toMatchObject({ operation: "editor-composite", model: "gemini-3-pro-image-preview", ...metadata });
    const url = new URL(imageHistoryReuseHref(id, saved!.parameters), "http://localhost");
    expect(url.searchParams.get("historyId")).toBe(id);
    for (const [key, value] of Object.entries(metadata)) expect(url.searchParams.get(key)).toBe(value);
    expect(url.searchParams.has("prompt")).toBe(false);
  });

  it("旧历史保持 historyId 链接，非法选项和 API 密钥不进入复用 URL", () => {
    expect(imageHistoryReuseHref("history-old", {})).toBe("/image?historyId=history-old");
    const invalid = { providerId: "bad\nprovider", imageProtocol: "unknown", quality: "invalid", imageSize: "8K", background: "invalid", apiKey: "secret", prompt: "private scene" };
    expect(parseImageHistoryMetadata(invalid)).toEqual({});
    expect(imageHistoryReuseHref("id&background=opaque", invalid)).toBe("/image?historyId=id%26background%3Dopaque");
  });

  it("接口保存结果时只保留合法元数据", async () => {
    const response = await POST(request({ image: onePixelPng, providerId: "newapi", imageProtocol: "auto", quality: "invalid", imageSize: "8K", background: { value: "transparent" }, apiKey: "secret" }));
    expect(response.status).toBe(200);
    const result = await response.json() as { id: string };
    const saved = await findHistory(17, result.id);
    expect(saved?.parameters).toMatchObject({ providerId: "newapi", imageProtocol: "auto" });
    expect(saved?.parameters).not.toHaveProperty("quality");
    expect(saved?.parameters).not.toHaveProperty("imageSize");
    expect(saved?.parameters).not.toHaveProperty("background");
    expect(saved?.parameters).not.toHaveProperty("apiKey");
  });

  it("未登录时拒绝保存", async () => {
    sessionState.value = null;
    const response = await POST(request({ image: onePixelPng }));
    expect(response.status).toBe(401);
  });

  it("拒绝非 PNG data URL", async () => {
    const response = await POST(request({ image: "data:image/jpeg;base64,AAAA" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ message: "编辑结果必须是 PNG 图片" });
  });

  it("保存完整合成图并返回受保护历史地址", async () => {
    const response = await POST(request({
      image: onePixelPng,
      model: "nai-v5-inpaint",
      prompt: "extend scene",
      negative_prompt: "lowres",
      width: 1,
      height: 1,
      steps: 28,
      scale: 5,
      sampler: "k_euler_ancestral",
      strength: 0.7,
    }));
    expect(response.status).toBe(200);
    const result = await response.json() as { id: string; imageUrl: string };
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.imageUrl).toBe(`/api/history/${result.id}/image`);
  });
});
