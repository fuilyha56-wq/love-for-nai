"use client";

import { parseAssistantCreativeMemory, type AssistantCreativeMemory } from "@/lib/assistant-memory";

export const ASSISTANT_MEMORY_KEY = "lfn-assistant-creative-memory-v1";
export type CreativeMemoryState = { enabled: boolean; entries: AssistantCreativeMemory[] };

export function readCreativeMemoryState(): CreativeMemoryState {
  const raw = localStorage.getItem(ASSISTANT_MEMORY_KEY);
  if (!raw) return { enabled: false, entries: [] };
  const saved: unknown = JSON.parse(raw);
  if (!saved || typeof saved !== "object" || !("entries" in saved) || !("enabled" in saved) || typeof saved.enabled !== "boolean") throw new Error("本机创作记忆格式无效，请重新整理后保存。");
  return { enabled: saved.enabled, entries: parseAssistantCreativeMemory(saved.entries) };
}

export function saveCreativeMemoryState(state: CreativeMemoryState) {
  const next = { enabled: state.enabled, entries: parseAssistantCreativeMemory(state.entries) };
  localStorage.setItem(ASSISTANT_MEMORY_KEY, JSON.stringify({ version: 1, ...next }));
  window.dispatchEvent(new Event("lfn-creative-memory"));
  return next;
}

export function clearCreativeMemoryState() {
  localStorage.removeItem(ASSISTANT_MEMORY_KEY);
  window.dispatchEvent(new Event("lfn-creative-memory"));
}

/** Disabled or unavailable browser storage never adds hidden context to a request. */
export function requestCreativeMemory(): AssistantCreativeMemory[] | undefined {
  try {
    const state = readCreativeMemoryState();
    return state.enabled && state.entries.length ? state.entries : undefined;
  } catch { return undefined; }
}
