import { imageHistoryContent, sameImageHistoryContent } from "@/lib/image-history-content";
import { cacheImageBlob } from "@/lib/browser-image-cache";

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

const DB_NAME = "lfn-local-image-history-v1";
const STORE = "images";
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
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地图片历史"));
  });
}

export async function saveLocalImageHistory(item: LocalImageHistoryItem) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(item);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("无法保存本地图片历史"));
      transaction.onabort = () => reject(transaction.error || new Error("无法保存本地图片历史"));
    });
  } finally { db.close(); }
  if (item.remoteId) await cacheImageBlob(`/api/history/${encodeURIComponent(item.remoteId)}/image`, item.image).catch(() => undefined);
}

export async function deleteLocalImageHistory(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("无法删除本地图片历史"));
  });
  db.close();
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
  const item = await new Promise<LocalImageHistoryItem | null>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      const items = request.result as LocalImageHistoryItem[];
      resolve(items.find((entry) => entry.remoteId === remoteId || entry.id === remoteId) || null);
    };
    request.onerror = () => reject(request.error || new Error("无法查找本地图片历史"));
  });
  db.close();
  return item;
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
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const [id, remoteId] of links) {
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as LocalImageHistoryItem | undefined;
        if (current && !current.remoteId) store.put({ ...current, remoteId });
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("无法关联图片历史记录"));
    transaction.onabort = () => reject(transaction.error || new Error("无法关联图片历史记录"));
  }); } finally { db.close(); }
}
