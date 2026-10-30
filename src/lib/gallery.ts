import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripImageMetadata } from "@/lib/image-processing";
import { invalidateCachedJsonFile, readCachedJsonFile } from "@/lib/server-json-cache";
import { findHistory, historyImagePath } from "@/lib/history";
import { getRemoteHistoryImage } from "@/lib/remote-history";
import { parseNaiImageMetadata } from "@/lib/nai-metadata";
import { hasImageCharacterPrompts, restoreImageCharacterPrompts } from "@/lib/image-character-prompts";
import { galleryComments } from "@/lib/gallery-comments";
import { deleteCommentNotifications } from "@/lib/notifications";
import sharp from "sharp";
import { withDataFileLock } from "@/lib/data-file-lock";
import { publicPublication, hasReadableGenerationMetadata, type GalleryPublicationInput, type GalleryPromptMode, type GalleryMetadataState } from "@/lib/gallery-publication";
import type { GalleryActivityState, GalleryActivityRevision, GalleryActivityInteraction } from "@/lib/gallery-activity-types";
import { canonicalGalleryTag } from "@/lib/gallery-tags";

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
  originalProofStatus?: "metadata-validated" | "reviewed";
  originalFileName?: string;
  promptMode?: GalleryPromptMode;
  metadataState?: GalleryMetadataState;
  noOriginalData?: boolean;
  upscaled?: boolean;
  publicationVersion?: string;
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
  requireLikeForParameters?: boolean;
  parametersLocked?: boolean;
  liked?: boolean;
  createdAt: string;
  likes: number;
  /** Counted after a download action succeeds; older records default to 0. */
  downloads?: number;
  /** Counted when a work is explicitly imported or selected as a reference. */
  uses?: number;
  likedBy: number[];
  weeklyLikes?: Record<string, number>;
  weeklyDownloads?: Record<string, number>;
  weeklyUses?: Record<string, number>;
  rewardedWeek?: string;
  /** New submissions require moderation; legacy records default to approved. */
  status: GalleryStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: number;
  reviewNote?: string;
};

type GalleryStore = { items: GalleryItem[]; activityRevisions?: GalleryActivityRevision[]; activityInteractions?: GalleryActivityInteraction[] };
const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "gallery");
const storePath = () => path.join(root(), "index.json");
const imagePath = (file: string) => path.join(root(), path.basename(file));
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = () => withDataFileLock("gallery", task);
  const current = lock.then(run, run);
  lock = current.catch(() => undefined);
  return current;
}
function normalizeStatus(value: unknown): GalleryStatus {
  return value === "pending" || value === "rejected" || value === "withdrawn" ? value : "approved";
}

function normalizeItem(item: Partial<GalleryItem>): GalleryItem {
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString();
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const weeklyCounts = (value: unknown): Record<string, number> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([week, amount]) => /^\d{4}-\d{2}-\d{2}$/.test(week) && typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0))
      : {};
  return {
    ...(item as GalleryItem),
    rating: normalizeRating(item.rating),
    status: normalizeStatus(item.status),
    submittedAt: typeof item.submittedAt === "string" ? item.submittedAt : createdAt,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
    likedBy: Array.isArray(item.likedBy) ? item.likedBy.filter((id): id is number => typeof id === "number") : [],
    likes: typeof item.likes === "number" ? item.likes : 0,
    downloads: count(item.downloads),
    uses: count(item.uses),
    weeklyLikes: weeklyCounts(item.weeklyLikes),
    weeklyDownloads: weeklyCounts(item.weeklyDownloads),
    weeklyUses: weeklyCounts(item.weeklyUses),
    parameters: item.parameters && typeof item.parameters === "object" ? item.parameters : {},
  };
}

