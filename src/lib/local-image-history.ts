import { imageHistoryContent, sameImageHistoryContent } from "@/lib/image-history-content";
import { cacheImageBlob, createImageThumbnail } from "@/lib/browser-image-cache";

export type LocalImageHistoryItem = {
  id: string;
  ownerId?: number;
  remoteId?: string;
  requestId?: string;
  createdAt: number;
  image: Blob;
  prompt?: string;
  negative?: string;
  model?: string;
  operation?: string;
  parameters?: Record<string, unknown>;
};

/** List rows never carry the full-resolution Blob. */
export type LocalImageHistorySummary = Omit<LocalImageHistoryItem, "image"> & {
  imageType: string;
  imageSize: number;
};

function historySummary({ image, ...item }: LocalImageHistoryItem): LocalImageHistorySummary {
  return { ...item, imageType: image.type, imageSize: image.size };
}

const DB_NAME = "lfn-local-image-history-v1";
const STORE = "images";
const SUMMARIES = "summaries";
const THUMBNAILS = "thumbnails";
const MODE_KEY = "lfn-image-history-mode-v1";
export type ImageHistoryMode = "account" | "local" | "none";

export function readImageHistoryMode(): ImageHistoryMode {
  if (typeof window === "undefined") return "account";
  try {
    const value = window.localStorage.getItem(MODE_KEY);
    return value === "local" || value === "none" ? value : "account";
  } catch { return "account"; }
}

export function writeImageHistoryMode(mode: ImageHistoryMode) {
  window.localStorage.setItem(MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent("lfn-image-history-mode", { detail: mode }));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      const images = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: "id" });
      if (!images.indexNames.contains("remoteId")) images.createIndex("remoteId", "remoteId");
      if (!db.objectStoreNames.contains(THUMBNAILS)) db.createObjectStore(THUMBNAILS, { keyPath: "id" });
      if (db.objectStoreNames.contains(SUMMARIES)) return;
      const summaries = db.createObjectStore(SUMMARIES, { keyPath: "id" });
      // Project legacy rows one at a time; do not materialize all original Blobs.
      // Their thumbnails are generated lazily when a visible list row needs one.
      const cursor = images.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        summaries.put(historySummary(cursor.result.value as LocalImageHistoryItem));
        cursor.result.continue();
      };
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("无法打开本地图片历史"));
  });
}

export async function saveLocalImageHistory(item: LocalImageHistoryItem) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE, SUMMARIES, THUMBNAILS], "readwrite");
      transaction.objectStore(STORE).put(item);
      transaction.objectStore(SUMMARIES).put(historySummary(item));
      // Persist the original first. Preview decoding/quota must never lose it.
      transaction.objectStore(THUMBNAILS).delete(item.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("无法保存本地图片历史"));
      transaction.onabort = () => reject(transaction.error || new Error("无法保存本地图片历史"));
    });
  } finally { db.close(); }
  const thumbnail = await createImageThumbnail(item.image).catch(() => null);
  if (thumbnail) await persistHistoryThumbnail(item, thumbnail);
  // The original belongs to the owner captured at generation time, not whoever
  // may have signed in while the asynchronous preview was being decoded.
  if (item.remoteId && Number.isSafeInteger(item.ownerId) && item.ownerId! > 0) await cacheImageBlob(`/api/history/${encodeURIComponent(item.remoteId)}/image`, item.image, `user:${item.ownerId}`).catch(() => undefined);
}

async function persistHistoryThumbnail(original: LocalImageHistoryItem, thumbnail: Blob) {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction([STORE, THUMBNAILS], "readwrite");
      const read = transaction.objectStore(STORE).get(original.id);
      read.onsuccess = () => {
        // Do not recreate a deleted row's thumbnail after asynchronous decoding.
        const current = read.result as LocalImageHistoryItem | undefined;
        try {
          if (current && current.createdAt === original.createdAt && current.image.size === original.image.size) transaction.objectStore(THUMBNAILS).put({ id: original.id, image: thumbnail });
        } catch (error) { reject(error); transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* A preview is usable even when persistent cache storage is full. */ }
  finally { db?.close(); }
}

export async function deleteLocalImageHistory(id: string) {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, SUMMARIES, THUMBNAILS], "readwrite");
    for (const store of [STORE, SUMMARIES, THUMBNAILS]) transaction.objectStore(store).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("无法删除本地图片历史"));
    transaction.onabort = () => reject(transaction.error || new Error("无法删除本地图片历史"));
  }); } finally { db.close(); }
}

export async function listLocalImageHistorySummaries(limit = Number.POSITIVE_INFINITY): Promise<LocalImageHistorySummary[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(SUMMARIES, "readonly").objectStore(SUMMARIES).getAll();
      request.onsuccess = () => resolve((request.result as LocalImageHistorySummary[]).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit));
      request.onerror = () => reject(request.error || new Error("无法读取本地图片历史"));
    });
  } finally { db.close(); }
}

export async function listLocalImageHistory(limit = 40): Promise<LocalImageHistoryItem[]> {
  const db = await openDb();
  const items = await new Promise<LocalImageHistoryItem[]>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as LocalImageHistoryItem[]).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit));
    request.onerror = () => reject(request.error || new Error("无法读取本地图片历史"));
  });
  db.close();
  return items;
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

