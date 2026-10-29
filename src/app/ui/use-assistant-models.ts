"use client";

import { useCallback, useRef, useState } from "react";
import type { AssistantCatalogSource } from "@/lib/assistant-catalog";
import { assistantModelsForGroup, assistantSourceGroups, reconcileAssistantSelection } from "@/lib/assistant-selection";
import { isAssistantChatModel } from "@/lib/assistant-models";

type Selection = { providerId: string; model: string; group: string };
const storageKey = "lfn-assistant-source-v1";
const initial: Selection = { providerId: "newapi", model: "", group: "" };
const reconcile = reconcileAssistantSelection;
function remember(selection: Selection) {
  try { localStorage.setItem(storageKey, JSON.stringify(selection)); } catch { /* Private browsing may disable storage. */ }
}
export function useAssistantModels() {
  const [sources, setSources] = useState<AssistantCatalogSource[]>([]);
  const [selection, setSelection] = useState(initial);
  const loaded = useRef(false), loading = useRef<AbortSignal | null>(null);
  const choices = useRef(new Map<string, Selection>());
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const refresh = useCallback(async (signal: AbortSignal) => {
    if (loading.current && !loading.current.aborted) return;
    loading.current = signal; setPending(true);
    try {
      const response = await fetch("/api/assistant/models", { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "无法读取助手模型");
      if (signal.aborted) return;
      // Keep old-server compatibility during rolling upgrades.
      const next: AssistantCatalogSource[] = Array.isArray(result.sources) ? result.sources : [{ id: "newapi", name: "NewAPI", models: (result.models || []).filter(isAssistantChatModel).map((id: string) => ({ id, groups: [] })) }];
      setSources(next); setError(result.message || "");
      let restored: Selection | undefined;
      if (!loaded.current) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
          if (saved && typeof saved.providerId === "string" && typeof saved.model === "string" && typeof saved.group === "string") restored = saved;
          else restored = { ...initial, model: localStorage.getItem("lfn-agent-model") || "" };
        } catch { /* Use current selection. */ }
        loaded.current = true;
      }
      setSelection(current => reconcile(next, restored || current));
    } catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : "无法读取助手模型"); }
    finally { if (loading.current === signal) { loading.current = null; setPending(false); } }
  }, []);
  const source = sources.find(source => source.id === selection.providerId);
  function update(next: Selection) {
    choices.current.set(selection.providerId, selection);
    const value = reconcile(sources, next); setSelection(value); remember(value);
  }
  return {
    model: selection.model, providerId: selection.providerId, group: selection.group || undefined, refresh,
    control: {
      value: selection.model, pending, error: error || (!source && sources.length ? "原模型源已移除，请选择可用来源" : ""),
      options: assistantModelsForGroup(source, selection.group).map(model => ({ value: model.id, label: model.id, description: source?.id === "newapi" ? `NewAPI · 分组：${model.groups.join(" / ") || "上游未提供"}` : `自定义 · ${source?.name}` })),
      onChange: (model: string) => update({ ...selection, model }), onRefresh: () => void refresh(new AbortController().signal),
      providerId: selection.providerId, sourceName: source?.name || "来源已移除",
      sources: sources.map(source => ({ value: source.id, label: source.name })),
      onSourceChange: (providerId: string) => update(choices.current.get(providerId) || { providerId, model: "", group: "" }),
      group: selection.group, groups: [{ value: "", label: "自动（账号默认）" }, ...assistantSourceGroups(source).map(group => ({ value: group, label: group }))],
      onGroupChange: (group: string) => update({ ...selection, group }),
    },
  };
}
