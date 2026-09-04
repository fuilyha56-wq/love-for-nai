import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentStep } from "@/lib/tag-agent";

// 助手对话标签的展示信息（与 Danbooru 校验结果一致）。
export type ConversationTag = {
  name: string;
  displayName: string;
  categoryName: string;
  postCount: number;
};

export type ConversationTurn = {
  id: string;
  request: string;
  // agent 最终输出的 JSON 字符串，下次对话原样回填给模型延续上下文。
  answer: string;
  createdAt: string;
  // 助手本轮对用户说的话（final.message），可选。
  message?: string;
  prompt: string;
  negativePrompt: string;
  parameters: Record<string, unknown>;
  tags: ConversationTag[];
  rejectedTags: string[];
  unverifiedTags: string[];
  steps: AgentStep[];
};

export type AssistantConversation = {
  turns: ConversationTurn[];
  // 跨轮次累积的已校验标签池，按 name 去重，刷新/换设备不丢。
  tagPool: ConversationTag[];
};

// 轮次上限：防止单用户文件无限增长。标签池不做限制——
// 模型能从对话历史里掌握已有标签数量，无需人为截断。
const MAX_TURNS = 40;
// 发给模型的历史轮次上限：控制 token 预算。
export const MODEL_HISTORY_TURNS = 8;

const root = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "assistant",
    "conversations",
  );
const conversationPath = (userId: number) =>
  path.join(root(), `${userId}.json`);

let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

function isTag(value: unknown): value is ConversationTag {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.displayName === "string" &&
    typeof record.categoryName === "string" &&
    typeof record.postCount === "number"
  );
}

function normalize(value: unknown): AssistantConversation {
  if (!value || typeof value !== "object") return { turns: [], tagPool: [] };
  const record = value as Record<string, unknown>;
  const turns = Array.isArray(record.turns)
    ? record.turns.filter(
        (turn): turn is ConversationTurn =>
          !!turn && typeof turn === "object" &&
          typeof (turn as ConversationTurn).request === "string" &&
          typeof (turn as ConversationTurn).answer === "string",
      )
    : [];
  const tagPool = Array.isArray(record.tagPool)
    ? record.tagPool.filter(isTag)
    : [];
  return { turns, tagPool };
}

async function readConversationFile(
  userId: number,
): Promise<AssistantConversation> {
  try {
    return normalize(
      JSON.parse(await readFile(conversationPath(userId), "utf8")),
    );
  } catch {
    return { turns: [], tagPool: [] };
  }
}

async function writeConversationFile(
  userId: number,
  conversation: AssistantConversation,
): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = conversationPath(userId);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(conversation), "utf8");
  await rename(temp, target);
}

export async function readConversation(
  userId: number,
): Promise<AssistantConversation> {
  return readConversationFile(userId);
}

// 追加一轮对话，并把本轮校验过的标签并入累积标签池。
export async function appendConversationTurn(
  userId: number,
  turn: ConversationTurn,
): Promise<AssistantConversation> {
  return withLock(async () => {
    const conversation = await readConversationFile(userId);
    conversation.turns.push(turn);
    if (conversation.turns.length > MAX_TURNS)
      conversation.turns = conversation.turns.slice(-MAX_TURNS);
    const byName = new Map(
      conversation.tagPool.map((tag) => [tag.name, tag]),
    );
    for (const tag of turn.tags) byName.set(tag.name, tag);
    conversation.tagPool = [...byName.values()];
    await writeConversationFile(userId, conversation);
    return conversation;
  });
}

export async function clearConversation(userId: number): Promise<void> {
  return withLock(async () => {
    await writeConversationFile(userId, { turns: [], tagPool: [] });
  });
}
