"use client";

import { imageGenerationIntentUrl, parseImageGenerationIntent, type ImageGenerationIntent } from "@/lib/image-generation-intent";

const prefix = "lfn-generation-intent-v1:";
const ttl = 60 * 60_000;
const maxEntries = 20;

/** Keep long/private scene text out of URLs and within the current browser tab. */
export function createImageGenerationIntentUrl(value: ImageGenerationIntent): string {
  const intent = parseImageGenerationIntent(value);
  const fallback = imageGenerationIntentUrl(intent);
  try {
    const entries: Array<{ key: string; createdAt: number }> = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try { entries.push({ key, createdAt: Number(JSON.parse(sessionStorage.getItem(key) || "null")?.createdAt) || 0 }); }
      catch { entries.push({ key, createdAt: 0 }); }
    }
    entries.sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of entries.filter((entry) => Date.now() - entry.createdAt > ttl)) sessionStorage.removeItem(entry.key);
    const live = entries.filter((entry) => Date.now() - entry.createdAt <= ttl);
    while (live.length >= maxEntries) sessionStorage.removeItem(live.shift()!.key);
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = JSON.stringify({ createdAt: Date.now(), intent });
    if (payload.length > 256_000) throw new Error("生成任务快照过大");
    for (;;) {
      try { sessionStorage.setItem(prefix + id, payload); break; }
      catch (error) { const oldest = live.shift(); if (!oldest) throw error; sessionStorage.removeItem(oldest.key); }
    }
    return `/image?reuse=1&intent=${encodeURIComponent(id)}`;
  } catch {
    if (fallback.length <= 7000) return fallback;
    throw new Error("当前浏览器无法暂存长场景，请启用浏览器存储或复制提示词到图片工作台。");
  }
}

export function imageGenerationIntentParams(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  const id = params.get("intent");
  if (params.get("reuse") !== "1" || !id) return params;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error("生成任务快照 ID 无效");
  let raw: string | null;
  try { raw = sessionStorage.getItem(prefix + id); } catch { throw new Error("无法读取本机生成任务快照"); }
  if (!raw) throw new Error("生成任务快照已过期，请从故事或分镜项目重新打开工作台。");
  const saved = JSON.parse(raw) as { createdAt?: number; intent?: unknown };
  if (typeof saved.createdAt !== "number" || !Number.isFinite(saved.createdAt) || Date.now() - saved.createdAt > ttl) throw new Error("生成任务快照已过期，请重新打开工作台。");
  // Reading is repeatable: React Strict Mode may cancel the first hydration effect.
  return new URLSearchParams(imageGenerationIntentUrl(parseImageGenerationIntent(saved.intent)).split("?")[1]);
}
