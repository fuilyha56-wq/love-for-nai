import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { findHistory, historyImagePath } from "@/lib/history";
import { getRemoteHistoryImage } from "@/lib/remote-history";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";

export type GalleryRating = "general" | "r13" | "r17" | "r18";
export type GallerySource = "other" | "lfn" | "local";
export type GalleryStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const MAX_GALLERY_IMAGE_BYTES = 20 * 1024 * 1024;

export const ratingLabels: Record<GalleryRating, string> = {
  general: "全年龄",
  r13: "R13",
  r17: "R17",
  r18: "R18",
};

// 旧数据里的 sensitive 评级等价于 R13。
function normalizeRating(value: unknown): GalleryRating {
  if (value === "r13" || value === "r17" || value === "r18") return value;
  if (value === "sensitive") return "r13";
  return "general";
}

export function isRestrictedRating(rating: GalleryRating): boolean {
  return rating === "r17" || rating === "r18";
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
  imageMetadataStripped?: boolean;
  createdAt: string;
  likes: number;
  likedBy: number[];
  weeklyLikes?: Record<string, number>;
  rewardedWeek?: string;
  /** New submissions require moderation; legacy records default to approved. */
  status: GalleryStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: number;
  reviewNote?: string;
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
function normalizeStatus(value: unknown): GalleryStatus {
  return value === "pending" || value === "rejected" || value === "withdrawn" ? value : "approved";
}

function normalizeItem(item: Partial<GalleryItem>): GalleryItem {
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString();
  return {
    ...(item as GalleryItem),
    rating: normalizeRating(item.rating),
    status: normalizeStatus(item.status),
    submittedAt: typeof item.submittedAt === "string" ? item.submittedAt : createdAt,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
    likedBy: Array.isArray(item.likedBy) ? item.likedBy.filter((id): id is number => typeof id === "number") : [],
    likes: typeof item.likes === "number" ? item.likes : 0,
    parameters: item.parameters && typeof item.parameters === "object" ? item.parameters : {},
  };
}

async function readStore(): Promise<GalleryStore> {
  try {
    const value = JSON.parse(await readFile(storePath(), "utf8")) as GalleryStore;
    return { items: (Array.isArray(value.items) ? value.items : []).map((item) => normalizeItem(item)) };
  } catch { return { items: [] }; }
}
async function writeStore(store: GalleryStore): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}
export function galleryWeekKey(date = new Date()): string {
  const day = new Date(date.getTime() + 8 * 3600_000);
  const monday = new Date(day);
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  return monday.toISOString().slice(0, 10);
}
/**
 * 校验投稿评级是否为受支持的三级年龄评级。
 */
export function assertGalleryRating(rating: unknown): GalleryRating {
  if (rating === "general" || rating === "r13" || rating === "r17" || rating === "r18")
    return rating;
  throw new Error("内容评级不合法");
}

export function assertGalleryStatus(status: unknown): GalleryStatus {
  if (status === "pending" || status === "approved" || status === "rejected" || status === "withdrawn") return status;
  throw new Error("审核状态不合法");
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

async function stripImageMetadata(buffer: Buffer, fileName: string): Promise<{ data: Buffer; extension: string }> {
  const originalExtension = path.extname(fileName).toLowerCase();
  const format = originalExtension === ".jpg" || originalExtension === ".jpeg"
    ? "jpeg"
    : originalExtension === ".webp" ? "webp" : "png";
  const image = sharp(buffer).rotate();
  const data = format === "jpeg"
    ? await image.jpeg({ quality: 95 }).toBuffer()
    : format === "webp"
      ? await image.webp({ quality: 95 }).toBuffer()
      : await image.png({ compressionLevel: 9 }).toBuffer();
  return { data, extension: format === "jpeg" ? "jpg" : format };
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
    await mkdir(root(), { recursive: true });
    const source = history.remote
      ? (await getRemoteHistoryImage(ownerId, history.imagePath))?.data
      : await readFile(historyImagePath(ownerId, history.imagePath));
    if (!source) throw new Error("历史图片读取失败");
    const originalExtension = path.extname(history.imagePath).replace(/^\./, "") || "png";
    const cleaned = input.exposeParameters ? null : await stripImageMetadata(source, history.imagePath);
    const file = `${id}.${cleaned?.extension || originalExtension}`;
    await writeFile(imagePath(file), cleaned?.data || source);
    const item: GalleryItem = {
      id, ownerId, ownerName, authorName, title: input.title.trim().slice(0, 80) || "未命名作品",
      rating, source: input.source,
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 40),
      prompt: input.exposeParameters ? sourcePrompt : "", negativePrompt: input.exposeParameters ? sourceNegative : "",
      parameters: input.exposeParameters ? history.parameters : {}, imageFile: file,
      imageMetadataStripped: !input.exposeParameters,
      createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(), status: "pending", likes: 0, likedBy: [], weeklyLikes: {},
    };
    const store = await readStore();
    store.items.unshift(item);
    await writeStore(store);
    return item;
  });
}

