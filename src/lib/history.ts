import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageProviderProtocol } from "./image-model-capabilities";
import { hasImageCharacterPrompts, readImageCharacterPrompts } from "./image-character-prompts";
import {
  deleteRemoteHistoryImage,
  getRemoteHistoryImage,
  putRemoteHistoryImage,
} from "@/lib/remote-history";
import { embedWatermark, verifyWatermark } from "@/lib/image-watermark";

export type GenerationParameters = {
  [key: string]: unknown;
  operation: string;
  model?: string;
  providerId?: string;
  imageProtocol?: ImageProviderProtocol;
  quality?: string;
  imageSize?: string;
  background?: string;
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  n?: number;
  sampler?: string;
  noise_schedule?: string;
  cfg_rescale?: number;
  seed?: number;
  strength?: number;
};
export type HistoryItem = {
  id: string;
  createdAt: string;
  imagePath: string;
  saved: boolean;
  parameters: GenerationParameters;
  usage: unknown;
  remote?: boolean;
  fingerprint?: string;
  requestId?: string;
  requestFingerprint?: string;
  imageSha256?: string;
  watermarkStatus?: "embedded" | "disabled" | "skipped" | "failed";
};

const historyRoot = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "history",
  );
const userDirectory = (userId: number) =>
  path.join(historyRoot(), String(userId));
const indexPath = (userId: number) =>
  path.join(userDirectory(userId), "index.json");

async function readIndex(userId: number): Promise<HistoryItem[]> {
  try {
    return JSON.parse(
      await readFile(indexPath(userId), "utf8"),
    ) as HistoryItem[];
  } catch {
    return [];
  }
}

async function writeIndex(userId: number, items: HistoryItem[]) {
  await mkdir(userDirectory(userId), { recursive: true });
  const target = indexPath(userId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(items, null, 2), "utf8");
  await rename(temporary, target);
}

const userLocks = new Map<number, Promise<unknown>>();

// 同一用户的历史读改写必须串行，否则并发生成会互相覆盖索引。
function withUserLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const previous = userLocks.get(userId) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => undefined);
  userLocks.set(userId, tail);
  // 队列排空后移除条目，避免用户量增长导致 Map 无限累积。
  void tail.then(() => {
    if (userLocks.get(userId) === tail) userLocks.delete(userId);
  });
  return current;
}

function safeParameters(body: Record<string, unknown>): GenerationParameters {
  const excluded = new Set([
    "image",
    "mask",
    "reference_image",
    "reference_images",
    "references",
    "characters",
    "characterPrompts",
    "source",
    "_lfnRequestId",
    "_lfnRequestFingerprint",
    "_lfnSkipWatermark",
    "_lfnWatermarkStatus",
    "_lfnSkipServerHistory",
  ]);
  const parameters = Object.fromEntries(
    Object.keys(body)
      .filter((key) => !excluded.has(key) && body[key] !== undefined)
      .map((key) => [key, body[key]]),
  ) as GenerationParameters;
  if (hasImageCharacterPrompts(body)) parameters.characterPrompts = readImageCharacterPrompts(body);
  return parameters;
}

function generateFingerprint(userId: number, timestamp: string, parameters: GenerationParameters): string {
  const payload = JSON.stringify({ userId, timestamp, parameters });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function isIntermediateHistoryItem(item: HistoryItem): boolean {
  const parameters = item.parameters as Record<string, unknown>;
  if (
    parameters._lfnHistoryVisibility === "intermediate" ||
    parameters._lfnEditorIntermediate === true ||
    parameters.editor_composite === true
  ) return true;
  const operation = String(parameters.operation || "");
  if (operation === "editor-tile" || operation === "editor-patch") return true;
  return typeof parameters.prompt === "string" &&
    parameters.prompt.includes("continue details naturally across the crop edges");
}

async function historyImageHash(userId: number, item: HistoryItem): Promise<string | null> {
  if (item.imageSha256 && /^[a-f\d]{64}$/i.test(item.imageSha256)) return item.imageSha256.toLowerCase();
  let data: Buffer | null = null;
  if (item.remote) {
    data = (await getRemoteHistoryImage(userId, item.imagePath))?.data || null;
  } else {
    data = await readFile(path.join(userDirectory(userId), item.imagePath)).catch(() => null);
  }
  if (!data) return null;
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    try {
      const verified = await verifyWatermark(`data:image/png;base64,${data.toString("base64")}`);
      if (verified.valid && verified.payload?.sha256) return verified.payload.sha256.toLowerCase();
    } catch { /* fall back to the stored bytes when metadata cannot be verified */ }
  }
  return createHash("sha256").update(data).digest("hex");
}

