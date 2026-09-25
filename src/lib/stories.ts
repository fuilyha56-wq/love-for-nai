import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const STORY_MODELS = ["sol", "luna"] as const;
export type StoryModel = string;

export type StoryBranch = {
  id: string;
  parentId: string | null;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type Story = {
  id: string;
  title: string;
  model: StoryModel;
  genre: string;
  synopsis: string;
  lorebook: string;
  specializedPrompt: boolean;
  activeBranchId: string;
  branches: StoryBranch[];
  createdAt: string;
  updatedAt: string;
};

export type StoryPatch = Partial<
  Pick<Story, "title" | "model" | "genre" | "synopsis" | "lorebook" | "specializedPrompt">
> & {
  activeBranchId?: string;
  branch?: { id: string; name?: string; content?: string };
};

const MAX_STORIES = 100;
const MAX_BRANCHES = 80;
const MAX_CONTENT_LENGTH = 2_000_000;

const root = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "stories",
  );
const userPath = (userId: number) => path.join(root(), `${userId}.json`);

let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isStoryModel(value: unknown): value is StoryModel {
  return typeof value === "string" && value.length <= 180 &&
    (STORY_MODELS.includes(value as (typeof STORY_MODELS)[number]) ||
      /^(newapi|custom):[a-zA-Z0-9_.:/-]{1,150}$/.test(value));
}

function normalizeBranch(value: unknown): StoryBranch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 100);
  if (!id) return null;
  const now = new Date(0).toISOString();
  return {
    id,
    parentId: typeof record.parentId === "string" ? cleanText(record.parentId, 100) : null,
    name: cleanText(record.name, 80) || "分支",
    content: typeof record.content === "string"
      ? record.content.slice(0, MAX_CONTENT_LENGTH)
      : "",
    createdAt: cleanText(record.createdAt, 40) || now,
    updatedAt: cleanText(record.updatedAt, 40) || now,
  };
}

function normalizeStory(value: unknown): Story | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 100);
  if (!id) return null;
  const branches = Array.isArray(record.branches)
    ? record.branches.map(normalizeBranch).filter((branch): branch is StoryBranch => Boolean(branch))
    : [];
  if (!branches.length) return null;
  const activeBranchId = branches.some((branch) => branch.id === record.activeBranchId)
    ? String(record.activeBranchId)
    : branches[0].id;
  const now = new Date(0).toISOString();
  return {
    id,
    title: cleanText(record.title, 120) || "未命名故事",
    model: isStoryModel(record.model) ? record.model : "sol",
    genre: cleanText(record.genre, 80),
    synopsis: cleanText(record.synopsis, 4_000),
    lorebook: cleanText(record.lorebook, 20_000),
    specializedPrompt: record.specializedPrompt !== false,
    activeBranchId,
    branches: branches.slice(0, MAX_BRANCHES),
    createdAt: cleanText(record.createdAt, 40) || now,
    updatedAt: cleanText(record.updatedAt, 40) || now,
  };
}

async function readStoriesFile(userId: number): Promise<Story[]> {
  try {
    const parsed = JSON.parse(await readFile(userPath(userId), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeStory)
      .filter((story): story is Story => Boolean(story))
      .slice(0, MAX_STORIES);
  } catch {
    return [];
  }
}

async function writeStoriesFile(userId: number, stories: Story[]): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = userPath(userId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(stories), "utf8");
  await rename(temporary, target);
}

export async function listStories(userId: number): Promise<Story[]> {
  return readStoriesFile(userId);
}

export async function findStory(userId: number, storyId: string): Promise<Story | null> {
  return (await readStoriesFile(userId)).find((story) => story.id === storyId) ?? null;
}

