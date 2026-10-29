import { isAssistantConversationId, MAX_ASSISTANT_CONVERSATIONS, type AssistantConversationSession } from "@/lib/assistant-conversation-types";
export { isAssistantConversationId, MAX_ASSISTANT_CONVERSATIONS } from "@/lib/assistant-conversation-types";
export type { AssistantConversationSession } from "@/lib/assistant-conversation-types";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentStep } from "@/lib/tag-agent";
import type { AssistantCallUsage } from "./assistant-usage";
import { isImageProviderProtocol, type ImageProviderProtocol } from "@/lib/image-model-capabilities";

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
  imageModel?: string;
  modelProtocol?: ImageProviderProtocol;
  goalRunId?: string;
  goalMode?: boolean;
  // 助手本轮对用户说的话（final.message），可选。
  message?: string;
  // 兼容旧记录：旧会话可能没有该字段。
  englishDescription?: string;
  prompt: string;
  negativePrompt: string;
  parameters: Record<string, unknown>;
  tags: ConversationTag[];
  rejectedTags: string[];
  unverifiedTags: string[];
  steps: AgentStep[];
  usage?: AssistantCallUsage[];
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
const conversationPath = (userId: number, conversationId = "default") => {
  if (!isAssistantConversationId(conversationId)) throw new Error("会话 ID 无效");
  return conversationId === "default" ? path.join(root(), `${userId}.json`) : path.join(root(), String(userId), `${conversationId}.json`);
};

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
        (turn): turn is ConversationTurn => {
          if (!turn || typeof turn !== "object") return false;
          const candidate = turn as Partial<ConversationTurn>;
          return typeof candidate.request === "string" && typeof candidate.answer === "string";
        },
      ).map((turn) => ({
        ...turn,
        id: typeof turn.id === "string" ? turn.id : randomUUID(),
        createdAt: typeof turn.createdAt === "string" ? turn.createdAt : new Date(0).toISOString(),
        imageModel: typeof turn.imageModel === "string" ? turn.imageModel : undefined,
        modelProtocol: isImageProviderProtocol(turn.modelProtocol) ? turn.modelProtocol : undefined,
        goalRunId: typeof turn.goalRunId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(turn.goalRunId) ? turn.goalRunId : undefined,
        goalMode: turn.goalMode === true,
        message: typeof turn.message === "string" ? turn.message : undefined,
        englishDescription: typeof turn.englishDescription === "string" ? turn.englishDescription : undefined,
        prompt: typeof turn.prompt === "string" ? turn.prompt : "",
        negativePrompt: typeof turn.negativePrompt === "string" ? turn.negativePrompt : "",
        parameters: turn.parameters && typeof turn.parameters === "object" ? turn.parameters : {},
        tags: Array.isArray(turn.tags) ? turn.tags.filter(isTag) : [],
        rejectedTags: Array.isArray(turn.rejectedTags) ? turn.rejectedTags.filter((tag): tag is string => typeof tag === "string") : [],
        unverifiedTags: Array.isArray(turn.unverifiedTags) ? turn.unverifiedTags.filter((tag): tag is string => typeof tag === "string") : [],
        steps: Array.isArray(turn.steps) ? turn.steps : [],
      }))
    : [];
  const tagPool = Array.isArray(record.tagPool)
    ? record.tagPool.filter(isTag)
    : [];
  return { turns, tagPool };
}

async function readConversationFile(
  userId: number, conversationId = "default",
): Promise<AssistantConversation> {
  try {
    return normalize(
      JSON.parse(await readFile(conversationPath(userId, conversationId), "utf8")),
    );
  } catch {
    return { turns: [], tagPool: [] };
  }
}

async function writeConversationFile(
  userId: number,
  conversation: AssistantConversation,
  conversationId = "default",
): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = conversationPath(userId, conversationId);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(conversation), "utf8");
  await rename(temp, target);
}

export async function readConversation(
  userId: number, conversationId = "default",
): Promise<AssistantConversation> {
  await requireConversationSession(userId, conversationId);
  return readConversationFile(userId, conversationId);
}

// 追加一轮对话，并把本轮校验过的标签并入累积标签池。
export async function appendConversationTurn(
  userId: number,
  turn: ConversationTurn,
  conversationId = "default", signal?: AbortSignal,
): Promise<AssistantConversation> {
  return withLock(async () => {
    signal?.throwIfAborted();
    await requireConversationSession(userId, conversationId);
    const conversation = await readConversationFile(userId, conversationId);
    signal?.throwIfAborted();
    conversation.turns.push(turn);
    if (conversation.turns.length > MAX_TURNS)
      conversation.turns = conversation.turns.slice(-MAX_TURNS);
    const byName = new Map(
      conversation.tagPool.map((tag) => [tag.name, tag]),
    );
    for (const tag of turn.tags) byName.set(tag.name, tag);
    conversation.tagPool = [...byName.values()];
    await writeConversationFile(userId, conversation, conversationId);
    if (conversationId !== "default") await touchConversationSession(userId, conversationId);
    return conversation;
  });
}

