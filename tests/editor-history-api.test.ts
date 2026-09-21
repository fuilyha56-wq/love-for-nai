import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sessionState = vi.hoisted(() => ({
  value: null as null | { userId: number; username: string; displayName: string },
}));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => sessionState.value),
}));

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
