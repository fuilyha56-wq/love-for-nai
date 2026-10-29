import type { AssistantCatalogSource } from "@/lib/assistant-catalog";

export type AssistantSelection = { providerId: string; model: string; group: string };

export function assistantSourceGroups(source?: AssistantCatalogSource): string[] {
  return [...new Set(source?.models.flatMap((model) => model.groups) || [])];
}

export function assistantModelsForGroup(source: AssistantCatalogSource | undefined, group: string) {
  return (source?.models || []).filter((model) => !group || model.groups.includes(group));
}

export function reconcileAssistantSelection(sources: AssistantCatalogSource[], selection: AssistantSelection): AssistantSelection {
  // Removing a personal source must never silently switch billing to NewAPI.
  const source = sources.find((item) => item.id === selection.providerId);
  if (!source) return { ...selection, model: "", group: "" };
  const group = source.id === "newapi" && assistantSourceGroups(source).includes(selection.group) ? selection.group : "";
  const models = assistantModelsForGroup(source, group);
  const model = models.find((item) => item.id === selection.model) || models[0];
  return { providerId: source.id, model: model?.id || "", group };
}