export async function createStory(
  userId: number,
  input: Partial<Pick<Story, "title" | "model" | "genre" | "synopsis" | "lorebook" | "specializedPrompt">> = {},
): Promise<Story> {
  return withLock(async () => {
    const stories = await readStoriesFile(userId);
    if (stories.length >= MAX_STORIES) throw new Error(`每位用户最多保存 ${MAX_STORIES} 篇故事`);
    const now = new Date().toISOString();
    const branchId = randomUUID();
    const story: Story = {
      id: randomUUID(),
      title: cleanText(input.title, 120) || "未命名故事",
      model: isStoryModel(input.model) ? input.model : "sol",
      genre: cleanText(input.genre, 80),
      synopsis: cleanText(input.synopsis, 4_000),
      lorebook: cleanText(input.lorebook, 20_000),
      specializedPrompt: input.specializedPrompt !== false,
      activeBranchId: branchId,
      branches: [{
        id: branchId,
        parentId: null,
        name: "主线",
        content: "",
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    };
    stories.unshift(story);
    await writeStoriesFile(userId, stories);
    return story;
  });
}

export async function updateStory(
  userId: number,
  storyId: string,
  patch: StoryPatch,
): Promise<Story> {
  return withLock(async () => {
    const stories = await readStoriesFile(userId);
    const index = stories.findIndex((story) => story.id === storyId);
    if (index < 0) throw new Error("故事不存在");
    const current = stories[index];
    const now = new Date().toISOString();
    const next: Story = { ...current, branches: current.branches.map((branch) => ({ ...branch })) };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 120) || "未命名故事";
    if (patch.model !== undefined) {
      if (!isStoryModel(patch.model)) throw new Error("模型标识无效");
      next.model = patch.model;
    }
    if (patch.genre !== undefined) next.genre = cleanText(patch.genre, 80);
    if (patch.synopsis !== undefined) next.synopsis = cleanText(patch.synopsis, 4_000);
    if (patch.lorebook !== undefined) next.lorebook = cleanText(patch.lorebook, 20_000);
    if (patch.specializedPrompt !== undefined) next.specializedPrompt = patch.specializedPrompt === true;
    if (patch.activeBranchId !== undefined) {
      if (!next.branches.some((branch) => branch.id === patch.activeBranchId)) throw new Error("目标分支不存在");
      next.activeBranchId = patch.activeBranchId;
    }
    if (patch.branch) {
      const branch = next.branches.find((item) => item.id === patch.branch?.id);
      if (!branch) throw new Error("目标分支不存在");
      if (patch.branch.name !== undefined) branch.name = cleanText(patch.branch.name, 80) || "分支";
      if (patch.branch.content !== undefined) branch.content = patch.branch.content.slice(0, MAX_CONTENT_LENGTH);
      branch.updatedAt = now;
    }
    next.updatedAt = now;
    stories[index] = next;
    await writeStoriesFile(userId, stories);
    return next;
  });
}

export async function createStoryBranch(
  userId: number,
  storyId: string,
  sourceBranchId: string,
  name?: string,
): Promise<Story> {
  return withLock(async () => {
    const stories = await readStoriesFile(userId);
    const index = stories.findIndex((story) => story.id === storyId);
    if (index < 0) throw new Error("故事不存在");
    const current = stories[index];
    if (current.branches.length >= MAX_BRANCHES) throw new Error(`每篇故事最多创建 ${MAX_BRANCHES} 个分支`);
    const source = current.branches.find((branch) => branch.id === sourceBranchId);
    if (!source) throw new Error("源分支不存在");
    const now = new Date().toISOString();
    const branch: StoryBranch = {
      id: randomUUID(),
      parentId: source.id,
      name: cleanText(name, 80) || `分支 ${current.branches.length}`,
      content: source.content,
      createdAt: now,
      updatedAt: now,
    };
    const next = {
      ...current,
      activeBranchId: branch.id,
      branches: [...current.branches, branch],
      updatedAt: now,
    };
    stories[index] = next;
    await writeStoriesFile(userId, stories);
    return next;
  });
}

export async function deleteStory(userId: number, storyId: string): Promise<boolean> {
  return withLock(async () => {
    const stories = await readStoriesFile(userId);
    const next = stories.filter((story) => story.id !== storyId);
    if (next.length === stories.length) return false;
    await writeStoriesFile(userId, next);
    return true;
  });
}