import { describe, expect, it } from "vitest";
import { mergeStudioHistory, studioHistoryKey } from "@/lib/studio-history";

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
});
