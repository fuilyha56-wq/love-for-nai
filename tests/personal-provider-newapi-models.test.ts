import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/newapi", () => ({
  resolvedNewApiBaseUrl: async () => "https://newapi.example.com",
  userHeaders: () => ({ Authorization: "Bearer session-token" }),
}));

const { loadNewApiModels, userCanGenerateWithNewApiModel } = await import("@/lib/provider/newapi-models");
afterEach(() => vi.unstubAllGlobals());

describe("NewAPI 图片模型发现", () => {
  it("结合登录账号模型与 Draw 分组识别自定义图片模型，并排除聊天模型", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/user/models"))
        return Response.json({ success: true, data: ["nai-v5-full", "nai-chat", "artist-model", "gpt-4o"] });
      if (url.endsWith("/api/pricing"))
        return Response.json({ data: [{ model_name: "artist-model", enable_groups: ["Draw"] }] });
      throw new Error(`unexpected ${url}`);
    }));
    const session = { userId: 1 } as Parameters<typeof loadNewApiModels>[0];
    const models = await loadNewApiModels(session);
    expect(models).toContainEqual({ id: "artist-model", kind: "图像模型" });
    expect(models).toContainEqual({ id: "nai-v5-full", kind: "图像模型" });
    expect(models).toContainEqual({ id: "nai-chat", kind: "助手模型" });
    expect(models).toContainEqual({ id: "gpt-4o", kind: "助手模型" });
    expect(await userCanGenerateWithNewApiModel(session, "artist-model")).toBe(true);
    expect(await userCanGenerateWithNewApiModel(session, "gpt-4o")).toBe(false);
  });
});