/** Repair old duplicate and intermediate rows when a user next opens image history. */
async function repairHistory(userId: number): Promise<HistoryItem[]> {
  const items = await readIndex(userId);
  const keep = new Set(items.map((item) => item.id));
  const requestGroups = new Map<string, HistoryItem[]>();
  for (const item of items) {
    if (isIntermediateHistoryItem(item)) {
      keep.delete(item.id);
      continue;
    }
    if (!item.requestId) continue;
    const group = requestGroups.get(item.requestId) || [];
    group.push(item);
    requestGroups.set(item.requestId, group);
  }
  for (const group of requestGroups.values()) {
    if (group.length < 2) continue;
    const seen = new Set<string>();
    // Index order is newest first. Keep the first copy users already encounter.
    const hashes = new Array<string | null>(group.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, group.length) }, async () => {
      while (cursor < group.length) {
        const index = cursor++;
        hashes[index] = await historyImageHash(userId, group[index]);
      }
    }));
    for (const [index, item] of group.entries()) {
      const hash = hashes[index];
      if (!hash) continue;
      if (seen.has(hash)) keep.delete(item.id);
      else seen.add(hash);
    }
  }
  if (keep.size === items.length) return items;
  const retained = items.filter((item) => keep.has(item.id));
  const retainedPaths = new Set(retained.map((item) => item.imagePath));
  await writeIndex(userId, retained);
  for (const item of items) {
    if (keep.has(item.id) || retainedPaths.has(item.imagePath)) continue;
    if (item.remote) await deleteRemoteHistoryImage(userId, item.imagePath);
    else await unlink(path.join(userDirectory(userId), item.imagePath)).catch(() => undefined);
  }
  return retained;
}

const LOCAL_HISTORY_LIMIT = 40;
const REMOTE_HISTORY_LIMIT = 60;

export type SaveHistoryOptions = {
  imageIds?: string[];
  requestId?: string;
  requestFingerprint?: string;
  skipWatermark?: boolean;
  watermarkStatus?: HistoryItem["watermarkStatus"];
};

/** Reserve browser-visible IDs before background persistence starts. */
export function reserveHistoryImageIds(images: string[]): string[] {
  const ids = new Map<string, string>();
  return images.map((image) => {
    const id = ids.get(image) || randomUUID();
    ids.set(image, id);
    return id;
  });
}

