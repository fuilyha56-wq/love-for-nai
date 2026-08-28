import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { findHistory, historyImagePath } from "@/lib/history";
import { grantAffOnce } from "@/lib/aff";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";

export type GalleryRating = "general" | "r13" | "r18";
export type GallerySource = "other" | "lfn" | "local";

export const ratingLabels: Record<GalleryRating, string> = {
  general: "全年龄",
  r13: "R13",
  r18: "R18",
};

// 旧数据里的 sensitive 评级等价于 R13。
function normalizeRating(value: unknown): GalleryRating {
  if (value === "r13" || value === "r18") return value;
  if (value === "sensitive") return "r13";
  return "general";
}

export function isRestrictedRating(rating: GalleryRating): boolean {
  return rating === "r18";
}
export type GalleryItem = {
  id: string;
  ownerId: number;
  ownerName: string;
  authorName: string;
  title: string;
  rating: GalleryRating;
  source: GallerySource;
  tags: string[];
  prompt: string;
  negativePrompt: string;
  parameters: Record<string, unknown>;
  imageFile: string;
  createdAt: string;
  likes: number;
  likedBy: number[];
  weeklyLikes?: Record<string, number>;
  rewardedWeek?: string;
};

type GalleryStore = { items: GalleryItem[] };
const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "gallery");
const storePath = () => path.join(root(), "index.json");
const imagePath = (file: string) => path.join(root(), path.basename(file));
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}
async function readStore(): Promise<GalleryStore> {
  try {
    const value = JSON.parse(await readFile(storePath(), "utf8")) as GalleryStore;
    return {
      items: (Array.isArray(value.items) ? value.items : []).map((item) => ({
        ...item,
        rating: normalizeRating(item.rating),
      })),
    };
  } catch { return { items: [] }; }
}
async function writeStore(store: GalleryStore): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}
function weekKey(date = new Date()): string {
  const day = new Date(date.getTime() + 8 * 3600_000);
  const monday = new Date(day);
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  return monday.toISOString().slice(0, 10);
}
function previousWeekKey(): string {
  return weekKey(new Date(Date.now() - 7 * 24 * 3600_000));
}
/**
 * 校验投稿评级是否为受支持的三级年龄评级。
 */
export function assertGalleryRating(rating: unknown): GalleryRating {
  if (rating === "general" || rating === "r13" || rating === "r18")
    return rating;
  throw new Error("内容评级不合法");
}

export function assertNaiImage(buffer: Buffer, fileName: string): { extension: string; parameters: Record<string, unknown> } {
  const extension = path.extname(fileName).toLowerCase();
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (!isPng && !isJpeg) throw new Error("只支持 PNG 或 JPEG 图片");
  const metadata = parseNaiImageMetadata(buffer);
  if (!metadata)
    throw new Error("图片中的 NAI 参数无法解析，无法导入到图库");
  if (!metadata.isNai)
    throw new Error("图片中未检测到 NovelAI 生成特征，只能上传 NAI 生成的图片");
  return { extension: isJpeg || extension === ".jpg" || extension === ".jpeg" ? "jpg" : "png", parameters: metadata.parameters };
}

export async function publishFromHistory(
  ownerId: number,
  ownerName: string,
  historyId: string,
  input: { title: string; authorName: string; rating: GalleryRating; source: GallerySource; tags: string[]; exposeParameters: boolean },
): Promise<GalleryItem> {
  return withLock(async () => {
    const history = await findHistory(ownerId, historyId);
    if (!history) throw new Error("历史图片不存在");
    const authorName = input.authorName.trim().slice(0, 80);
    if (!authorName) throw new Error("请填写作品作者或画师署名");
    const rating = assertGalleryRating(input.rating);
    if (!["other", "lfn", "local"].includes(input.source))
      throw new Error("图片来源不合法");
    const sourcePrompt = String(history.parameters.prompt || "");
    const sourceNegative = String(history.parameters.negative_prompt || "");
    const id = randomUUID();
    const file = `${id}.${path.extname(history.imagePath).replace(/^\./, "") || "png"}`;
    await mkdir(root(), { recursive: true });
    const source = await readFile(historyImagePath(ownerId, history.imagePath));
    await writeFile(imagePath(file), source);
    const item: GalleryItem = {
      id, ownerId, ownerName, authorName, title: input.title.trim().slice(0, 80) || "未命名作品",
      rating, source: input.source,
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 40),
      prompt: sourcePrompt, negativePrompt: sourceNegative,
      parameters: input.exposeParameters ? history.parameters : {}, imageFile: file,
      createdAt: new Date().toISOString(), likes: 0, likedBy: [], weeklyLikes: {},
    };
    const store = await readStore();
    store.items.unshift(item);
    await writeStore(store);
    return item;
  });
}