export function publicGalleryItem(item: GalleryItem): GalleryItem {
  const safeItem = { ...item };
  delete safeItem.reviewedAt;
  delete safeItem.reviewedBy;
  delete safeItem.reviewNote;
  return {
    ...safeItem,
    likedBy: [],
    weeklyLikes: undefined,
    ...(Object.keys(item.parameters).length ? {} : { prompt: "", negativePrompt: "" }),
  };
}

function ownerGalleryItem(item: GalleryItem): GalleryItem {
  return { ...item, likedBy: [], weeklyLikes: undefined, ...(Object.keys(item.parameters).length ? {} : { prompt: "", negativePrompt: "" }) };
}

export async function listGallery(): Promise<GalleryItem[]> {
  return (await readStore()).items.filter((item) => item.status === "approved").map((item) => ({
    id: item.id,
    ownerId: item.ownerId,
    ownerName: item.ownerName,
    authorName: item.authorName,
    title: item.title,
    rating: item.rating,
    source: item.source,
    tags: item.tags,
    prompt: "",
    negativePrompt: "",
    parameters: {},
    imageFile: item.imageFile,
    imageMetadataStripped: item.imageMetadataStripped,
    createdAt: item.createdAt,
    likes: item.likes,
    likedBy: [],
    status: item.status,
    submittedAt: item.submittedAt,
  }));
}

export async function countGallery(): Promise<number> {
  return (await readStore()).items.length;
}

export async function listGalleryAdmin(status?: GalleryStatus | "all"): Promise<GalleryItem[]> {
  const items = (await readStore()).items;
  return status && status !== "all" ? items.filter((item) => item.status === status) : items;
}

export async function listGalleryMine(ownerId: number): Promise<GalleryItem[]> {
  return (await readStore()).items.filter((item) => item.ownerId === ownerId).map(ownerGalleryItem);
}

export async function updateGalleryItem(
  id: string,
  patch: {
    title?: string;
    authorName?: string;
    rating?: GalleryRating;
    tags?: string[];
    status?: GalleryStatus;
    reviewNote?: string;
    reviewedBy?: number;
  },
): Promise<GalleryItem> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);
    if (!item) throw new Error("图库作品不存在");
    if (typeof patch.title === "string")
      item.title = patch.title.trim().slice(0, 80) || item.title;
    if (typeof patch.authorName === "string") {
      const authorName = patch.authorName.trim().slice(0, 80);
      if (!authorName) throw new Error("请填写作品作者或画师署名");
      item.authorName = authorName;
    }
    if (patch.rating) item.rating = assertGalleryRating(patch.rating);
    if (patch.tags)
      item.tags = patch.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 40);
    if (patch.status) {
      item.status = patch.status;
      item.reviewedAt = new Date().toISOString();
      if (patch.reviewedBy !== undefined) item.reviewedBy = patch.reviewedBy;
      if (patch.reviewNote !== undefined) item.reviewNote = patch.reviewNote.trim().slice(0, 500);
    }
    await writeStore(store);
    return item;
  });
}

export async function deleteGalleryItem(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);
    if (!item) return false;
    store.items = store.items.filter((entry) => entry.id !== id);
    await writeStore(store);
    await unlink(imagePath(item.imageFile)).catch(() => undefined);
    return true;
  });
}
export async function getGalleryItem(id: string): Promise<GalleryItem | null> {
  return (await readStore()).items.find((item) => item.id === id) || null;
}

export async function resubmitGalleryItem(ownerId: number, id: string, note?: string): Promise<GalleryItem> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id && entry.ownerId === ownerId);
    if (!item) throw new Error("投稿不存在");
    if (item.status !== "rejected" && item.status !== "withdrawn") throw new Error("当前状态不能重新提交");
    item.status = "pending";
    item.submittedAt = new Date().toISOString();
    item.reviewedAt = undefined;
    item.reviewedBy = undefined;
    item.reviewNote = note?.trim().slice(0, 500) || undefined;
    await writeStore(store);
    return ownerGalleryItem(item);
  });
}

