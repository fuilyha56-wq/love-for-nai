"use client";

import { type EncodedImageReference, type ImageReferenceAsset } from "./image-references";

type StoredAsset = ImageReferenceAsset & { owner: string };
type StoredEncoding = EncodedImageReference & { owner: string };
const DATABASE = "lfn-image-reference-library-v1";
const MAX_ASSETS = 64;
const LIBRARY_CHANGED = "lfn-reference-library-changed";
export function subscribeReferenceLibrary(owner: string, refresh: () => void) {
  const listener = (event: Event) => { if ((event as CustomEvent<string>).detail === owner) refresh(); };
  window.addEventListener(LIBRARY_CHANGED, listener);
  return () => window.removeEventListener(LIBRARY_CHANGED, listener);
}
function notifyLibrary(owner: string) { window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED, { detail: owner })); }
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("assets", { keyPath: ["owner", "id"] });
      request.result.createObjectStore("encodings", { keyPath: ["owner", "key"] });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error("浏览器未能打开参考图库。")); };
    request.onblocked = () => { database = undefined; reject(new Error("请关闭其他旧版页面后重试。")); };
  }).catch(() => { database = undefined; throw new Error("浏览器未能打开参考图库。"); });
  return database;
}
async function transact<T>(storeName: "assets" | "encodings", mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(new Error("参考图库存储失败；请检查浏览器存储空间。"));
    tx.onerror = () => reject(new Error("参考图库存储失败；请检查浏览器存储空间。"));
  });
}
export async function listReferenceAssets(owner: string) {
  const assets = await transact<StoredAsset[]>("assets", "readonly", (store) => store.getAll(IDBKeyRange.bound([owner, ""], [owner, "\uffff"])));
  return assets.sort((a, b) => b.createdAt - a.createdAt).map((asset) => ({ id: asset.id, name: asset.name, data: asset.data, createdAt: asset.createdAt }));
}
export async function readReferenceAsset(owner: string, id: string): Promise<ImageReferenceAsset | undefined> {
  const asset = await transact<StoredAsset | undefined>("assets", "readonly", store => store.get([owner, id]));
  return asset?.owner === owner ? { id: asset.id, name: asset.name, data: asset.data, createdAt: asset.createdAt } : undefined;
}
export async function saveReferenceAsset(owner: string, asset: ImageReferenceAsset) {
  const db = await openDatabase();
  return new Promise<ImageReferenceAsset>((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite"), store = tx.objectStore("assets");
    const request = store.getAll(IDBKeyRange.bound([owner, ""], [owner, "\uffff"]));
    let saved = asset, error = "参考图库存储失败；请检查浏览器存储空间。";
    request.onsuccess = () => {
      const assets = request.result as StoredAsset[], duplicate = assets.find((item) => item.data === asset.data);
      if (duplicate) { saved = { id: duplicate.id, name: duplicate.name, data: duplicate.data, createdAt: duplicate.createdAt }; return; }
      if (assets.length >= MAX_ASSETS) { error = `参考图库最多保存 ${MAX_ASSETS} 张，请先删除不再使用的图片。`; tx.abort(); return; }
      store.put({ ...asset, owner });
    };
    tx.oncomplete = () => { notifyLibrary(owner); resolve(saved); };
    tx.onabort = tx.onerror = () => reject(new Error(error));
  });
}
export async function removeReferenceAsset(owner: string, id: string) { await transact("assets", "readwrite", (store) => store.delete([owner, id])); notifyLibrary(owner); }
export async function readReferenceEncoding(owner: string, key: string): Promise<EncodedImageReference | undefined> {
  const value = await transact<StoredEncoding | undefined>("encodings", "readonly", (store) => store.get([owner, key]));
  return value?.owner === owner ? value : undefined;
}
export async function saveReferenceEncoding(owner: string, encoding: EncodedImageReference) { await transact("encodings", "readwrite", (store) => store.put({ ...encoding, owner })); }
export async function clearReferenceEncodings(owner: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("encodings", "readwrite"); tx.objectStore("encodings").delete(IDBKeyRange.bound([owner, ""], [owner, "\uffff"])); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error("清除风格缓存失败。")); });
}
