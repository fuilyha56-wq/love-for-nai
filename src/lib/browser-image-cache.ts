import { parseLocalHistoryImageSource } from "@/lib/local-history-image-source";

/** Persistent image bytes are separate from history rows: caching never creates a gallery entry. */
const DB_NAME = "lfn-browser-image-cache-v1";
const STORE = "images";
type CachedImage = { key: string; scope: string; url: string; blob: Blob };
const pending = new Map<string, Promise<Blob>>();
const revisions = new Map<string, number>();
let pendingScope: Promise<string> | undefined;
const familyKey = (scope: string, url: string) => `${scope}\n${new URL(url, "http://localhost").pathname}`;
const galleryImage = (url: string) => /^\/api\/(?:gallery|admin\/gallery)\/[^/]+\/image$/.test(new URL(url, "http://localhost").pathname);

function cacheUrl(source: string): string | null {
  if (!source.startsWith("/api/") && !source.startsWith("http")) return null;
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(source, origin);
  if (url.origin !== origin || !/^\/api\/(?:history|gallery|admin\/gallery)\/[^/]+\/image$/.test(url.pathname)) return null;
  url.searchParams.sort();
  return url.pathname + url.search;
}

export function isCacheableImage(source: string): boolean { return parseLocalHistoryImageSource(source) !== null || cacheUrl(source) !== null; }

// Callers that already have the authenticated page's owner don't need another
// request. Other callers share only concurrent scope checks.
async function imageScope(): Promise<string> {
  if (!pendingScope) {
    pendingScope = fetch("/api/images/cache-scope", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("无法确认图片缓存所属账号");
      const result = await response.json() as { scope?: unknown };
      if (typeof result.scope !== "string" || !result.scope) throw new Error("图片缓存账号无效");
      return result.scope;
    }).finally(() => { pendingScope = undefined; });
  }
  return pendingScope;
}

function ownerScope(ownerId?: number): string | undefined {
  if (ownerId === undefined || !Number.isSafeInteger(ownerId) || ownerId < 0) return undefined;
  return ownerId === 0 ? "guest" : `user:${ownerId}`;
}

function scopeOwner(scope: string): number | undefined {
  if (scope === "guest") return 0;
  const id = Number(scope.startsWith("user:") ? scope.slice(5) : NaN);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开图片缓存"));
  });
}

async function read(scope: string, url: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(`${scope}\n${url}`);
      request.onsuccess = () => resolve((request.result as CachedImage | undefined)?.blob || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function write(scope: string, url: string, blob: Blob) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ key: `${scope}\n${url}`, scope, url, blob } satisfies CachedImage);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function fetchImage(source: string, revalidate = false): Promise<Blob> {
  const response = await fetch(source, revalidate ? { cache: "no-store" } : undefined);
  if (!response.ok) throw new Error("图片读取失败，请稍后重试");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("返回的不是图片文件");
  return blob;
}

export async function createImageThumbnail(original: Blob): Promise<Blob> {
  const objectUrl = URL.createObjectURL(original);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取本地原图"));
      image.src = objectUrl;
    });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成本地缩略图");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法保存本地缩略图")), "image/webp", 0.8));
  } finally { URL.revokeObjectURL(objectUrl); }
}

/** Store a newly generated/local original without requesting its server copy. */
export async function cacheImageBlob(source: string, blob: Blob, expectedScope?: string): Promise<void> {
  const url = cacheUrl(source);
  if (!url || galleryImage(url)) return;
  const scope = expectedScope ?? await imageScope();
  const family = familyKey(scope, url);
  const revision = revisions.get(family);
  if (!await read(scope, url).catch(() => null) && revisions.get(family) === revision) await write(scope, url, blob);
}

async function readGeneratedImage(id: string, thumbnail: boolean, ownerId?: number) {
  const { findLocalImageHistory, getLocalImageHistoryThumbnail } = await import("@/lib/local-image-history");
  const original = await findLocalImageHistory(id, ownerId);
  if (!original) return null;
  if (original.archive) {
    if (thumbnail) return original.image;
    throw new Error("这张大图已分段保存，请使用下载原图");
  }
  return thumbnail ? getLocalImageHistoryThumbnail(original.id, ownerId) : original.image;
}

/** Original and thumbnail URLs have independent entries; list views never request a missing original. */
export async function fetchCachedImageBlob(source: string, ownerId?: number): Promise<Blob> {
  const local = parseLocalHistoryImageSource(source);
  if (local) {
    if (ownerId !== undefined && local.ownerId !== undefined && ownerId !== local.ownerId) throw new Error("本机图片不属于当前账号");
    const expectedOwner = ownerId ?? local.ownerId ?? scopeOwner(await imageScope());
    if (expectedOwner === undefined) throw new Error("无法确认本机图片所属账号");
    const blob = await readGeneratedImage(local.id, local.thumbnail, expectedOwner);
    if (!blob) throw new Error("本机历史图片不存在，请刷新重试");
    return blob;
  }
  const url = cacheUrl(source);
  if (!url) return fetchImage(source);
  // Gallery publication and approval can change without changing the image URL.
  // Ignore legacy persistent copies and recheck the server's current visibility.
  if (galleryImage(url)) return fetchImage(source, true);
  // Storage/scope failures must still allow displaying an image from the authenticated API.
  const scope = ownerScope(ownerId) ?? await imageScope().catch(() => null);
  if (!scope) return fetchImage(source);
  const key = `${scope}\n${url}`;
  const family = familyKey(scope, url);
  const revision = revisions.get(family);
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const parsed = new URL(url, "http://localhost");
    const historyId = parsed.pathname.match(/^\/api\/history\/([^/]+)\/image$/)?.[1];
    const knownOwner = scopeOwner(scope);
    if (historyId && knownOwner !== undefined) {
      const localId = decodeURIComponent(historyId);
      const original = await readGeneratedImage(localId, parsed.searchParams.get("variant") === "thumbnail", knownOwner).catch(() => null);
      if (original) return original;
    }
    const cached = await read(scope, url).catch(() => null);
    if (cached) return cached;
    let blob: Blob | null = null;
    if (parsed.searchParams.get("variant") === "thumbnail") {
      parsed.searchParams.delete("variant");
      const original = await read(scope, parsed.pathname + parsed.search).catch(() => null);
      if (original) blob = await createImageThumbnail(original).catch(() => null);
    }
    blob ||= await fetchImage(source);
    if (revisions.get(family) === revision) await write(scope, url, blob).catch(() => undefined);
    return blob;
  })();
  pending.set(key, operation);
  try { return await operation; }
  finally { if (pending.get(key) === operation) pending.delete(key); }
}

/** Remove both variants when the user explicitly deletes a history image. */
export async function deleteCachedImage(source: string, ownerId?: number): Promise<void> {
  const url = cacheUrl(source);
  if (!url) return;
  const scope = ownerScope(ownerId) ?? await imageScope();
  const pathname = new URL(url, "http://localhost").pathname;
  const family = familyKey(scope, url);
  revisions.set(family, (revisions.get(family) || 0) + 1);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const request = transaction.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as CachedImage;
        if (entry.scope === scope && new URL(entry.url, "http://localhost").pathname === pathname) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