async function readStore(readOnly = false): Promise<GalleryStore> {
  try { return await readCachedJsonFile(storePath(), (raw) => {
    const value = raw as GalleryStore;
    return { items: (Array.isArray(value?.items) ? value.items : []).map((item) => normalizeItem(item)), activityRevisions: value.activityRevisions || [], activityInteractions: value.activityInteractions || [] };
  }, { clone: !readOnly }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { items: [], activityRevisions: [], activityInteractions: [] };
  }
}
async function writeStore(store: GalleryStore): Promise<void> {
  const now = new Date().toISOString();
  store.activityRevisions ||= [];
  const latest = new Map(store.activityRevisions.map(revision => [revision.id, revision]));
  for (const item of store.items) {
    const revision: GalleryActivityRevision = {
      id: item.id, at: now, version: item.publicationVersion || item.id, ownerId: item.ownerId, ownerName: item.ownerName,
      authorName: item.authorName, title: item.title, originalFileName: item.originalFileName, rating: item.rating,
      source: item.source, tags: item.tags, status: item.status, submittedAt: item.submittedAt, reviewedAt: item.reviewedAt,
      promptMode: item.promptMode, metadataState: item.metadataState, noOriginalData: item.noOriginalData, upscaled: item.upscaled, originalProofStatus: item.originalProofStatus,
    };
    const previous = latest.get(item.id);
    if (!previous || JSON.stringify({ ...previous, at: now }) !== JSON.stringify(revision)) store.activityRevisions.push(revision);
    latest.delete(item.id);
  }
  for (const revision of latest.values()) if (revision.status !== "withdrawn") store.activityRevisions.push({ ...revision, at: now, status: "withdrawn" });
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
  invalidateCachedJsonFile(target);
}

export async function galleryActivityState(): Promise<GalleryActivityState> {
  const store = await readStore();
  return { revisions: store.activityRevisions || [], interactions: store.activityInteractions || [] };
}

function galleryTitle(value: string, fallback = "未命名作品"): string {
  if (value.trim().length > 500) throw new Error("作品名不能超过 500 字符");
  return value.trim() || fallback;
}

type SubmissionInput = GalleryPublicationInput & { title: string; authorName: string; rating: GalleryRating; source: GallerySource; tags: string[]; exposeParameters: boolean; requireLikeForParameters?: boolean; originalProofUpload?: { data: Buffer; fileName: string } };

async function createGallerySubmission(ownerId: number, ownerName: string, buffer: Buffer, fileName: string | undefined, input: SubmissionInput, trustedParameters?: Record<string, unknown>): Promise<GalleryItem> {
  if (buffer.length > MAX_GALLERY_IMAGE_BYTES) throw new Error("图片不能超过 20 MB");
  const decoded = await sharp(buffer, { limitInputPixels: 80_000_000 }).metadata();
  if (decoded.format !== "png" && decoded.format !== "jpeg") throw new Error("只支持 PNG 或 JPEG 图片");
  await sharp(buffer, { limitInputPixels: 80_000_000 }).resize(1, 1).raw().toBuffer();
  const authorName = input.authorName.trim();
  if (!authorName || authorName.length > 80) throw new Error("请填写不超过 80 字符的作品作者或画师署名");
  const originalFileName = fileName?.replaceAll("\\", "/").split("/").at(-1) || undefined;
  if (originalFileName && originalFileName.length > 255) throw new Error("原始图片文件名不能超过 255 字符");
  const title = galleryTitle(input.title, originalFileName?.replace(/\.[^.]+$/, ""));
  const embedded = parseNaiImageMetadata(buffer);
  let sourceParameters = hasReadableGenerationMetadata(trustedParameters) ? trustedParameters : embedded?.isNai ? embedded.parameters : null;
  const displayMetadataReadable = hasReadableGenerationMetadata(sourceParameters);
  let proofExtension: string | undefined;
  if (input.originalProofUpload) {
    const proof = input.originalProofUpload;
    if (proof.data.length > MAX_GALLERY_IMAGE_BYTES) throw new Error("校验原图不能超过 20 MB");
    const info = await sharp(proof.data, { limitInputPixels: 80_000_000 }).metadata();
    if (info.format !== "png" && info.format !== "jpeg") throw new Error("校验原图只支持 PNG 或 JPEG");
    await sharp(proof.data, { limitInputPixels: 80_000_000 }).resize(1, 1).raw().toBuffer();
    const metadata = parseNaiImageMetadata(proof.data);
    if (!metadata?.isNai || !hasReadableGenerationMetadata(metadata.parameters)) throw new Error("校验原图必须携带可读取的 NAI 原始生成元数据，不能用手填参数代替");
    sourceParameters = metadata.parameters;
    proofExtension = info.format === "jpeg" ? "jpg" : "png";
  }
  const publication = publicPublication(sourceParameters, input, input.exposeParameters);
  const id = randomUUID();
  const requireLikeForParameters = (publication.promptMode === "full" || publication.promptMode === "partial") && input.requireLikeForParameters === true;
  const strip = Boolean(input.originalProofUpload) || publication.promptMode !== "full" || requireLikeForParameters;
  const cleaned = strip ? await stripImageMetadata(buffer, originalFileName || "image.png") : null;
  const imageFile = `${id}.${cleaned?.extension || (decoded.format === "jpeg" ? "jpg" : "png")}`;
  await mkdir(path.join(root(), "private"), { recursive: true });
  // This directory has no HTTP route. Only server-side revalidation reads it.
  const proofFile = proofExtension ? `${id}-original.${proofExtension}` : undefined;
  if (proofFile) await writeFile(path.join(root(), "private", proofFile), input.originalProofUpload!.data, { mode: 0o600 });
  await writeFile(path.join(root(), "private", `${id}.json`), JSON.stringify({ parameters: sourceParameters, proofFile }), { mode: 0o600 });
  await writeFile(imagePath(imageFile), cleaned?.data || buffer);
  const now = new Date().toISOString();
  const item: GalleryItem = {
    id, ownerId, ownerName, authorName, title, originalFileName, rating: assertGalleryRating(input.rating), source: input.source,
    tags: input.tags.map(tag => tag.trim()).filter(Boolean).slice(0, 40), ...publication,
    ...(input.originalProofUpload ? { originalProofStatus: "metadata-validated" as const, metadataState: displayMetadataReadable ? "readable" as const : "missing" as const, noOriginalData: true } : {}),
    upscaled: input.upscaled === true || /upscale|superres/i.test(String(sourceParameters?.operation || sourceParameters?.action || "")), publicationVersion: randomUUID(), imageFile, imageMetadataStripped: strip, requireLikeForParameters,
    createdAt: now, submittedAt: now, status: "pending", likes: 0, likedBy: [], weeklyLikes: {},
  };
  const store = await readStore(); store.items.unshift(item); await writeStore(store);
  return item;
}
export function galleryWeekKey(date = new Date()): string {
  const monday = new Date(date);
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  monday.setUTCHours(0, 0, 0, 0);
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

export async function publishFromHistory(
  ownerId: number,
  ownerName: string,
  historyId: string,
  input: SubmissionInput,
): Promise<GalleryItem> {
  return withLock(async () => {
    const history = await findHistory(ownerId, historyId);
    if (!history) throw new Error("历史图片不存在");
    if (!["other", "lfn", "local"].includes(input.source)) throw new Error("图片来源不合法");
    const source = history.remote
      ? (await getRemoteHistoryImage(ownerId, history.imagePath))?.data
      : await readFile(historyImagePath(ownerId, history.imagePath));
    if (!source) throw new Error("历史图片读取失败");
    const parameters = restoreImageCharacterPrompts(history.parameters, parseNaiImageMetadata(source)?.parameters || {});
    const upscaled = input.upscaled === true || /upscale|superres/i.test(String(parameters.operation || parameters.action || parameters.mode || ""));
    // History imagePath is an internal storage key, not an original upload filename.
    return createGallerySubmission(ownerId, ownerName, source, undefined, { ...input, upscaled }, parameters);
  });
}

export function publicGalleryItem(item: GalleryItem, viewerId?: number): GalleryItem {
  const safeItem = { ...item };
  delete safeItem.reviewedAt;
  delete safeItem.reviewedBy;
  delete safeItem.reviewNote;
  const liked = viewerId != null && item.likedBy.includes(viewerId);
  const parametersLocked = item.requireLikeForParameters === true && viewerId !== item.ownerId && !liked;
  return {
    ...safeItem,
    likedBy: [],
    weeklyLikes: undefined,
    liked,
    parametersLocked,
    ...(parametersLocked ? { prompt: "", negativePrompt: "", parameters: {} } : {}),
    ...(Object.keys(item.parameters).length ? {} : { prompt: "", negativePrompt: "" }),
  };
}

function ownerGalleryItem(item: GalleryItem): GalleryItem {
  return { ...item, tags: [...item.tags], parameters: structuredClone(item.parameters), likedBy: [], weeklyLikes: undefined, ...(Object.keys(item.parameters).length ? {} : { prompt: "", negativePrompt: "" }) };
}

export async function listGallery(): Promise<GalleryItem[]> {
  return (await readStore(true)).items.filter((item) => item.status === "approved").map((item) => ({
    id: item.id,
    ownerId: item.ownerId,
    ownerName: item.ownerName,
    authorName: item.authorName,
    title: item.title,
    originalFileName: item.originalFileName,
    promptMode: item.promptMode,
    metadataState: item.metadataState,
    noOriginalData: item.noOriginalData,
    upscaled: item.upscaled,
    originalProofStatus: item.originalProofStatus,
    rating: item.rating,
    source: item.source,
    tags: [...item.tags],
    prompt: "",
    negativePrompt: "",
    parameters: {},
    imageFile: item.imageFile,
    imageMetadataStripped: item.imageMetadataStripped,
    createdAt: item.createdAt,
    likes: item.likes,
    downloads: item.downloads || 0,
    uses: item.uses || 0,
    likedBy: [],
    status: item.status,
    submittedAt: item.submittedAt,
  }));
}

export type GallerySort = "newest" | "likes" | "downloads" | "uses";
export type GalleryQuery = {
  category?: string;
  q?: string;
  tags?: string[];
  rating?: string;
  sort?: GallerySort;
  page?: number;
  pageSize?: number;
};
export type GalleryQueryResult = {
  items: GalleryItem[];
  tags: string[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Public, paginated discovery query. Search never considers private prompts or metadata. */
export async function queryGallery(query: GalleryQuery = {}): Promise<GalleryQueryResult> {
  const all = await listGallery();
  const search = (query.q || "").trim().toLocaleLowerCase();
  const selectedTags = (query.tags || []).map(canonicalGalleryTag).filter(Boolean);
  const rating = query.rating && ["general", "r13", "r17", "r18"].includes(query.rating) ? query.rating : "all";
  const tagFrequency = new Map<string, number>();
  for (const item of all) for (const tag of item.tags) {
    const normalized = tag.trim();
    if (normalized) tagFrequency.set(normalized, (tagFrequency.get(normalized) || 0) + 1);
  }
  const tags = [...tagFrequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 200)
    .map(([tag]) => tag);
  const filtered = all.filter((item) => {
    if (query.category === "no-original-data" && item.noOriginalData !== true) return false;
    if (rating !== "all" && item.rating !== rating) return false;
    const itemTags = item.tags.map(canonicalGalleryTag);
    if (selectedTags.some((tag) => !itemTags.includes(tag))) return false;
    if (!search) return true;
    const searchable = [item.title, item.authorName, item.ownerName, ...item.tags].join(" ").toLocaleLowerCase();
    return search.split(/\s+/).every((part) => searchable.includes(part));
  });
  const sort = query.sort && ["likes", "downloads", "uses"].includes(query.sort) ? query.sort : "newest";
  const metric = (item: GalleryItem) => sort === "likes" ? item.likes : sort === "downloads" ? item.downloads || 0 : item.uses || 0;
  filtered.sort((a, b) => sort === "newest"
    ? b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
    : metric(b) - metric(a) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const pageSize = Number.isSafeInteger(query.pageSize) ? Math.min(100, Math.max(1, Number(query.pageSize))) : 100;
  const total = filtered.length;
  const pageCount = Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, Number.isSafeInteger(query.page) ? Number(query.page) : 1), Math.max(1, pageCount));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), tags, total, page, pageSize, pageCount };
}

export async function recordGalleryMetric(id: string, kind: "download" | "use", userId?: number): Promise<{ downloads?: number; uses?: number } | null> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id && entry.status === "approved");
    if (!item) return null;
    const week = galleryWeekKey();
    if (kind === "download") {
      item.downloads = (item.downloads || 0) + 1;
      item.weeklyDownloads ||= {};
      item.weeklyDownloads[week] = (item.weeklyDownloads[week] || 0) + 1;
      await writeStore(store);
      return { downloads: item.downloads };
    }
    item.uses = (item.uses || 0) + 1;
    item.weeklyUses ||= {};
    item.weeklyUses[week] = (item.weeklyUses[week] || 0) + 1;
    if (userId && userId !== item.ownerId) {
      store.activityInteractions ||= [];
      store.activityInteractions.push({ id, userId, at: new Date().toISOString(), version: item.publicationVersion || item.id, kind: "import" });
    }
    await writeStore(store);
    return { uses: item.uses };
  });
}