export async function clearConversation(userId: number, conversationId = "default"): Promise<void> {
  return withLock(async () => {
    await requireConversationSession(userId, conversationId);
    await writeConversationFile(userId, { turns: [], tagPool: [] }, conversationId);
  });
}

/** Update a delayed bill without recreating a conversation the user has cleared. */
export async function updateConversationUsage(userId: number, id: string, usage: AssistantCallUsage[], conversationId = "default"): Promise<void> {
  return withLock(async () => {
    try { await requireConversationSession(userId, conversationId); } catch { return; }
    const conversation = await readConversationFile(userId, conversationId);
    const turn = conversation.turns.find(turn => turn.id === id);
    if (!turn) return;
    turn.usage = usage;
    await writeConversationFile(userId, conversation, conversationId);
  });
}

const sessionIndexPath = (userId: number) => path.join(root(), String(userId) + ".sessions.json");
function defaultConversationSession(): AssistantConversationSession {
  const timestamp = new Date().toISOString();
  return { id: "default", title: "默认会话", createdAt: timestamp, updatedAt: timestamp };
}
async function readSessionIndex(userId: number): Promise<AssistantConversationSession[]> {
  let text: string;
  try { text = await readFile(sessionIndexPath(userId), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return [defaultConversationSession()]; throw error; }
  const saved: unknown = JSON.parse(text);
  if (!Array.isArray(saved) || saved.length > MAX_ASSISTANT_CONVERSATIONS) throw new Error("会话目录格式无效");
  const ids = new Set<string>();
  const sessions = saved.map((entry): AssistantConversationSession => {
    if (!entry || typeof entry !== "object") throw new Error("会话目录格式无效");
    const item = entry as Partial<AssistantConversationSession>;
    if (!isAssistantConversationId(item.id) || ids.has(item.id) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 80 || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") throw new Error("会话目录格式无效");
    ids.add(item.id);
    return { id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
  if (!ids.has("default")) {
    if (sessions.length >= MAX_ASSISTANT_CONVERSATIONS) throw new Error("会话目录缺少默认会话且已达到上限");
    sessions.unshift(defaultConversationSession());
  }
  return sessions;
}
async function writeSessionIndex(userId: number, sessions: AssistantConversationSession[]) {
  await mkdir(root(), { recursive: true });
  const target = sessionIndexPath(userId), temporary = target + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(sessions), "utf8");
  await rename(temporary, target);
}
async function requireConversationSession(userId: number, id: string) {
  if (!isAssistantConversationId(id)) throw new Error("会话 ID 无效");
  if (id !== "default" && !(await readSessionIndex(userId)).some((entry) => entry.id === id)) throw new Error("会话不存在或已删除");
}
async function touchConversationSession(userId: number, id: string) {
  const sessions = await readSessionIndex(userId);
  const session = sessions.find((entry) => entry.id === id);
  if (session) { session.updatedAt = new Date().toISOString(); await writeSessionIndex(userId, sessions); }
}
export async function listConversationSessions(userId: number) {
  const sessions = await readSessionIndex(userId);
  return sessions.sort((a, b) => a.id === "default" ? -1 : b.id === "default" ? 1 : b.updatedAt.localeCompare(a.updatedAt));
}
export async function createConversationSession(userId: number, title = "新会话") {
  const name = title.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error("会话名称需要 1–80 字");
  return withLock(async () => {
    const sessions = await readSessionIndex(userId);
    if (sessions.length >= MAX_ASSISTANT_CONVERSATIONS) throw new Error("最多保留 20 个会话，请先删除不需要的会话");
    const now = new Date().toISOString();
    const session = { id: randomUUID(), title: name, createdAt: now, updatedAt: now };
    await writeConversationFile(userId, { turns: [], tagPool: [] }, session.id);
    await writeSessionIndex(userId, [...sessions, session]);
    return session;
  });
}
export async function renameConversationSession(userId: number, id: string, title: string) {
  const name = title.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error("会话名称需要 1–80 字");
  return withLock(async () => {
    await requireConversationSession(userId, id);
    const sessions = await readSessionIndex(userId);
    const session = sessions.find((entry) => entry.id === id)!;
    session.title = name; session.updatedAt = new Date().toISOString();
    await writeSessionIndex(userId, sessions);
    return session;
  });
}
export async function deleteConversationSession(userId: number, id: string) {
  return withLock(async () => {
    await requireConversationSession(userId, id);
    if (id === "default") { await writeConversationFile(userId, { turns: [], tagPool: [] }); return; }
    const sessions = await readSessionIndex(userId);
    await writeSessionIndex(userId, sessions.filter((entry) => entry.id !== id));
    try { await unlink(conversationPath(userId, id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  });
}