export async function withdrawGalleryItem(ownerId: number, id: string): Promise<GalleryItem> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id && entry.ownerId === ownerId);
    if (!item) throw new Error("投稿不存在");
    if (item.status !== "pending" && item.status !== "approved") throw new Error("当前状态不能撤回");
    item.status = "withdrawn";
    item.reviewedAt = new Date().toISOString();
    await writeStore(store);
    return ownerGalleryItem(item);
  });
}
export function galleryImagePath(file: string): string { return imagePath(file); }

export async function readGalleryImage(item: GalleryItem): Promise<{ data: Buffer; extension: string }> {
  const filePath = imagePath(item.imageFile);
  const data = await readFile(filePath);
  const extension = path.extname(item.imageFile).slice(1) || "png";
  if (Object.keys(item.parameters).length > 0 || item.imageMetadataStripped === true) {
    return { data, extension };
  }

  return withLock(async () => {
    const store = await readStore();
    const storedItem = store.items.find((entry) => entry.id === item.id);
    if (!storedItem || Object.keys(storedItem.parameters).length > 0 || storedItem.imageMetadataStripped) {
      return { data: await readFile(filePath), extension };
    }
    const cleaned = await stripImageMetadata(data, storedItem.imageFile);
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, cleaned.data);
    await rename(temporary, filePath);
    storedItem.imageMetadataStripped = true;
    await writeStore(store);
    return { data: cleaned.data, extension: cleaned.extension };
  });
}
export async function toggleGalleryLike(id: string, userId: number): Promise<{ liked: boolean; likes: number }> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);
    if (!item || item.status !== "approved") throw new Error("图库作品不存在");
    const index = item.likedBy.indexOf(userId);
    const week = galleryWeekKey();
    item.weeklyLikes ||= {};
    if (index >= 0) { item.likedBy.splice(index, 1); item.likes = Math.max(0, item.likes - 1); }
    else { item.likedBy.push(userId); item.likes += 1; item.weeklyLikes[week] = (item.weeklyLikes[week] || 0) + 1; }
    if (index >= 0) item.weeklyLikes[week] = Math.max(0, (item.weeklyLikes[week] || 0) - 1);
    await writeStore(store);
    return { liked: index < 0, likes: item.likes };
  });
}
/** Mark the explicitly settled weekly winners without granting credits here. */
export async function markGalleryRewards(week: string, itemIds: string[]): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const ids = new Set(itemIds);
    for (const item of store.items) {
      if (ids.has(item.id)) item.rewardedWeek = week;
    }
    await writeStore(store);
  });
}

export async function publishLocalImage(
  ownerId: number,
  ownerName: string,
  buffer: Buffer,
  fileName: string,
  input: { title: string; authorName: string; rating: GalleryRating; source: GallerySource; tags: string[]; prompt: string; negativePrompt: string; parameters: Record<string, unknown>; exposeParameters: boolean },
): Promise<GalleryItem> {
  return withLock(async () => {
    if (input.source !== "local" && input.source !== "other") throw new Error("本地上传来源不合法");
    const authorName = input.authorName.trim().slice(0, 80);
    if (!authorName) throw new Error("请填写作品作者或画师署名");
    const rating = assertGalleryRating(input.rating);
    const metadata = assertNaiImage(buffer, fileName);
    const id = randomUUID();
    const cleaned = input.exposeParameters ? null : await stripImageMetadata(buffer, fileName);
    const imageFile = `${id}.${cleaned?.extension || metadata.extension}`;
    await mkdir(root(), { recursive: true });
    await writeFile(imagePath(imageFile), cleaned?.data || buffer);
    const item: GalleryItem = {
      id, ownerId, ownerName, authorName, title: input.title.trim().slice(0, 80) || "未命名作品",
      rating, source: input.source, tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 40),
      prompt: input.exposeParameters ? String(metadata.parameters.prompt || input.prompt) : "",
      negativePrompt: input.exposeParameters ? String(metadata.parameters.negative_prompt || metadata.parameters.negativePrompt || input.negativePrompt) : "",
      parameters: input.exposeParameters ? metadata.parameters : {},
      imageFile, createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(), status: "pending", likes: 0, likedBy: [], weeklyLikes: {},
      imageMetadataStripped: !input.exposeParameters,
    };
    const store = await readStore();
    store.items.unshift(item);
    await writeStore(store);
    return item;
  });
}