export async function saveHistory(
  userId: number,
  body: Record<string, unknown>,
  images: string[],
  usage: unknown,
  options: SaveHistoryOptions = {},
) {
  // 客户端可选择仅在本机保存或完全不保存；服务端仍负责鉴权、计费和审计。
  if (body._lfnSkipServerHistory === true) return [];
  const effectiveOptions: SaveHistoryOptions = {
    ...options,
    requestId: options.requestId || (typeof body._lfnRequestId === "string" ? body._lfnRequestId : undefined),
    requestFingerprint: options.requestFingerprint || (typeof body._lfnRequestFingerprint === "string" ? body._lfnRequestFingerprint : undefined),
    skipWatermark: options.skipWatermark ?? body._lfnSkipWatermark === true,
    watermarkStatus: options.watermarkStatus || (typeof body._lfnWatermarkStatus === "string" ? body._lfnWatermarkStatus as HistoryItem["watermarkStatus"] : undefined),
  };
  return withUserLock(userId, async () => {
    await mkdir(userDirectory(userId), { recursive: true });
    const created: HistoryItem[] = [];
    const returned: HistoryItem[] = [];
    const seenRequestImages = new Map<string, HistoryItem>();
    if (effectiveOptions.requestId) {
      const previous = (await readIndex(userId)).filter((item) => item.requestId === effectiveOptions.requestId);
      for (const item of previous) {
        const hash = await historyImageHash(userId, item);
        if (hash && !seenRequestImages.has(hash)) seenRequestImages.set(hash, item);
      }
    }
    for (const [imageIndex, image] of images.entries()) {
      const match = image.match(
        /^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/,
      );
      if (!match) continue;
      const sourceBytes = Buffer.from(match[2], "base64");
      const imageSha256 = createHash("sha256").update(sourceBytes).digest("hex");
      const known = effectiveOptions.requestId ? seenRequestImages.get(imageSha256) : undefined;
      if (known) {
        returned.push(known);
        continue;
      }
      const id = effectiveOptions.imageIds?.[imageIndex] || randomUUID();
      const timestamp = new Date().toISOString();
      const parameters = safeParameters(body);
      const fingerprint = effectiveOptions.requestFingerprint || generateFingerprint(userId, timestamp, parameters);
      let watermarkStatus: HistoryItem["watermarkStatus"] = effectiveOptions.watermarkStatus || "skipped";
      let processedImage = image;
      if (!effectiveOptions.skipWatermark) {
        try {
          processedImage = await embedWatermark(image, id, userId, parameters.model || "unknown", {
            imageId: id,
            requestId: effectiveOptions.requestId || id,
            requestFingerprint: effectiveOptions.requestFingerprint || fingerprint,
            parameters,
          });
          watermarkStatus = processedImage === image ? "disabled" : "embedded";
        } catch {
          watermarkStatus = "failed";
        }
      }

      const outputFormat = processedImage.match(/^data:image\/(png|jpeg|webp);/)?.[1] || match[1];
      const fileName = `${id}.${outputFormat === "jpeg" ? "jpg" : outputFormat}`;
      const imageMatch = processedImage.match(/^data:image\/[^;]+;base64,([\s\S]+)$/);
      if (imageMatch) {
        const buffer = Buffer.from(imageMatch[1], "base64");
        await writeFile(path.join(userDirectory(userId), fileName), buffer);
      }

      created.push({
        id,
        createdAt: timestamp,
        imagePath: fileName,
        saved: false,
        parameters,
        usage,
        fingerprint,
        requestId: effectiveOptions.requestId,
        requestFingerprint: effectiveOptions.requestFingerprint || fingerprint,
        imageSha256,
        watermarkStatus,
      });
      const item = created[created.length - 1];
      returned.push(item);
      if (effectiveOptions.requestId) seenRequestImages.set(imageSha256, item);
    }
    const merged = [...created, ...(await readIndex(userId))];
    let unsavedSeen = 0;
    const retained: HistoryItem[] = [];
    const toRemote: HistoryItem[] = [];
    const expired: HistoryItem[] = [];
    for (const item of merged) {
      if (item.saved) {
        retained.push(item);
        continue;
      }
      unsavedSeen += 1;
      if (unsavedSeen <= LOCAL_HISTORY_LIMIT && !item.remote) {
        retained.push(item);
      } else if (
        unsavedSeen <= LOCAL_HISTORY_LIMIT + REMOTE_HISTORY_LIMIT &&
        !item.remote
      ) {
        // 本地层留不下但仍在远程层配额内：文件转存远程，索引保留。
        const localFile = path.join(userDirectory(userId), item.imagePath);
        const data = await readFile(localFile).catch(() => null);
        const uploadOk = data
          ? await putRemoteHistoryImage(userId, item.imagePath, data)
          : false;
        if (uploadOk) {
          await unlink(localFile).catch(() => undefined);
          toRemote.push({ ...item, remote: true });
        } else {
          // 远程不可用时退回旧行为：直接过期删除，不阻塞生成流程。
          expired.push(item);
        }
      } else if (unsavedSeen <= LOCAL_HISTORY_LIMIT + REMOTE_HISTORY_LIMIT) {
        // 已在远程层的条目直接沿用（文件早已在远程）。
        toRemote.push(item);
      } else {
        expired.push(item);
      }
    }
    // 已在远程层、但被新一轮挤出总量配额的旧条目：删远程文件。
    const remoteRetained = new Set(toRemote.map((item) => item.imagePath));
    for (const item of expired) {
      if (item.remote && !remoteRetained.has(item.imagePath)) {
        await deleteRemoteHistoryImage(userId, item.imagePath);
        continue;
      }
      await unlink(path.join(userDirectory(userId), item.imagePath)).catch(
        () => undefined,
      );
    }
    // 本地索引：保留 + 新转远程的条目，顺序保持最新在前。
    const remoteIndex = toRemote.map((item) => item);
    await writeIndex(userId, [...retained, ...remoteIndex]);
    return returned;
  });
}

