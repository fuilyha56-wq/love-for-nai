import { describe, expect, it } from "vitest";
import { localStudioHistory, remoteStudioHistory, mergeStudioHistory, studioHistoryKey } from "@/lib/studio-history";

describe("手机工作台历史合并", () => {
  it("先显示新结果，并通过账号记录 ID 去重不同图片 URL", () => {
    const session = { image: "data:image/png;base64,new", historyId: "same", createdAt: 30 };
    const remote = { image: "/api/history/same/image", historyId: "same", createdAt: 20 };
    const older = { image: "/api/history/older/image", historyId: "older", createdAt: 10 };
    expect(mergeStudioHistory([session], [older, remote])).toEqual([session, older]);
  });

  it("保留本机图片，按时间排序且不改写输入数组", () => {
    const older = { image: "blob:old", createdAt: 1 };
    const newer = { image: "blob:new", createdAt: 2 };
    const session = [older];
    expect(mergeStudioHistory(session, [newer, older])).toEqual([newer, older]);
    expect(session).toEqual([older]);
    expect(studioHistoryKey(older)).toBe("blob:old");
  });

  it("重新读取本机 blob 时按记录 ID 去重，并恢复真实参数与零 CFG", () => {
    const saved = { id: "local-one", image: new Blob(), prompt: "blue sky", negative: "text", createdAt: 10,
      parameters: { width: 640, height: 800, steps: 17, scale: 0, sampler: "k_euler" } };
    const first = localStudioHistory(saved, "blob:first");
    const restored = localStudioHistory(saved, "blob:second");
    expect(mergeStudioHistory([first], [restored])).toEqual([first]);
    expect(restored).toMatchObject({ prompt: "blue sky", negative: "text", width: 640, height: 800, steps: 17, scale: 0, sampler: "k_euler" });
  });

  it("账号历史重新进入后恢复图片、参数及账号 ID", () => {
    const result = remoteStudioHistory({ id: "remote", imageUrl: "/api/history/remote/image", createdAt: "2026-10-25T00:00:00Z",
      parameters: { operation: "img2img", prompt: "cloud", negative_prompt: "text", strength: .4, model: "nai-v5-full", seed: 123 } });
    expect(result).toMatchObject({ id: "remote", historyId: "remote", prompt: "cloud", negative: "text", operation: "img2img", strength: .4, seed: 123 });
    expect(studioHistoryKey(result)).toBe("account:remote");
  });
});
