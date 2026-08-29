import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 会话存取走 LFN_DATA_DIR，测试用临时目录隔离。
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "lfn-conv-"));
  process.env.LFN_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.LFN_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

function turn(overrides: Partial<Parameters<typeof import("@/lib/assistant-conversations").appendConversationTurn>[1]> = {}) {
  return {
    id: crypto.randomUUID(),
    request: "需求",
    answer: '{"tags":["white_hair"]}',
    createdAt: new Date().toISOString(),
    prompt: "white_hair",
    negativePrompt: "",
    parameters: {},
    tags: [
      {
        name: "white_hair",
        displayName: "white hair",
        categoryName: "通用",
        postCount: 100,
      },
    ],
    rejectedTags: [],
    unverifiedTags: [],
    steps: [],
    ...overrides,
  };
}

describe("助手对话存储", () => {
  it("空会话读取返回空结构", async () => {
    const { readConversation } = await import("@/lib/assistant-conversations");
    expect(await readConversation(1)).toEqual({ turns: [], tagPool: [] });
  });

  it("追加轮次并把标签并入去重的标签池", async () => {
    const { appendConversationTurn, readConversation } = await import(
      "@/lib/assistant-conversations"
    );
    await appendConversationTurn(1, turn());
    await appendConversationTurn(
      1,
      turn({
        request: "补充蓝色裙子",
        tags: [
          {
            name: "blue_dress",
            displayName: "blue dress",
            categoryName: "通用",
            postCount: 50,
          },
          // 与第一轮重名：标签池按 name 去重。
          {
            name: "white_hair",
            displayName: "white hair",
            categoryName: "通用",
            postCount: 100,
          },
        ],
      }),
    );
    const conversation = await readConversation(1);
    expect(conversation.turns).toHaveLength(2);
    expect(conversation.tagPool.map((tag) => tag.name)).toEqual([
      "white_hair",
      "blue_dress",
    ]);
    // 用户隔离：其他用户读到空会话。
    expect(await readConversation(2)).toEqual({ turns: [], tagPool: [] });
  });

  it("轮次与标签池有上限，超出后保留最新的", async () => {
    const { appendConversationTurn, readConversation } = await import(
      "@/lib/assistant-conversations"
    );
    for (let index = 0; index < 45; index += 1) {
      await appendConversationTurn(
        1,
        turn({
          request: `需求 ${index}`,
          tags: [
            {
              name: `tag_${index}`,
              displayName: `tag ${index}`,
              categoryName: "通用",
              postCount: index,
            },
          ],
        }),
      );
    }
    const conversation = await readConversation(1);
    expect(conversation.turns).toHaveLength(40);
    expect(conversation.turns[0].request).toBe("需求 5");
    expect(conversation.tagPool).toHaveLength(45);
    expect(conversation.tagPool.at(-1)?.name).toBe("tag_44");
  });

  it("清空删除全部轮次与标签池", async () => {
    const { appendConversationTurn, clearConversation, readConversation } =
      await import("@/lib/assistant-conversations");
    await appendConversationTurn(1, turn());
    await clearConversation(1);
    expect(await readConversation(1)).toEqual({ turns: [], tagPool: [] });
  });
});