export async function countGallery(): Promise<number> {
  return (await readStore(true)).items.length;
}

export async function listGalleryAdmin(status?: GalleryStatus | "all"): Promise<GalleryItem[]> {
  const items = (await readStore(true)).items;
  return (status && status !== "all" ? items.filter((item) => item.status === status) : items).map((item) => structuredClone(item));
}

export async function listGalleryMine(ownerId: number): Promise<GalleryItem[]> {
  return (await readStore(true)).items.filter((item) => item.ownerId === ownerId).map(ownerGalleryItem);
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
    confirmOriginalProof?: boolean;
  },
): Promise<GalleryItem> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);
    if (!item) throw new Error("图库作品不存在");
    if (typeof patch.title === "string")
      item.title = galleryTitle(patch.title, item.title);
    if (typeof patch.authorName === "string") {
      const authorName = patch.authorName.trim().slice(0, 80);
      if (!authorName) throw new Error("请填写作品作者或画师署名");
      item.authorName = authorName;
    }
    if (patch.rating) item.rating = assertGalleryRating(patch.rating);
    if (patch.tags) {
      item.tags = patch.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 40);
      item.publicationVersion = randomUUID();
    }
    if (patch.status) {
      if (patch.status === "approved" && item.originalProofStatus === "metadata-validated") {
        if (!patch.confirmOriginalProof) throw new Error("请先查看校验原图，并确认它与修改后参赛图属于同一创作，再通过审核");
        item.originalProofStatus = "reviewed";
      }
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
    await unlink(path.join(root(), "private", `${item.id}.json`)).catch(() => undefined);
    for (const extension of ["png", "jpg"]) await unlink(path.join(root(), "private", `${item.id}-original.${extension}`)).catch(() => undefined);
    const comments = await galleryComments.listComments(id);
    await galleryComments.deleteCommentsForResource(id);
    await deleteCommentNotifications("gallery", comments.map(comment => comment.id));
    return true;
  });
}

