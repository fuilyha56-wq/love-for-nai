"use client";

import { resolveAssistantReasoning } from "@/lib/assistant-reasoning";

const key = "lfn-assistant-reasoning-v1";
const fallback: Record<string, string> = {};

export function assistantReasoningPreferences(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    const entries = saved && typeof saved === "object" && !Array.isArray(saved) ? Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string") : [];
    return { ...Object.fromEntries(entries), ...fallback };
  } catch { return { ...fallback }; }
}

export function storedAssistantReasoning(model: string) {
  try { return resolveAssistantReasoning(model, assistantReasoningPreferences()[model]); }
  catch { return resolveAssistantReasoning(model); }
}

export function saveAssistantReasoning(model: string, effort: string) {
  const next = { ...assistantReasoningPreferences(), [model]: effort };
  try { localStorage.setItem(key, JSON.stringify(next)); delete fallback[model]; }
  catch { fallback[model] = effort; }
  window.dispatchEvent(new CustomEvent("lfn-assistant-reasoning", { detail: { model, effort } }));
  return next;
}
