"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
export const metadataRestoreFields = ["prompts", "model", "dimensions", "sampling", "seed", "characters"] as const;
export type MetadataRestorePreferences = Record<(typeof metadataRestoreFields)[number], boolean>;
const defaults: MetadataRestorePreferences = { prompts: true, model: true, dimensions: true, sampling: true, seed: true, characters: true };
const key = "lfn-metadata-restore-fields-v1", event = "lfn-metadata-restore-fields-change";
let memory = "";
function read() { try { return localStorage.getItem(key) || memory; } catch { return memory; } }
function subscribe(listener: () => void) { window.addEventListener("storage", listener); window.addEventListener(event, listener); return () => { window.removeEventListener("storage", listener); window.removeEventListener(event, listener); }; }
export function parseMetadataRestorePreferences(raw: string): MetadataRestorePreferences {
  try { const input = JSON.parse(raw); if (!input || typeof input !== "object" || Array.isArray(input)) return { ...defaults }; return Object.fromEntries(metadataRestoreFields.map((field) => [field, typeof input[field] === "boolean" ? input[field] : true])) as MetadataRestorePreferences; } catch { return { ...defaults }; }
}
export function useMetadataRestorePreferences() {
  const raw = useSyncExternalStore(subscribe, read, () => ""), preferences = useMemo(() => parseMetadataRestorePreferences(raw), [raw]);
  const update = useCallback((field: keyof MetadataRestorePreferences, enabled: boolean) => { memory = JSON.stringify({ ...parseMetadataRestorePreferences(read()), [field]: enabled }); try { localStorage.setItem(key, memory); } catch { /* In-memory settings remain usable. */ } window.dispatchEvent(new Event(event)); }, []);
  return { preferences, update };
}
