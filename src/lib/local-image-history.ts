export type LocalImageHistoryItem = {
  id: string;
  remoteId?: string;
  requestId?: string;
  createdAt: number;
  image: Blob;
  prompt?: string;
  negative?: string;
  model?: string;
  operation?: string;
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
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("无法保存本地图片历史"));
  });
  db.close();
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

export async function findLocalImageHistory(remoteId: string, requestId?: string): Promise<LocalImageHistoryItem | null> {
  const db = await openDb();
  const item = await new Promise<LocalImageHistoryItem | null>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(
      (request.result as LocalImageHistoryItem[]).find((entry) =>
        entry.remoteId === remoteId || (requestId && entry.requestId === requestId),
      ) || null,
    );
    request.onerror = () => reject(request.error || new Error("无法查找本地图片历史"));
  });
  db.close();
  return item;
}