/** A failed revalidation leaves the previous publication untouched. Changes require a fresh review. */
export async function updateGalleryPublication(ownerId: number, id: string, input: GalleryPublicationInput & { requireLikeForParameters?: boolean }): Promise<GalleryItem> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find(i => i.id === id && i.ownerId === ownerId);
    if (!item) throw new Error("投稿不存在");
    let source: Record<string, unknown> | null = null;
    try { source = (JSON.parse(await readFile(path.join(root(), "private", `${item.id}.json`), "utf8")) as { parameters: Record<string, unknown> | null }).parameters; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!source && (!item.promptMode || item.promptMode === "full") && Object.keys(item.parameters).length) source = item.parameters;
    const publication = publicPublication(source, input, true);
    const cleaned = await stripImageMetadata(await readFile(imagePath(item.imageFile)), item.imageFile);
    const temp = `${imagePath(item.imageFile)}.${randomUUID()}.tmp`;
    await writeFile(temp, cleaned.data); await rename(temp, imagePath(item.imageFile));
    Object.assign(item, publication, { metadataState: item.metadataState || publication.metadataState, noOriginalData: Boolean(item.originalProofStatus) || item.metadataState === "missing" || publication.noOriginalData, upscaled: item.upscaled || input.upscaled === true, imageMetadataStripped: true,
      requireLikeForParameters: (publication.promptMode === "full" || publication.promptMode === "partial") && input.requireLikeForParameters === true,
      publicationVersion: randomUUID(), submittedAt: new Date().toISOString(), status: "pending", reviewedAt: undefined, reviewedBy: undefined, reviewNote: undefined });
    await writeStore(store);
    return ownerGalleryItem(item);
  });
}