export async function listGallery(): Promise<GalleryItem[]> {
  return (await readStore()).items.map((item) => ({
    ...item,
    likedBy: [],
    weeklyLikes: undefined,
    ...(Object.keys(item.parameters).length
      ? {}
      : { prompt: "", negativePrompt: "" }),
  }));
}
export async function getGalleryItem(id: string): Promise<GalleryItem | null> {
  return (await readStore()).items.find((item) => item.id === id) || null;
}
export function galleryImagePath(file: string): string { return imagePath(file); }
export async function toggleGalleryLike(id: string, userId: number): Promise<{ liked: boolean; likes: number }> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);
    if (!item) throw new Error("图库作品不存在");
    const index = item.likedBy.indexOf(userId);
    const week = weekKey();
    item.weeklyLikes ||= {};
    if (index >= 0) { item.likedBy.splice(index, 1); item.likes = Math.max(0, item.likes - 1); }
    else { item.likedBy.push(userId); item.likes += 1; item.weeklyLikes[week] = (item.weeklyLikes[week] || 0) + 1; }
    if (index >= 0) item.weeklyLikes[week] = Math.max(0, (item.weeklyLikes[week] || 0) - 1);
    await writeStore(store);
    return { liked: index < 0, likes: item.likes };
  });
}
export async function settleGalleryRewards(): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const week = previousWeekKey();
    const winners = [...store.items].sort((a, b) => (b.weeklyLikes?.[week] || 0) - (a.weeklyLikes?.[week] || 0)).slice(0, 3);
    for (const [index, item] of winners.entries()) {
      if (!item.weeklyLikes?.[week] || item.rewardedWeek === week) continue;
      await grantAffOnce(item.ownerId, [500, 300, 100][index], "图库周榜奖励", `gallery-week:${week}:${item.id}`);
      item.rewardedWeek = week;
    }
    await writeStore(store);
  });
}

export async function publishLocalImage(
  ownerId: number,
  ownerName: string,
  buffer: Buffer,
  fileName: string,
  input: { title: string; authorName: string; rating: GalleryRating; source: GallerySource; tags: string[]; prompt: string; negativePrompt: string; parameters: Record<string, unknown> },
): Promise<GalleryItem> {
  return withLock(async () => {
    if (input.source !== "local" && input.source !== "other") throw new Error("本地上传来源不合法");
    const authorName = input.authorName.trim().slice(0, 80);
    if (!authorName) throw new Error("请填写作品作者或画师署名");
    const rating = assertGalleryRating(input.rating);
    const metadata = assertNaiImage(buffer, fileName);
    const id = randomUUID();
    const imageFile = `${id}.${metadata.extension}`;
    await mkdir(root(), { recursive: true });
    await writeFile(imagePath(imageFile), buffer);
    const item: GalleryItem = {
      id, ownerId, ownerName, authorName, title: input.title.trim().slice(0, 80) || "未命名作品",
      rating, source: input.source, tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 40),
      prompt: String(metadata.parameters.prompt || input.prompt),
      negativePrompt: String(metadata.parameters.negative_prompt || metadata.parameters.negativePrompt || input.negativePrompt),
      parameters: metadata.parameters,
      imageFile, createdAt: new Date().toISOString(), likes: 0, likedBy: [], weeklyLikes: {},
    };
    const store = await readStore();
    store.items.unshift(item);
    await writeStore(store);
    return item;
  });
}