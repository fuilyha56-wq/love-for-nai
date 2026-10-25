/** Persistent image bytes are separate from history rows: caching never creates a gallery entry. */
const DB_NAME = "lfn-browser-image-cache-v1";
const STORE = "images";
type CachedImage = { key: string; scope: string; url: string; blob: Blob };
const pending = new Map<string, Promise<Blob>>();
const revisions = new Map<string, number>();
let pendingScope: Promise<string> | undefined;
const familyKey = (scope: string, url: string) => `${scope}\n${new URL(url, "http://localhost").pathname}`;

function cacheUrl(source: string): string | null {
  if (!source.startsWith("/api/") && !source.startsWith("http")) return null;
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(source, origin);
  if (url.origin !== origin || !/^\/api\/(?:history|gallery|admin\/gallery)\/[^/]+\/image$/.test(url.pathname)) return null;
  url.searchParams.sort();
  return url.pathname + url.search;
}

export function isCacheableImage(source: string): boolean { return cacheUrl(source) !== null; }

// Share concurrent checks only. A later lookup checks the current account again,
// including after login/logout or an account change in another browser tab.
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

async function fetchImage(source: string): Promise<Blob> {
  const response = await fetch(source);
  if (!response.ok) throw new Error("图片读取失败，请稍后重试");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("返回的不是图片文件");
  return blob;
}

async function thumbnailFrom(original: Blob): Promise<Blob> {
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
export async function cacheImageBlob(source: string, blob: Blob): Promise<void> {
  const url = cacheUrl(source);
  if (!url) return;
  const scope = await imageScope();
  const family = familyKey(scope, url);
  const revision = revisions.get(family);
  if (!await read(scope, url).catch(() => null) && revisions.get(family) === revision) await write(scope, url, blob);
}

/** Original and thumbnail URLs have independent entries; list views never request a missing original. */
export async function fetchCachedImageBlob(source: string): Promise<Blob> {
  const url = cacheUrl(source);
  if (!url) return fetchImage(source);
  // Storage/scope failures must still allow displaying an image from the authenticated API.
  const scope = await imageScope().catch(() => null);
  if (!scope) return fetchImage(source);
  const key = `${scope}\n${url}`;
  const family = familyKey(scope, url);
  const revision = revisions.get(family);
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const cached = await read(scope, url).catch(() => null);
    if (cached) return cached;
    const parsed = new URL(url, "http://localhost");
    let blob: Blob | null = null;
    if (parsed.searchParams.get("variant") === "thumbnail") {
      parsed.searchParams.delete("variant");
      const original = await read(scope, parsed.pathname + parsed.search).catch(() => null);
      if (original) blob = await thumbnailFrom(original).catch(() => null);
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
export async function deleteCachedImage(source: string): Promise<void> {
  const url = cacheUrl(source);
  if (!url) return;
  const scope = await imageScope();
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