export async function readGalleryOriginalProof(id: string): Promise<{ data: Buffer; extension: string } | null> {
  const item = await getGalleryItem(id);
  if (!item?.originalProofStatus) return null;
  const privateInfo = JSON.parse(await readFile(path.join(root(), "private", `${item.id}.json`), "utf8")) as { proofFile?: string };
  if (!privateInfo.proofFile || ![`${id}-original.png`, `${id}-original.jpg`].includes(privateInfo.proofFile)) return null;
  return { data: await readFile(path.join(root(), "private", privateInfo.proofFile)), extension: privateInfo.proofFile.endsWith(".jpg") ? "jpg" : "png" };
}
export async function getGalleryItem(id: string): Promise<GalleryItem | null> {
  const item = (await readStore(true)).items.find((entry) => entry.id === id);
  if (!item) return null;
  const result = structuredClone(item);
  // Old history submissions dropped characterPrompts, but the original image
  // often still contains them. Recover only inside parameters, so the existing
  // publication/like gate also protects every character's text.
  if ((!result.promptMode || result.promptMode === "full") && !result.imageMetadataStripped && Object.keys(result.parameters).length && !hasImageCharacterPrompts(result.parameters)) {
    try {
      const metadata = parseNaiImageMetadata(await readFile(imagePath(result.imageFile)));
      if (metadata) result.parameters = restoreImageCharacterPrompts(result.parameters, metadata.parameters);
    } catch { /* Missing/unreadable old images must not break their detail page. */ }
  }
  return result;
}

