"use client";

const key = "lfn-assistant-wikipedia-v1";
let fallback: boolean | undefined;
export function wikipediaLookupEnabled(): boolean {
  try { const saved = localStorage.getItem(key); return saved === "false" ? false : saved === "true" ? true : fallback ?? true; }
  catch { return fallback ?? true; }
}
export function setWikipediaLookupEnabled(enabled: boolean) {
  try { localStorage.setItem(key, String(enabled)); fallback = undefined; } catch { fallback = enabled; }
  window.dispatchEvent(new Event("lfn-assistant-wikipedia"));
}
