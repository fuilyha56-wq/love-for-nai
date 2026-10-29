"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildImageReferenceParameters, createImageReference, MAX_STUDIO_REFERENCES, referenceEncodingKey, type EncodedImageReference, type ImageReferenceAsset, type ImageReferenceKind, type ImageReferenceSelection } from "@/lib/image-references";
import { subscribeReferenceLibrary, clearReferenceEncodings, listReferenceAssets, readReferenceEncoding, removeReferenceAsset, saveReferenceAsset, saveReferenceEncoding } from "@/lib/client-reference-library";

type Baskets = Record<ImageReferenceKind, ImageReferenceSelection[]>;
const empty = (): Baskets => ({ "vibe-transfer": [], "precise-reference": [] });
export function useImageReferences(owner: string, model: string, onNotice: (message: string) => void) {
  const [baskets, setBaskets] = useState<Baskets>(empty);
  const [library, setLibrary] = useState<ImageReferenceAsset[]>([]);
  const [encodings, setEncodings] = useState<Record<string, EncodedImageReference>>({});
  const [encodingId, setEncodingId] = useState<string | null>(null);
  const [basketOwner, setBasketOwner] = useState(owner);
  const current = useRef({ owner, model, baskets });
  useLayoutEffect(() => { current.current = { owner, model, baskets: basketOwner === owner ? baskets : empty() }; }, [owner, model, baskets, basketOwner]);
  const controller = useRef<AbortController | null>(null);
  const memoryEncodings = useRef(new Map<string, EncodedImageReference>());
  const cacheEpoch = useRef(0);
  const refreshLibrary = useCallback(async () => {
    try { const items = await listReferenceAssets(owner); if (current.current.owner === owner) setLibrary(items); }
    catch (error) { onNotice(error instanceof Error ? error.message : "无法读取参考图库。"); }
  }, [owner, onNotice]);
  useEffect(() => subscribeReferenceLibrary(owner, () => { void refreshLibrary(); }), [owner, refreshLibrary]);
  useEffect(() => {
    const cacheEpochRef = cacheEpoch;
    let alive = true;
    void Promise.resolve().then(() => { if (!alive) return; setBaskets(empty()); setBasketOwner(owner); setLibrary([]); setEncodings({}); setEncodingId(null); return refreshLibrary(); });
    return () => { alive = false; cacheEpochRef.current++; controller.current?.abort(); };
  }, [owner, refreshLibrary]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(async () => {
      if (!alive) return;
      setEncodings({});
      await Promise.all(baskets["vibe-transfer"].map(async (item) => {
      const key = await referenceEncodingKey(item, model, item.information);
      const cache = memoryEncodings.current.get(`${owner}:${key}`) ?? await readReferenceEncoding(owner, key).catch(() => undefined);
      if (alive && cache) setEncodings((previous) => ({ ...previous, [item.id]: cache }));
      }));
    }).catch(() => { /* Storage failure does not prevent uncached generation. */ });
    return () => { alive = false; };
  }, [owner, model, baskets]);
  const add = useCallback((kind: ImageReferenceKind, asset: ImageReferenceAsset) => {
    const prior = current.current.baskets[kind];
    if (prior.length >= MAX_STUDIO_REFERENCES) { onNotice(`最多同时使用 ${MAX_STUDIO_REFERENCES} 张参考图。`); return false; }
    if (prior.some((item) => item.data === asset.data)) { onNotice("这张图片已经在当前参考列表中。"); return false; }
    setBaskets((value) => value[kind].length >= MAX_STUDIO_REFERENCES || value[kind].some((item) => item.data === asset.data) ? value : ({ ...value, [kind]: [...value[kind], createImageReference(asset)] }));
    return true;
  }, [onNotice]);
  const update = useCallback((kind: ImageReferenceKind, id: string, change: Partial<Pick<ImageReferenceSelection, "enabled" | "strength" | "information" | "fidelity" | "referenceType">>) => {
    setBaskets((value) => ({ ...value, [kind]: value[kind].map((item) => item.id === id ? { ...item, ...change } : item) }));
  }, []);
  const remove = useCallback((kind: ImageReferenceKind, id: string) => setBaskets((value) => ({ ...value, [kind]: value[kind].filter((item) => item.id !== id) })), []);
  const replace = useCallback((kind: ImageReferenceKind, references: ImageReferenceSelection[]) => setBaskets((value) => ({ ...value, [kind]: references.slice(0, MAX_STUDIO_REFERENCES) })), []);
  const save = useCallback(async (asset: ImageReferenceAsset) => {
    try { await saveReferenceAsset(owner, asset); await refreshLibrary(); onNotice("已保存到此账号的本机参考图库。"); }
    catch (error) { onNotice(error instanceof Error ? error.message : "保存失败。"); }
  }, [owner, refreshLibrary, onNotice]);
  const removeSaved = useCallback(async (id: string) => { try { await removeReferenceAsset(owner, id); await refreshLibrary(); } catch (error) { onNotice(error instanceof Error ? error.message : "删除失败。"); } }, [owner, refreshLibrary, onNotice]);
  const encodeForRequest = useCallback(async (asset: ImageReferenceSelection, signal?: AbortSignal) => {
    if (controller.current) throw new Error("请等待当前参考图预处理完成。");
    const request = new AbortController(); controller.current = request; setEncodingId(asset.id);
    const epoch = cacheEpoch.current;
    const capturedOwner = owner, capturedModel = model;
    try {
      const key = await referenceEncodingKey(asset, model, asset.information);
      const response = await fetch("/api/images/references/encode", { method: "POST", signal: signal ? AbortSignal.any([request.signal, signal]) : request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, image: asset.data, information_extracted: asset.information }) });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message || body?.error || "风格预处理失败。"); }
      const bytes = new Uint8Array(await response.arrayBuffer());
      request.signal.throwIfAborted(); signal?.throwIfAborted();
      if (cacheEpoch.current !== epoch) throw new DOMException("风格缓存操作已取消", "AbortError");
      if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error("风格预处理结果大小异常。");
      let binary = ""; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      const value: EncodedImageReference = { key, data: btoa(binary), model: capturedModel, information: asset.information, createdAt: Date.now() };
      memoryEncodings.current.set(`${capturedOwner}:${key}`, value);
      let memoryBytes = Array.from(memoryEncodings.current.values()).reduce((sum, item) => sum + item.data.length, 0);
      for (const [oldKey, oldValue] of memoryEncodings.current) { if (memoryBytes <= 64 * 1024 * 1024 && memoryEncodings.current.size <= 32) break; memoryEncodings.current.delete(oldKey); memoryBytes -= oldValue.data.length; }
      let persistent = true;
      try { await saveReferenceEncoding(capturedOwner, value); } catch { persistent = false; }
      if (cacheEpoch.current !== epoch) throw new DOMException("风格缓存操作已取消", "AbortError");
      if (current.current.owner === capturedOwner && current.current.model === capturedModel && current.current.baskets["vibe-transfer"].some((item) => item.id === asset.id && item.data === asset.data && item.information === asset.information)) { setEncodings((previous) => ({ ...previous, [asset.id]: value })); onNotice(persistent ? "风格已缓存；相同模型与信息提取值将自动复用。" : "风格已预处理；浏览器存储不可用，本次仍可使用，关闭页面后不会保留。"); }
      return value;
    } finally { if (controller.current === request) { controller.current = null; setEncodingId(null); } }
  }, [owner, model, onNotice]);
  const encode = useCallback(async (asset: ImageReferenceSelection) => { try { await encodeForRequest(asset); } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) onNotice(error instanceof Error ? error.message : "风格预处理失败。"); } }, [encodeForRequest, onNotice]);
  const prepare = useCallback(async (kind: ImageReferenceKind, signal?: AbortSignal, selections?: readonly ImageReferenceSelection[]) => {
    const snapshot = (selections ?? current.current.baskets[kind]).filter((item) => item.enabled).map((item) => ({ ...item }));
    if (!snapshot.length) throw new Error("请先添加并启用参考图。");
    if (kind === "precise-reference") return buildImageReferenceParameters(kind, snapshot);
    const ready: Record<string, EncodedImageReference> = {};
    for (const item of snapshot) {
      signal?.throwIfAborted();
      if (current.current.owner !== owner) throw new Error("账号已切换，请重新提交。");
      const key = await referenceEncodingKey(item, model, item.information);
      const memory = encodings[item.id];
      ready[item.id] = (memory?.key === key ? memory : undefined) ?? memoryEncodings.current.get(`${owner}:${key}`) ?? await readReferenceEncoding(owner, key).catch(() => undefined) ?? await encodeForRequest(item, signal);
    }
    return buildImageReferenceParameters(kind, snapshot, ready, model);
  }, [owner, model, encodings, encodeForRequest]);
  const clearCache = useCallback(async () => { cacheEpoch.current++; controller.current?.abort(); for (const key of memoryEncodings.current.keys()) if (key.startsWith(`${owner}:`)) memoryEncodings.current.delete(key); setEncodings({}); try { await clearReferenceEncodings(owner); onNotice("已清除本机风格缓存。"); } catch (error) { onNotice(error instanceof Error ? error.message : "清除失败。"); } }, [owner, onNotice]);
  return { baskets: basketOwner === owner ? baskets : empty(), library: basketOwner === owner ? library : [], encodings: basketOwner === owner ? encodings : {}, encodingId: basketOwner === owner ? encodingId : null, add, update, remove, replace, save, removeSaved, encode, prepare, cancelEncoding: () => controller.current?.abort(), clearCache,
    parameters: (kind: ImageReferenceKind) => buildImageReferenceParameters(kind, basketOwner === owner ? baskets[kind] : [], basketOwner === owner ? encodings : {}, model) };
}
