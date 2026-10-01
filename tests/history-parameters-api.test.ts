import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sessionState = vi.hoisted(() => ({ value: null as null | { userId: number; username: string; displayName: string } }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => sessionState.value) }));

import { saveHistory } from "@/lib/history";
import { GET } from "@/app/api/history/[id]/route";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "lfn-history-parameters-"));
  process.env.LFN_DATA_DIR = dataDirectory;
  sessionState.value = { userId: 41, username: "history-owner", displayName: "Owner" };
});

afterEach(async () => {
  sessionState.value = null;
  delete process.env.LFN_DATA_DIR;
  const resolved = path.resolve(dataDirectory);
  if (!resolved.startsWith(path.join(path.resolve(os.tmpdir()), "lfn-history-parameters-"))) throw new Error("Unexpected test history directory");
  await rm(resolved, { recursive: true, force: true });
});

function get(id: string) {
  return GET(new Request(`http://localhost/api/history/${id}`), { params: Promise.resolve({ id }) });
}

describe("按用户归属读取历史生成参数", () => {
  it("返回自己的提示词、图像模型及来源选项，不暴露其他存储内容", async () => {
    const parameters = {
      operation: "editor-composite", model: "gemini-3-pro-image-preview", prompt: 'Extend the scene, preserve the sign "LFN".\nUse warm light.', negative_prompt: "Avoid cropped faces.",
      width: 1024, height: 1024, steps: 28, scale: 5, n: 1, sampler: "k_euler_ancestral", seed: 42,
      providerId: "personal-provider", imageProtocol: "gemini", quality: "high", imageSize: "4K", background: "transparent",
    };
    const [item] = await saveHistory(41, { ...parameters, apiKey: "test-secret", authorization: "test-header", imagePath: "internal.png", customObject: { password: "secret" }, references: [{ image }], mask: image }, [image], { internal: true });
    const response = await get(item.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ parameters });
  });

  it("未登录时拒绝读取已存在的记录", async () => {
    const [item] = await saveHistory(41, { operation: "generate", prompt: "private" }, [image], null);
    sessionState.value = null;
    const response = await get(item.id);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).not.toHaveProperty("parameters");
  });

  it("另一用户与不存在的 ID 都返回相同 404，不泄漏拥有者记录", async () => {
    const [item] = await saveHistory(41, { operation: "generate", prompt: "private" }, [image], null);
    sessionState.value = { userId: 42, username: "other-user", displayName: "Other" };
    const foreign = await get(item.id);
    const missing = await get("not-found");
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("保留旧 NAI 预设信息，忽略非法数值及模型来源选项", async () => {
    const [item] = await saveHistory(41, { operation: "generate", model: "nai-v5-full", qualityToggle: false, ucPreset: 3, width: "invalid", providerId: "bad/provider", imageProtocol: "unknown", imageSize: "8K", scale: Number.NaN }, [image], null);
    const response = await get(item.id);
    expect(await response.json()).toEqual({ parameters: { operation: "generate", model: "nai-v5-full", qualityToggle: false, ucPreset: 3 } });
  });
});