export async function listHistory(userId: number) {
  return withUserLock(userId, () => repairHistory(userId));
}

export async function findHistory(userId: number, id: string) {
  return (await readIndex(userId)).find((item) => item.id === id) || null;
}

export async function findHistoryByRequestId(userId: number, requestId: string) {
  return (await readIndex(userId)).find((item) => item.requestId === requestId) || null;
}

/** Match exact unsigned response bytes to this user's authenticated server original. */
export async function findWatermarkedHistorySource(userId: number, sourceSha256: string): Promise<Buffer | null> {
  const item = (await readIndex(userId)).find((entry) =>
    entry.watermarkStatus === "embedded" && entry.imageSha256 === sourceSha256);
  if (!item) return null;
  try {
    const data = item.remote
      ? (await getRemoteHistoryImage(userId, item.imagePath))?.data
      : await readFile(historyImagePath(userId, item.imagePath));
    if (!data) return null;
    const proof = await verifyWatermark(`data:image/png;base64,${data.toString("base64")}`);
    // The index alone is insufficient: authenticate the stored image and its
    // binding to the supplied bytes before using its provenance.
    return proof.valid && proof.shaMatch && proof.payload?.sha256 === sourceSha256 && proof.payload.userId === userId
      ? data : null;
  } catch { return null; }
}

export async function deleteHistory(userId: number, id: string) {
  return withUserLock(userId, async () => {
    const items = await readIndex(userId);
    const item = items.find((entry) => entry.id === id);
    if (!item) return false;
    const remaining = items.filter((entry) => entry.id !== id);
    if (!remaining.some((entry) => entry.imagePath === item.imagePath)) {
      if (item.remote)
        await deleteRemoteHistoryImage(userId, item.imagePath);
      else
        await unlink(
          path.join(userDirectory(userId), item.imagePath),
        ).catch(() => undefined);
    }
    await writeIndex(userId, remaining);
    return true;
  });
}

export async function deleteHistories(userId: number, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (!uniqueIds.length) return 0;
  return withUserLock(userId, async () => {
    const items = await readIndex(userId);
    const selected = items.filter((entry) => uniqueIds.includes(entry.id));
    if (!selected.length) return 0;
    const selectedIds = new Set(selected.map((entry) => entry.id));
    const remaining = items.filter((entry) => !selectedIds.has(entry.id));
    const retainedPaths = new Set(remaining.map((entry) => `${entry.remote ? "remote" : "local"}:${entry.imagePath}`));
    const removedPaths = new Set<string>();
    for (const item of selected) {
      const key = `${item.remote ? "remote" : "local"}:${item.imagePath}`;
      if (retainedPaths.has(key) || removedPaths.has(key)) continue;
      removedPaths.add(key);
      if (item.remote) await deleteRemoteHistoryImage(userId, item.imagePath);
      else await unlink(path.join(userDirectory(userId), item.imagePath)).catch(() => undefined);
    }
    await writeIndex(userId, remaining);
    return selected.length;
  });
}

export function historyImagePath(userId: number, fileName: string) {
  return path.join(userDirectory(userId), path.basename(fileName));
}
