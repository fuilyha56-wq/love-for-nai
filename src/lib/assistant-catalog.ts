import { readUsableGroups, resolvedNewApiBaseUrl, userHeaders, type Session } from "@/lib/newapi";
import { loadNewApiModels } from "@/lib/provider/newapi-models";
import { listRegistryEntries } from "@/lib/provider/store";
import { assistantModelIds } from "@/lib/assistant-models";
import { fetchNewApiSelf } from "@/lib/shared-user-self";

export type AssistantCatalogSource = { id: string; name: string; models: Array<{ id: string; groups: string[] }> };
export async function loadAssistantCatalog(session: Session) {
  const [upstream, custom] = await Promise.allSettled([
    (async () => {
      const base = await resolvedNewApiBaseUrl(), headers = userHeaders(session);
      const [models, usableResult, selfResult] = await Promise.all([
        loadNewApiModels(session, true),
        Promise.allSettled([readUsableGroups(base, headers)]).then(results => results[0]),
        Promise.allSettled([fetchNewApiSelf(base, headers).then(async response => {
          const result = await response.json() as { success?: boolean; message?: string; data?: { group?: string; user?: { group?: string } } };
          if (!response.ok || result.success === false) throw new Error(result.message || "无法读取用户分组");
          return result.data?.user?.group || result.data?.group;
        })]).then(results => results[0]),
      ]);
      const usable = usableResult.status === "fulfilled" ? usableResult.value : [];
      const self = selfResult.status === "fulfilled" ? selfResult.value : undefined;
      const allowed = new Set([...(self ? [self] : []), ...usable]);
      const ids = new Set(assistantModelIds(models));
      return { id: "newapi", name: "NewAPI", models: models.filter(model => ids.has(model.id) && (!allowed.size || !model.groups?.length || model.groups.some(group => allowed.has(group)))).map(model => ({
        id: model.id,
        groups: !allowed.size ? [] : model.groups?.length ? model.groups.filter(group => allowed.has(group)) : [...allowed],
      })) };
    })(),
    listRegistryEntries(session.userId, "text"),
  ]);
  const sources: AssistantCatalogSource[] = [];
  if (upstream.status === "fulfilled") sources.push(upstream.value);
  else sources.push({ id: "newapi", name: "NewAPI", models: [] });
  if (custom.status === "fulfilled") for (const entry of custom.value) {
    if (entry.kind !== "openai") continue;
    const models = entry.modelEntries.filter(model => (model.capabilities === "text" || model.capabilities === "both")).map(model => ({ id: model.id, groups: [] }));
    if (models.length && entry.secret) sources.push({ id: entry.id, name: entry.name, models });
  }
  const message = upstream.status === "rejected" ? upstream.reason instanceof Error ? upstream.reason.message : "无法读取 NewAPI 模型" : custom.status === "rejected" ? "自定义模型源读取失败，请检查模型管理" : "";
  if (upstream.status === "rejected" && sources.length === 1) throw upstream.reason;
  return { models: sources[0].models.map(model => model.id), sources, ...(message ? { message } : {}) };
}