export async function resubmitGalleryItem(ownerId: number, id: string, note?: string): Promise<GalleryItem> {
  return withLock(async () => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id && entry.ownerId === ownerId);
    if (!item) throw new Error("投稿不存在");
    if (item.status !== "rejected" && item.status !== "withdrawn") throw new Error("当前状态不能重新提交");
    item.status = "pending";
    item.publicationVersion = randomUUID();
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
  if ((Object.keys(item.parameters).length > 0 && !item.requireLikeForParameters) || item.imageMetadataStripped === true) {
    return { data, extension };
  }

  return withLock(async () => {
    const store = await readStore();
    const storedItem = store.items.find((entry) => entry.id === item.id);
    if (!storedItem || (Object.keys(storedItem.parameters).length > 0 && !storedItem.requireLikeForParameters) || storedItem.imageMetadataStripped) {
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
    store.activityInteractions ||= [];
    store.activityInteractions.push({ id, userId, at: new Date().toISOString(), version: item.publicationVersion || item.id, kind: index < 0 ? "like" : "unlike" });
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
  input: SubmissionInput & { prompt: string; negativePrompt: string; parameters: Record<string, unknown> },
): Promise<GalleryItem> {
  if (input.source !== "local" && input.source !== "other") throw new Error("本地上传来源不合法");
  return withLock(() => createGallerySubmission(ownerId, ownerName, buffer, fileName, input));
}