export async function findLocalImageHistory(remoteId: string): Promise<LocalImageHistoryItem | null> {
  const db = await openDb();
  try { return await new Promise<LocalImageHistoryItem | null>((resolve, reject) => {
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const request = store.get(remoteId);
    request.onsuccess = () => {
      if (request.result) { resolve(request.result); return; }
      const remote = store.index("remoteId").get(remoteId);
      remote.onsuccess = () => resolve(remote.result || null);
      remote.onerror = () => reject(remote.error || new Error("无法查找本地图片历史"));
    };
    request.onerror = () => reject(request.error || new Error("无法查找本地图片历史"));
  }); } finally { db.close(); }
}

const thumbnailReads = new Map<string, Promise<Blob | null>>();

/** Decode at most one selected legacy original per image, then persist its preview. */
export function getLocalImageHistoryThumbnail(id: string): Promise<Blob | null> {
  const pending = thumbnailReads.get(id);
  if (pending) return pending;
  const request = (async () => {
    const db = await openDb();
    let cached: Blob | null;
    try { cached = await new Promise((resolve, reject) => {
      const read = db.transaction(THUMBNAILS, "readonly").objectStore(THUMBNAILS).get(id);
      read.onsuccess = () => resolve(read.result?.image || null);
      read.onerror = () => reject(read.error);
    }); } finally { db.close(); }
    if (cached) return cached;
    const original = await findLocalImageHistory(id);
    if (!original) return null;
    const thumbnail = await createImageThumbnail(original.image).catch(() => null);
    if (!thumbnail) return null;
    await persistHistoryThumbnail(original, thumbnail);
    return thumbnail;
  })().finally(() => thumbnailReads.delete(id));
  thumbnailReads.set(id, request);
  return request;
}

/** Repair legacy copies by comparing bytes, including on the HTTP deployment. */
export async function linkLocalImageHistoryToRemote(
  remoteItems: Array<{ id: string; requestId?: string; createdAt: string; imageUrl?: string; parameters?: Record<string, unknown> }>,
) {
  if (!remoteItems.length) return;
  const localItems = (await listLocalImageHistory(Number.POSITIVE_INFINITY)).filter((item) => !item.remoteId);
  const remoteContents = new Map<string, Promise<Uint8Array | null>>();
  const localContents = new Map<string, Promise<Uint8Array>>();
  const links = new Map<string, string>();
  const readRemote = (remote: typeof remoteItems[number]) => {
    let pending = remoteContents.get(remote.id);
    if (!pending) {
      // Already-cached server copies avoid downloading the same image again.
      pending = findLocalImageHistory(remote.id).then(async (cached) => {
        if (cached) return imageHistoryContent(new Uint8Array(await cached.image.arrayBuffer()));
        const response = await fetch(remote.imageUrl || `/api/history/${encodeURIComponent(remote.id)}/image`, { cache: "no-store" });
        if (!response.ok) return null;
        return imageHistoryContent(new Uint8Array(await response.arrayBuffer()));
      }).catch(() => null);
      remoteContents.set(remote.id, pending);
    }
    return pending;
  };
  // Limit concurrent image reads; no network or Blob awaits run inside an IDB transaction.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, localItems.length) }, async () => {
    while (cursor < localItems.length) {
      const local = localItems[cursor++];
      if (remoteItems.some((remote) => remote.id === local.id)) {
        links.set(local.id, local.id);
        continue;
      }
      const candidates = remoteItems.filter((remote) => {
        if (local.requestId) return remote.requestId === local.requestId;
        // Very old copies lack a request ID. Require both matching content and a
        // nearby save time; leave ambiguous or unrelated local-only images alone.
        return Math.abs(Date.parse(remote.createdAt) - local.createdAt) <= 30_000 &&
          (!local.model || remote.parameters?.model === local.model);
      });
      if (!candidates.length) continue;
      let content = localContents.get(local.id);
      if (!content) {
        content = local.image.arrayBuffer().then((bytes) => imageHistoryContent(new Uint8Array(bytes)));
        localContents.set(local.id, content);
      }
      const bytes = await content;
      const matches: string[] = [];
      let incomplete = false;
      for (const remote of candidates) {
        const remoteBytes = await readRemote(remote);
        if (!remoteBytes) incomplete = true;
        else if (sameImageHistoryContent(bytes, remoteBytes)) matches.push(remote.id);
      }
      if (!incomplete && matches.length === 1) links.set(local.id, matches[0]);
    }
  }));
  if (!links.size) return;
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, SUMMARIES], "readwrite");
    const store = transaction.objectStore(STORE);
    for (const [id, remoteId] of links) {
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as LocalImageHistoryItem | undefined;
        if (current && !current.remoteId) {
          const linked = { ...current, remoteId };
          store.put(linked);
          transaction.objectStore(SUMMARIES).put(historySummary(linked));
        }
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("无法关联图片历史记录"));
    transaction.onabort = () => reject(transaction.error || new Error("无法关联图片历史记录"));
  }); } finally { db.close(); }
}
